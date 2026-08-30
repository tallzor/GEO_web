import "server-only";

import type { DetectionResult, DetectionRunError, DetectionSample, ProviderId } from "@/lib/types";
import { createId } from "@/lib/utils";
import {
  analyzeDetectionBatch,
  buildDetectionDiagnosis,
  DetectionAnalysisError,
  generateOptimizationSuggestions,
  type DetectionAnalysisInput,
  type ResultAnalysis,
} from "@/lib/server/detection-analysis";
import { findExactNameMentions } from "@/lib/server/detection-analysis-rules";
import { classifyProviderError, getProviderAdapter } from "@/lib/server/providers";
import type { ProviderCollectionResult } from "@/lib/server/providers/types";
import { DoubaoApiError } from "@/lib/server/doubao";
import { createLogger } from "@/lib/server/logger";
import {
  claimNextDetectionTask,
  claimNextSuggestionTask,
  getDetectionTask,
  heartbeatDetectionTask,
  releaseDetectionTask,
  updateDetectionTask,
  type ServerDetectionTask,
} from "@/lib/server/detection-task-store";

const HEARTBEAT_MS = 20_000;
const LEASE_SECONDS = 180;
const DEFAULT_COLLECTION_CONCURRENCY = 3;
const RETRY_DELAY_MS = 750;
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
    await withLease(task.id, workerId, () => processDetectionStage(task.id));
    return { processed: true, kind: "detection" as const, id: task.id };
  }
  const suggestionTask = await claimNextSuggestionTask(workerId, LEASE_SECONDS);
  if (suggestionTask) {
    await withLease(suggestionTask.id, workerId, () => processSuggestion(suggestionTask.id));
    return { processed: true, kind: "suggestion" as const, id: suggestionTask.id };
  }
  return { processed: false };
}

async function withLease(id: string, workerId: string, operation: () => Promise<void>) {
  const timer = setInterval(() => {
    void heartbeatDetectionTask(id, workerId, LEASE_SECONDS).catch(() => undefined);
  }, HEARTBEAT_MS);
  timer.unref?.();
  try {
    await operation();
  } catch (error) {
    await markUnexpectedFailure(id, error);
  } finally {
    clearInterval(timer);
    await releaseDetectionTask(id, workerId).catch(() => undefined);
  }
}

async function processDetectionStage(id: string) {
  const task = await getDetectionTask(id);
  if (!task || !["pending", "running"].includes(task.status)) return;
  if (task.stage === "queued" || task.stage === "collecting") return processCollectionBatch(task);
  if (task.stage === "analyzing") return processAnalysisBatch(task);
  if (task.stage === "aggregating") return aggregateDiagnosis(task);
}

async function processCollectionBatch(task: ServerDetectionTask) {
  const collectionErrors = collectionRunErrors(task);
  const batch = task.providers.flatMap((provider) => {
    const question = task.questionSnapshots.find((item) => {
      const key = collectionKey(provider, item.id);
      return !task.results.some((result) => result.provider === provider && result.questionId === item.id)
        && !collectionErrors.some((error) => error.runKey === key);
    });
    return question ? [{ provider, question }] : [];
  }).slice(0, collectionConcurrency());

  if (!batch.length) {
    if (collectionErrors.length) return failStage(task.id, "采集阶段存在失败项，可在检测记录中重试失败项");
    await updateOrThrow(task.id, (current) => progress({
      ...current,
      stage: "analyzing",
      progressMessage: "AI回答采集完成，正在逐题整理与分析",
    }));
    return;
  }

  await Promise.all(batch.map(async ({ provider, question }) => {
    try {
      const collected = await retryOnce(
        () => collectAnswer(provider, question.text, task.brandSnapshot.name),
        (error) => classifyProviderError(provider, error).retryable,
      );
      const result = buildRawResult(
        provider,
        question.id,
        question.text,
        collected,
        [task.brandSnapshot.name, task.brandSnapshot.shortName],
        task.brandSnapshot.competitors.map((item) => item.name),
      );
      await updateOrThrow(task.id, (current) => progress({
        ...current,
        stage: "collecting",
        results: current.results.some((item) => item.provider === provider && item.questionId === question.id)
          ? current.results
          : [...current.results, result],
        runErrors: (current.runErrors || []).filter((item) => item.runKey !== collectionKey(provider, question.id)),
        collectionModelVersions: { ...(current.collectionModelVersions || {}), [provider]: collected.model },
        progressMessage: `正在采集AI回答（${Math.min((current.collectionCompleted || 0) + 1, current.collectionTotal || 0)}/${current.collectionTotal || 0}）`,
      }));
    } catch (error) {
      const classified = classifyProviderError(provider, error);
      await saveRunError(task.id, {
        provider,
        questionId: question.id,
        runKey: collectionKey(provider, question.id),
        message: classified.message,
        category: classified.category,
        retryable: classified.retryable,
      });
    }
  }));
}

async function processAnalysisBatch(task: ServerDetectionTask) {
  const analysisErrors = analysisRunErrors(task);
  const question = task.questionSnapshots.find((item) => {
    const results = task.results.filter((result) => result.questionId === item.id);
    return results.length > 0
      && results.some((result) => !result.analysisModel)
      && !analysisErrors.some((error) => error.runKey === analysisKey(item.id));
  });

  if (!question) {
    if (analysisErrors.length) return failStage(task.id, "分析阶段存在失败项，可在检测记录中重试失败项");
    await updateOrThrow(task.id, (current) => progress({
      ...current,
      stage: "aggregating",
      progressMessage: "逐题分析完成，正在汇总四维结论",
    }));
    return;
  }

  try {
    const input = taskAnalysisInput(task, task.results.filter((result) => result.questionId === question.id));
    const output = process.env.GEO_TEST_MOCK_AI === "true"
      ? mockBatchAnalysis(task, input.responses.map((item) => item.resultId))
      : await retryOnce(() => analyzeDetectionBatch(input), isRetryableAnalysisError);
    const byId = new Map(output.analyses.map((item) => [item.resultId, item]));
    await updateOrThrow(task.id, (current) => progress({
      ...current,
      results: current.results.map((result) => byId.has(result.id) ? applyAnalysis(result, byId.get(result.id)!) : result),
      analysisModel: appendModel(current.analysisModel, output.analysisModel),
      runErrors: (current.runErrors || []).filter((item) => item.runKey !== analysisKey(question.id)),
      progressMessage: `正在逐题分析（${Math.min((current.analysisCompleted || 0) + 1, current.analysisTotal || 0)}/${current.analysisTotal || 0}）`,
    }));
  } catch (error) {
    logger.error("analysis batch failed", {
      detectionId: task.id,
      questionId: question.id,
      error: error instanceof Error ? error.message : String(error),
    });
    const classified = classifyAnalysisError(error);
    await saveRunError(task.id, {
      provider: task.providers[0] || "doubao",
      questionId: question.id,
      runKey: analysisKey(question.id),
      message: classified.message,
      category: classified.category,
      retryable: classified.retryable,
    });
  }
}

async function aggregateDiagnosis(task: ServerDetectionTask) {
  const latest = await getDetectionTask(task.id);
  if (!latest) return;
  const input = taskAnalysisInput(latest, latest.results);
  const analyses = latest.results.filter((item) => item.analysisModel).map(resultAnalysisFromResult);
  if (analyses.length !== latest.results.length) {
    return failStage(task.id, "部分回答缺少分析结果，请重试失败项");
  }
  const diagnosis = buildDetectionDiagnosis(input, analyses, latest.analysisModel || "foundation-model");
  await updateOrThrow(task.id, (current) => progress({
    ...current,
    diagnosis,
    status: "completed",
    stage: "completed",
    completedAt: new Date().toISOString(),
    progressMessage: "检测与分析已完成，可查看四维结果",
  }));
}

async function processSuggestion(id: string) {
  const task = await getDetectionTask(id);
  if (!task?.diagnosis || task.diagnosis.suggestionStatus !== "generating") return;
  try {
    const analyses = task.results.filter((item) => item.analysisModel).map(resultAnalysisFromResult);
    const suggestions = process.env.GEO_TEST_MOCK_AI === "true"
      ? mockOptimizationSuggestions(task)
      : await retryOnce(
        () => generateOptimizationSuggestions(taskAnalysisInput(task, task.results), analyses, task.diagnosis!),
        isRetryableAnalysisError,
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

async function retryOnce<T>(operation: () => Promise<T>, retryable: (error: unknown) => boolean) {
  try { return await operation(); } catch (error) {
    if (!retryable(error)) throw error;
    await wait(RETRY_DELAY_MS);
    return operation();
  }
}

function collectionConcurrency() {
  const configured = Number.parseInt(process.env.GEO_COLLECTION_CONCURRENCY || "", 10);
  if (!Number.isFinite(configured)) return DEFAULT_COLLECTION_CONCURRENCY;
  return Math.min(10, Math.max(1, configured));
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function saveRunError(id: string, nextError: DetectionRunError) {
  await updateOrThrow(id, (current) => progress({
    ...current,
    runErrors: [...(current.runErrors || []).filter((item) => item.runKey !== nextError.runKey), nextError],
    progressMessage: `${nextError.message}；其余项目继续处理`,
  }));
}

async function failStage(id: string, message: string) {
  await updateOrThrow(id, (current) => progress({
    ...current,
    status: "failed",
    stage: "failed",
    completedAt: new Date().toISOString(),
    progressMessage: message,
  }));
}

async function markUnexpectedFailure(id: string, error: unknown) {
  await updateDetectionTask(id, (current) => progress({
    ...current,
    status: "failed",
    stage: "failed",
    completedAt: new Date().toISOString(),
    progressMessage: "任务意外中断，可从检测记录重试",
    runErrors: [...(current.runErrors || []).filter((item) => item.runKey !== "task"), {
      provider: current.providers[0] || "doubao",
      questionId: "__task__",
      runKey: "task",
      message: error instanceof Error ? error.message : "检测任务执行失败",
      category: "collection",
      retryable: true,
    }],
  })).catch(() => undefined);
}

function progress(task: ServerDetectionTask): ServerDetectionTask {
  const collectionCompleted = task.results.length + collectionRunErrors(task).length;
  const analyzedQuestions = new Set(task.results.filter((item) => item.analysisModel).map((item) => item.questionId));
  const analysisCompleted = analyzedQuestions.size;
  return {
    ...task,
    collectionTotal: task.collectionTotal ?? task.providers.length * task.questionSnapshots.length,
    collectionCompleted,
    analysisTotal: task.analysisTotal ?? task.questionSnapshots.length,
    analysisCompleted,
    completedRuns: collectionCompleted + analysisCompleted + (task.diagnosis ? 1 : 0),
    failedRuns: (task.runErrors || []).length,
  };
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
    brand: {
      name: task.brandSnapshot.name, shortName: task.brandSnapshot.shortName,
      characteristics: task.brandSnapshot.characteristics, categoryName: task.brandSnapshot.categoryName,
      trustProof: task.brandSnapshot.trustProof, positioningStatement: task.brandSnapshot.positioningStatement,
      industry: task.brandSnapshot.industry, intro: task.brandSnapshot.intro,
      serviceArea: task.brandSnapshot.serviceArea, targetAudience: task.brandSnapshot.targetAudience,
      products: task.brandSnapshot.products.map((item) => ({ name: item.name, description: item.description, price: item.price, features: item.features })),
      competitors: task.brandSnapshot.competitors.map((item) => ({ name: item.name, description: item.description })),
    },
    responses: results.map((result) => ({
      resultId: result.id, provider: result.provider, questionId: result.questionId,
      question: result.questionSnapshot || "检测问题", answer: result.answer,
      citations: result.citations.map((item) => ({ title: item.title, url: item.url })),
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
    brandMentioned: ownMatches.length > 0, mentionCount: ownMatches.length, firstMentionIndex: ownMatches[0]?.index,
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
    resultId: result.id, brandMentioned: result.brandMentioned, mentionCount: result.mentionCount || 0,
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
    analysisModel: result.analysisModel || "foundation-model",
  };
}

function classifyAnalysisError(error: unknown) {
  if (error instanceof DetectionAnalysisError) return { message: error.message, category: error.category, retryable: error.retryable };
  return { message: "分析结果保存失败，请稍后重试", category: "analysis" as const, retryable: true };
}
function isRetryableAnalysisError(error: unknown) { return error instanceof DetectionAnalysisError && error.retryable; }
function appendModel(existing: string | undefined, model: string) { return [...new Set([...(existing || "").split(", ").filter(Boolean), model])].join(", "); }

async function updateOrThrow(id: string, update: (task: ServerDetectionTask) => ServerDetectionTask) {
  const task = await updateDetectionTask(id, update);
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
  return { analysisModel, analyses: resultIds.map<ResultAnalysis>((resultId) => ({
    resultId, brandMentioned: true, mentionCount: 1, competitorMentions: [], mentionEvidence: task.brandSnapshot.name,
    recommended: true, recommendationType: "recommended", recommendationPosition: "明确推荐", rankPosition: 1,
    recommendationEvidence: `可以优先了解${task.brandSnapshot.name}`, sentimentLabel: "积极",
    sentimentScore: 82, sentimentEvidence: task.brandSnapshot.name, positiveEvaluationCount: 1, negativeEvaluationCount: 0,
    accuracy: "准确", accuracyScore: 80, accuracyEvidence: task.brandSnapshot.name,
    analysisConclusion: "回答明确提及并推荐了该品牌。", factClaims: [],
    rankedBrands: [{ name: task.brandSnapshot.name, rank: 1, evidence: task.brandSnapshot.name, configuredCompetitor: false }],
    reputationTopics: [{ label: "服务体验", sentimentLabel: "积极", evidence: task.brandSnapshot.name }],
    analysisModel,
  })) };
}
