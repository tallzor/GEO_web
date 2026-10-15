import "server-only";

import type { DetectionResult, DetectionRunError, DetectionSample, ProviderId } from "@/lib/types";
import { createId } from "@/lib/utils";
import {
  analyzeDetectionBatch,
  DetectionAnalysisError,
  generateOptimizationSuggestions,
  type DetectionAnalysisInput,
  type ResultAnalysis,
} from "@/lib/server/detection-analysis";
import { findExactNameMentions } from "@/lib/server/detection-analysis-rules";
import { buildGeoDetectionSummary } from "@/lib/geo-result-summary";
import { classifyProviderError, getProviderAdapter } from "@/lib/server/providers";
import type { ProviderCollectionResult } from "@/lib/server/providers/types";
import { DoubaoApiError } from "@/lib/server/doubao";
import { createLogger } from "@/lib/server/logger";
import {
  claimNextDetectionTask,
  claimNextSuggestionTask,
  getDetectionTask,
  heartbeatDetectionTask,
  markDetectionTaskFailed,
  releaseDetectionTask,
  updateDetectionTask,
  type ServerDetectionTask,
} from "@/lib/server/detection-task-store";

const HEARTBEAT_MS = 20_000;
const LEASE_SECONDS = 180;
const DEFAULT_COLLECTION_CONCURRENCY = 3;
const DEFAULT_ANALYSIS_CONCURRENCY = 2;
const DEFAULT_STAGE_TIMEOUT_MS = 240_000;
const DEFAULT_AGGREGATION_TIMEOUT_MS = 120_000;
const mockCollectionAttempts = new Map<string, number>();
const logger = createLogger("detection-task-runner");

export function isProviderReady(provider: ProviderId) {
  if (process.env.GEO_TEST_MOCK_AI === "true") return { ready: true, message: "测试接口可用" };
  if (!getProviderAdapter(provider)) return { ready: false, message: "当前AI平台尚未接入" };
  if ((provider === "doubao" || provider === "deepseek") && !process.env.ARK_API_KEY?.trim()) {
    return { ready: false, message: "火山方舟API Key尚未配置" };
  }
  if (provider === "yuanbao" && !process.env.HUNYUAN_API_KEY?.trim()) {
    return { ready: false, message: "混元API Key尚未配置" };
  }
  return { ready: true, message: "接口配置可用" };
}

/** Worker 每次只推进一个可持久化步骤，进程重启后可从数据库继续。 */
export async function processNextDetectionWork(workerId: string) {
  const task = await claimNextDetectionTask(workerId, LEASE_SECONDS);
  if (task) {
    await withLease(
      task.id,
      workerId,
      () => processDetectionStage(task.id, workerId),
      stageTimeoutMs(task.stage),
    );
    return { processed: true, kind: "detection" as const, id: task.id };
  }
  const suggestionTask = await claimNextSuggestionTask(workerId, LEASE_SECONDS);
  if (suggestionTask) {
    await withLease(suggestionTask.id, workerId, () => processSuggestion(suggestionTask.id));
    return { processed: true, kind: "suggestion" as const, id: suggestionTask.id };
  }
  return { processed: false };
}

async function withLease(
  id: string,
  workerId: string,
  operation: () => Promise<void>,
  timeoutMs?: number,
) {
  const timer = setInterval(() => {
    void heartbeatDetectionTask(id, workerId, LEASE_SECONDS).catch(() => undefined);
  }, HEARTBEAT_MS);
  timer.unref?.();
  try {
    await (timeoutMs ? withTimeout(operation(), timeoutMs) : operation());
  } catch (error) {
    await markUnexpectedFailure(id, workerId, error);
  } finally {
    clearInterval(timer);
    await releaseDetectionTask(id, workerId).catch(() => undefined);
  }
}

async function processDetectionStage(id: string, workerId: string) {
  const task = await getDetectionTask(id);
  if (!task || !["pending", "running"].includes(task.status)) return;
  if (task.stage === "queued" || task.stage === "collecting") return processCollectionBatch(task, workerId);
  if (task.stage === "analyzing") return processAnalysisBatch(task, workerId);
  if (task.stage === "aggregating") return aggregateGeoResult(task, workerId);
}

async function processCollectionBatch(task: ServerDetectionTask, workerId: string) {
  const collectionErrors = collectionRunErrors(task);
  const batch = task.questionSnapshots.flatMap((question) => task.providers
    .filter((provider) => {
      const key = collectionKey(provider, question.id);
      return !task.results.some((result) => result.provider === provider && result.questionId === question.id)
        && !collectionErrors.some((error) => error.runKey === key);
    })
    .map((provider) => ({ provider, question })))
    .slice(0, collectionConcurrency());

  if (!batch.length) {
    if (collectionErrors.length && task.results.length === 0) {
      return failStage(task, workerId, "采集阶段存在失败项，可在检测记录中重试失败项");
    }
    await updateOrThrow(task.id, (current) => progress({
      ...current,
      stage: "analyzing",
      progressMessage: collectionErrors.length
        ? `已采集${current.results.length}个有效回答，${collectionErrors.length}个回答采集失败，继续处理有效回答`
        : "AI回答采集完成，正在逐条处理",
    }), runningGuard(task, workerId, "collecting"));
    return;
  }

  const outcomes = await Promise.all(batch.map(async ({ provider, question }) => {
    try {
      const collected = await retryTransientOnce(
        () => collectAnswer(provider, question.text, task.subjectName || task.brandSnapshot.name),
        (error) => retryDelayForProvider(provider, error),
      );
      return {
        kind: "success" as const,
        provider,
        question,
        collected,
        result: buildRawResult(
          provider,
          question.id,
          question.text,
          collected,
          detectionTargetNames(task),
          task.brandSnapshot.competitors.map((item) => item.name),
        ),
      };
    } catch (error) {
      const classified = classifyProviderError(provider, error);
      return {
        kind: "error" as const,
        provider,
        question,
        error: {
          provider,
          questionId: question.id,
          runKey: collectionKey(provider, question.id),
          message: classified.message,
          category: classified.category,
          retryable: classified.retryable,
        } satisfies DetectionRunError,
      };
    }
  }));

  await updateOrThrow(task.id, (current) => {
    let results = current.results;
    let runErrors = current.runErrors || [];
    const collectionModelVersions = { ...(current.collectionModelVersions || {}) };
    for (const outcome of outcomes) {
      const key = collectionKey(outcome.provider, outcome.question.id);
      runErrors = runErrors.filter((item) => item.runKey !== key);
      if (outcome.kind === "success") {
        if (!results.some((item) => item.provider === outcome.provider && item.questionId === outcome.question.id)) {
          results = [...results, outcome.result];
        }
        collectionModelVersions[outcome.provider] = outcome.collected.model;
      } else {
        runErrors = [...runErrors, outcome.error];
      }
    }
    const next = progress({ ...current, stage: "collecting", results, runErrors, collectionModelVersions });
    return {
      ...next,
      progressMessage: `正在采集AI回答（${next.collectionCompleted || 0}/${next.collectionTotal || 0}）`,
    };
  }, runningGuard(task, workerId, "collecting"));
}

async function processAnalysisBatch(task: ServerDetectionTask, workerId: string) {
  const analysisErrors = analysisRunErrors(task);
  const questions = task.questionSnapshots.filter((question) => {
    const results = task.results.filter((result) => result.questionId === question.id);
    return results.length > 0
      && results.some((result) => !result.analysisModel)
      && !analysisErrors.some((error) => error.runKey === analysisKey(question.id));
  }).slice(0, analysisConcurrency());

  if (!questions.length) {
    if (analysisErrors.length) {
      return failStage(task, workerId, "分析阶段存在失败项，可在检测记录中重试失败项");
    }
    await updateOrThrow(task.id, (current) => progress({
      ...current,
      stage: "aggregating",
      progressMessage: "逐条处理完成，正在汇总检测结果",
    }), runningGuard(task, workerId, "analyzing"));
    return;
  }

  const outcomes = await Promise.all(questions.map(async (question) => {
    try {
      const input = taskAnalysisInput(task, task.results.filter((result) => result.questionId === question.id));
      const output = process.env.GEO_TEST_MOCK_AI === "true"
        ? mockBatchAnalysis(task, input.responses.map((item) => item.resultId))
        : await retryTransientOnce(() => analyzeDetectionBatch(input), retryDelayForAnalysis);
      return { kind: "success" as const, question, output };
    } catch (error) {
      logger.error("analysis batch failed", {
        detectionId: task.id,
        questionId: question.id,
        error: error instanceof Error ? error.message : String(error),
      });
      const classified = classifyAnalysisError(error);
      return {
        kind: "error" as const,
        question,
        error: {
          provider: task.providers[0] || "doubao",
          questionId: question.id,
          runKey: analysisKey(question.id),
          message: classified.message,
          category: classified.category,
          retryable: classified.retryable,
        } satisfies DetectionRunError,
      };
    }
  }));

  await updateOrThrow(task.id, (current) => {
    let results = current.results;
    let runErrors = current.runErrors || [];
    let analysisModel = current.analysisModel;
    for (const outcome of outcomes) {
      const key = analysisKey(outcome.question.id);
      runErrors = runErrors.filter((item) => item.runKey !== key);
      if (outcome.kind === "success") {
        const byId = new Map(outcome.output.analyses.map((item) => [item.resultId, item]));
        results = results.map((result) => byId.has(result.id) ? applyAnalysis(result, byId.get(result.id)!) : result);
        analysisModel = appendModel(analysisModel, outcome.output.analysisModel);
      } else {
        runErrors = [...runErrors, outcome.error];
      }
    }
    const next = progress({ ...current, results, runErrors, analysisModel });
    return {
      ...next,
      progressMessage: `正在逐题分析（${next.analysisCompleted || 0}/${next.analysisTotal || 0}）`,
    };
  }, runningGuard(task, workerId, "analyzing"));
}

async function aggregateGeoResult(task: ServerDetectionTask, workerId: string) {
  const testDelayMs = process.env.GEO_TEST_MOCK_AI === "true"
    ? Math.max(0, Number.parseInt(process.env.GEO_TEST_AGGREGATION_DELAY_MS || "0", 10) || 0)
    : 0;
  if (testDelayMs) await wait(testDelayMs);
  const latest = await getDetectionTask(task.id);
  if (!latest || latest.status !== "running" || latest.stage !== "aggregating" || latest.workerId !== workerId) return;
  const analyzedResults = latest.results.filter((item) => item.analysisModel);
  if (analyzedResults.length !== latest.results.length) {
    return failStage(latest, workerId, "部分回答缺少分析结果，请重试失败项");
  }
  const resultSummary = buildGeoDetectionSummary({
    results: analyzedResults,
    requestedCount: latest.collectionTotal || latest.providers.length * latest.questionSnapshots.length,
    failedCount: collectionRunErrors(latest).length,
    subjectName: latest.subjectName || latest.brandSnapshot.name,
  });
  await updateOrThrow(task.id, (current) => progress({
    ...current,
    resultSummary,
    status: resultSummary.failedCount > 0 ? "partial" : "completed",
    stage: "completed",
    completedAt: new Date().toISOString(),
    progressMessage: resultSummary.failedCount > 0
      ? `检测结果已生成，${resultSummary.failedCount}个回答采集失败`
      : "检测结果已生成",
  }), runningGuard(task, workerId, "aggregating"));
}

async function processSuggestion(id: string) {
  const task = await getDetectionTask(id);
  if (!task?.diagnosis || task.diagnosis.suggestionStatus !== "generating") return;
  try {
    const analyses = task.results.filter((item) => item.analysisModel).map(resultAnalysisFromResult);
    const suggestions = process.env.GEO_TEST_MOCK_AI === "true"
      ? mockOptimizationSuggestions(task)
      : await retryTransientOnce(
        () => generateOptimizationSuggestions(taskAnalysisInput(task, task.results), analyses, task.diagnosis!),
        retryDelayForAnalysis,
      );
    await updateOrThrow(id, (current) => ({
      ...current,
      diagnosis: current.diagnosis ? {
        ...current.diagnosis,
        suggestions,
        suggestionStatus: "generated",
        suggestionError: undefined,
        suggestionUpdatedAt: new Date().toISOString(),
      } : current.diagnosis,
    }));
  } catch (error) {
    const classified = classifyAnalysisError(error);
    await updateOrThrow(id, (current) => ({
      ...current,
      diagnosis: current.diagnosis ? {
        ...current.diagnosis,
        suggestions: [],
        suggestionStatus: "failed",
        suggestionError: classified.message,
        suggestionUpdatedAt: new Date().toISOString(),
      } : current.diagnosis,
    }));
  }
}

async function retryTransientOnce<T>(
  operation: () => Promise<T>,
  retryDelay: (error: unknown) => number | undefined,
) {
  try { return await operation(); } catch (error) {
    const delay = retryDelay(error);
    if (delay === undefined) throw error;
    await wait(delay);
    return operation();
  }
}

function collectionConcurrency() {
  const configured = Number.parseInt(process.env.GEO_COLLECTION_CONCURRENCY || "", 10);
  if (!Number.isFinite(configured)) return DEFAULT_COLLECTION_CONCURRENCY;
  return Math.min(10, Math.max(1, configured));
}

function analysisConcurrency() {
  const configured = Number.parseInt(process.env.GEO_ANALYSIS_CONCURRENCY || "", 10);
  if (!Number.isFinite(configured)) return DEFAULT_ANALYSIS_CONCURRENCY;
  return Math.min(3, Math.max(1, configured));
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function failStage(task: ServerDetectionTask, workerId: string, message: string) {
  await updateOrThrow(task.id, (current) => progress({
    ...current,
    status: "failed",
    stage: "failed",
    completedAt: new Date().toISOString(),
    progressMessage: message,
  }), runningGuard(task, workerId, task.stage));
}

async function markUnexpectedFailure(id: string, workerId: string, error: unknown) {
  await markDetectionTaskFailed(
    id,
    workerId,
    error instanceof DetectionStageTimeoutError
      ? "检测阶段执行超时，可从检测记录重试"
      : "任务意外中断，可从检测记录重试",
    error instanceof Error ? error.message : "检测任务执行失败",
  ).catch((failure) => {
    logger.error("failed to persist terminal detection state", {
      detectionId: id,
      error: failure instanceof Error ? failure.message : String(failure),
    });
  });
}

function progress(task: ServerDetectionTask): ServerDetectionTask {
  const collectionTotal = task.collectionTotal ?? task.providers.length * task.questionSnapshots.length;
  const collectionCompleted = Math.min(collectionTotal, task.results.length + collectionRunErrors(task).length);
  const analyzedQuestions = new Set(task.results.filter((item) => item.analysisModel).map((item) => item.questionId));
  const analysisTotal = task.analysisTotal ?? task.questionSnapshots.length;
  const analysisCompleted = Math.min(analysisTotal, analyzedQuestions.size);
  return {
    ...task,
    collectionTotal,
    collectionCompleted,
    analysisTotal,
    analysisCompleted,
    completedRuns: collectionCompleted + analysisCompleted + (task.resultSummary ? 1 : 0),
    failedRuns: (task.runErrors || []).length,
  };
}

class DetectionStageTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`检测阶段超过 ${timeoutMs}ms 未完成`);
    this.name = "DetectionStageTimeoutError";
  }
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DetectionStageTimeoutError(timeoutMs)), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function stageTimeoutMs(stage: ServerDetectionTask["stage"]) {
  if (stage === "aggregating") {
    const configured = Number.parseInt(process.env.GEO_AGGREGATION_TIMEOUT_MS || "", 10);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_AGGREGATION_TIMEOUT_MS;
  }
  if (stage === "analyzing") return analysisStageTimeoutMs();
  return DEFAULT_STAGE_TIMEOUT_MS;
}

function analysisStageTimeoutMs() {
  const configured = Number.parseInt(process.env.GEO_FOUNDATION_TIMEOUT_MS || "", 10);
  const foundationTimeout = Number.isFinite(configured)
    ? Math.min(300_000, Math.max(30_000, configured))
    : 240_000;
  return Math.min(330_000, foundationTimeout + 30_000);
}

function collectionRunErrors(task: ServerDetectionTask) {
  return (task.runErrors || []).filter((item) => item.runKey?.startsWith("collection:"));
}
function analysisRunErrors(task: ServerDetectionTask) {
  return (task.runErrors || []).filter((item) => item.runKey?.startsWith("analysis:"));
}
function collectionKey(provider: ProviderId, questionId: string) { return `collection:${provider}:${questionId}`; }
function analysisKey(questionId: string) { return `analysis:${questionId}`; }

function taskAnalysisInput(task: ServerDetectionTask, results: DetectionResult[]): DetectionAnalysisInput {
  return {
    subject: {
      type: task.subjectType || "brand",
      name: task.subjectName || task.brandSnapshot.name,
      aliases: task.subjectType === "product" ? [] : [task.brandSnapshot.shortName].filter(Boolean),
    },
    brand: {
      name: task.brandSnapshot.name, shortName: task.brandSnapshot.shortName,
      characteristics: task.brandSnapshot.characteristics, categoryName: task.brandSnapshot.categoryName,
      trustProof: task.brandSnapshot.trustProof, positioningStatement: task.brandSnapshot.positioningStatement,
      industry: task.brandSnapshot.industry, website: task.brandSnapshot.website, intro: task.brandSnapshot.intro,
      serviceArea: task.brandSnapshot.serviceArea, targetAudience: task.brandSnapshot.targetAudience,
      products: task.brandSnapshot.products.map((item) => ({ name: item.name, description: item.description, price: item.price, features: item.features })),
      competitors: task.brandSnapshot.competitors.map((item) => ({ name: item.name, description: item.description })),
    },
    responses: results.map((result) => ({
      resultId: result.id, provider: result.provider, questionId: result.questionId,
      question: result.questionSnapshot || "检测问题", answer: result.answer,
      citations: result.citations,
    })),
  };
}

async function collectAnswer(provider: ProviderId, question: string, brandName: string) {
  if (process.env.GEO_TEST_MOCK_AI === "true") return mockCollection(provider, question, brandName);
  const adapter = getProviderAdapter(provider);
  if (!adapter) throw new Error("当前AI平台尚未接入");
  return adapter.collect({ question, enableWebSearch: adapter.supportsWebSearch });
}

function buildRawResult(provider: ProviderId, questionId: string, question: string, collected: ProviderCollectionResult, brandNames: string[], competitorNames: string[]): DetectionResult {
  const ownMatches = findExactNameMentions(collected.answer, brandNames);
  const competitors = competitorNames.filter((name) => findExactNameMentions(collected.answer, [name]).length > 0);
  const citations = collected.citations.map((item) => ({
    id: createId("citation"), title: item.title, url: item.url, type: "网页", providerType: item.providerType,
    excerpt: item.excerpt || "", relevance: "中" as const, credibility: "中" as const,
  }));
  const sample: DetectionSample = {
    index: 1, answer: collected.answer, brandMentioned: ownMatches.length > 0, competitorMentions: competitors,
    citations, collectedAt: collected.collectedAt, collectionMethod: collected.collectionMethod,
    mentionCount: ownMatches.length, firstMentionIndex: ownMatches[0]?.index, model: collected.model,
    requestId: collected.requestId, latencyMs: collected.latencyMs, inputTokens: collected.usage?.inputTokens,
    outputTokens: collected.usage?.outputTokens, totalTokens: collected.usage?.totalTokens,
    webSearchEnabled: collected.webSearchEnabled, searchQueries: collected.searchQueries,
    webSearchUnavailableReason: collected.webSearchUnavailableReason,
  };
  return {
    id: createId("result"), provider, questionId, questionSnapshot: question, answer: collected.answer,
    brandMentioned: ownMatches.length > 0, targetMentioned: ownMatches.length > 0,
    directQuestion: findExactNameMentions(question, brandNames).length > 0,
    mentionCount: ownMatches.length, firstMentionIndex: ownMatches[0]?.index,
    recommended: false, recommendationPosition: ownMatches.length ? "已提及，待分析" : "未提及品牌",
    competitorMentions: competitors, accuracy: "待确认", citations, samples: [sample],
    dataSource: process.env.GEO_TEST_MOCK_AI === "true" ? "mock" : "live_api",
    collectionMethod: collected.collectionMethod, collectedAt: collected.collectedAt, model: collected.model,
    requestId: collected.requestId, webSearchEnabled: collected.webSearchEnabled,
    searchQueries: collected.searchQueries, webSearchUnavailableReason: collected.webSearchUnavailableReason,
  };
}

function applyAnalysis(result: DetectionResult, analysis: ResultAnalysis): DetectionResult {
  return { ...result, ...analysis };
}

function resultAnalysisFromResult(result: DetectionResult): ResultAnalysis {
  return {
    resultId: result.id, brandMentioned: result.brandMentioned,
    targetMentioned: result.targetMentioned ?? result.brandMentioned,
    directQuestion: result.directQuestion === true,
    presentationRole: result.presentationRole || (result.brandMentioned ? "general_mention" : "not_mentioned"),
    presentationEvidence: result.presentationEvidence || result.recommendationEvidence || "",
    riskSignal: result.riskSignal,
    riskEvidence: result.riskEvidence || "",
    mentionCount: result.mentionCount || 0,
    firstMentionIndex: result.firstMentionIndex, competitorMentions: result.competitorMentions,
    mentionEvidence: result.brandMentioned ? result.questionSnapshot || "品牌被提及" : "",
    recommended: result.recommended, recommendationType: result.recommendationType || "not_mentioned",
    recommendationPosition: result.recommendationPosition, rankPosition: result.rankPosition,
    recommendationEvidence: result.recommendationEvidence || "", sentimentLabel: result.sentimentLabel,
    sentimentScore: result.sentimentScore,
    sentimentEvidence: result.sentimentEvidence || "", positiveEvaluationCount: result.positiveEvaluationCount || 0,
    negativeEvaluationCount: result.negativeEvaluationCount || 0, accuracy: result.accuracy,
    accuracyScore: result.accuracyScore, accuracyEvidence: result.accuracyEvidence || "",
    analysisConclusion: result.analysisConclusion || "", factClaims: result.factClaims || [],
    rankedBrands: result.rankedBrands || [],
    reputationTopics: (result.reputationTopics || [])
      .filter((item) => Boolean(item.sentimentLabel))
      .map((item) => ({ ...item, sentimentLabel: item.sentimentLabel! })),
    citations: result.citations,
    analysisModel: result.analysisModel || "foundation-model",
  };
}

function detectionTargetNames(task: ServerDetectionTask) {
  return task.subjectType === "product"
    ? [task.subjectName || ""].filter(Boolean)
    : [task.subjectName || task.brandSnapshot.name, task.brandSnapshot.shortName].filter(Boolean);
}

function classifyAnalysisError(error: unknown) {
  if (error instanceof DetectionAnalysisError) return { message: error.message, category: error.category, retryable: error.retryable };
  return { message: "分析结果保存失败，请稍后重试", category: "analysis" as const, retryable: true };
}
function retryDelayForProvider(provider: ProviderId, error: unknown) {
  const classified = classifyProviderError(provider, error);
  if (!classified.retryable || classified.category === "timeout") return undefined;
  return classified.category === "rate_limit" ? jitter(1_500, 2_500) : jitter(500, 1_000);
}
function retryDelayForAnalysis(error: unknown) {
  if (!(error instanceof DetectionAnalysisError) || !error.retryable || error.category === "timeout") return undefined;
  return error.category === "rate_limit" ? jitter(1_500, 2_500) : jitter(500, 1_000);
}
function jitter(min: number, max: number) { return Math.round(min + Math.random() * (max - min)); }
function appendModel(existing: string | undefined, model: string) { return [...new Set([...(existing || "").split(", ").filter(Boolean), model])].join(", "); }

function runningGuard(
  task: ServerDetectionTask,
  workerId: string,
  stage: ServerDetectionTask["stage"],
) {
  return { status: "running" as const, stage, workerId, attempt: task.attempt || 1 };
}

async function updateOrThrow(
  id: string,
  update: (task: ServerDetectionTask) => ServerDetectionTask,
  guard?: Parameters<typeof updateDetectionTask>[3],
) {
  const task = await updateDetectionTask(id, update, undefined, guard);
  if (!task) throw new Error("检测任务不存在");
  return task;
}

async function mockCollection(provider: ProviderId, question: string, brandName: string): Promise<ProviderCollectionResult> {
  const attemptKey = `${provider}:${question}`;
  const attempt = (mockCollectionAttempts.get(attemptKey) || 0) + 1;
  mockCollectionAttempts.set(attemptKey, attempt);
  const slowMs = Math.max(0, Number.parseInt(process.env.GEO_TEST_SLOW_MS || "0", 10) || 0);
  if (slowMs > 0) await wait(slowMs);
  if (question.includes("[TEST:SLOW_90S]")) await wait(90_000);
  if (question.includes("[TEST:RATE_LIMIT_TWICE]") && attempt <= 2) {
    throw new DoubaoApiError("模拟429限流", 429, "rate_limit");
  }
  if (question.includes("[TEST:SERVER_5XX_TWICE]") && attempt <= 2) {
    throw new DoubaoApiError("模拟上游5xx", 503, "service_unavailable");
  }
  if (question.includes("[TEST:EMPTY_TWICE]") && attempt <= 2) {
    throw new DoubaoApiError("模拟空回答", 502, "empty_answer");
  }
  if (question.includes("[TEST:FAIL_TWICE]") && attempt <= 2) {
    throw new Error("模拟可重试的采集失败");
  }
  if (question.includes("[TEST:RETRY_ONCE]") && attempt === 1) {
    throw new Error("模拟限流或临时服务错误");
  }
  return { provider, collectionMethod: "model_api", collectedAt: new Date().toISOString(), requestId: `mock-${createId("request")}`,
    model: "test-model", answer: `针对“${question}”，可以优先了解${brandName}。`, citations: [], searchQueries: [],
    webSearchEnabled: false, usage: { inputTokens: 20, outputTokens: 50, totalTokens: 70 }, latencyMs: 20 };
}

function mockOptimizationSuggestions(task: ServerDetectionTask) {
  const cognition = task.brandSnapshot.positioningStatement.trim()
    || task.brandSnapshot.categoryName.trim()
    || task.brandSnapshot.industry.trim()
    || "可信服务";
  return [{
    id: createId("suggestion"),
    title: `围绕“${cognition.slice(0, 14)}”建立清晰认知`,
    description: "围绕目标用户常问的服务场景，补充品牌、产品、适用人群和服务区域的清晰说明。",
    reason: task.brandSnapshot.positioningStatement.trim()
      ? `品牌定位聚焦“${task.brandSnapshot.positioningStatement.slice(0, 18)}”；本次回答中的品牌与服务场景信息仍需补充。`
      : "品牌定位尚未填写，已结合现有品牌资料形成保守认知方向；本次回答中的品牌与服务场景信息仍需补充。",
    dimension: "visibility" as const,
    generatedBy: "rule_fallback" as const,
    generationModel: "rule-fallback",
    promptVersion: "optimization-goal-v3-positioning-light",
  }];
}

function mockBatchAnalysis(task: ServerDetectionTask, resultIds: string[]) {
  const analysisModel = "test-analysis-model";
  const subjectName = task.subjectName || task.brandSnapshot.name;
  return { analysisModel, analyses: resultIds.map<ResultAnalysis>((resultId) => {
    const source = task.results.find((result) => result.id === resultId);
    return {
      resultId, brandMentioned: true, targetMentioned: true, directQuestion: source?.directQuestion === true,
      presentationRole: "alternative", presentationEvidence: `可以优先了解${subjectName}`,
      riskSignal: "none_detected", riskEvidence: "", mentionCount: 1, competitorMentions: [], mentionEvidence: subjectName,
      recommended: true, recommendationType: "recommended", recommendationPosition: "备选方案", rankPosition: undefined,
      recommendationEvidence: `可以优先了解${subjectName}`, sentimentLabel: undefined,
      sentimentScore: undefined, sentimentEvidence: "", positiveEvaluationCount: 0, negativeEvaluationCount: 0,
      accuracy: "待确认", accuracyScore: undefined, accuracyEvidence: "",
      analysisConclusion: "回答明确提及了检测对象。", factClaims: [],
      rankedBrands: [], reputationTopics: [], citations: source?.citations || [], analysisModel,
    };
  }) };
}
