import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { AccountContext } from "@/lib/auth/types";
import { assertWorkspaceOwner } from "@/lib/auth/workspace-permissions";
import {
  QUESTION_QUALITY_RULE_VERSION,
  QUESTION_SIMULATION_PROMPT_VERSION,
  validateReviewedCandidates,
} from "@/lib/question-simulator";
import type {
  QuestionSimulationAnalysis,
  QuestionSimulationInputSnapshot,
} from "@/lib/server/question-simulation-analysis";
import { listBrandQuestions } from "@/lib/server/question-library-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  CognitionInputSnapshot,
  CognitionInsightItem,
  QuestionCandidate,
  QuestionCandidateReview,
  QuestionPersona,
  QuestionSimulationMode,
  QuestionSimulationRun,
} from "@/lib/types";
import { WorkspaceAccessError } from "@/lib/server/workspace-access";
import { assertUuid } from "@/lib/server/workspace-write-rules";

type Row = Record<string, unknown>;
type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

export type QuestionSimulationWork = {
  jobId: string;
  run: QuestionSimulationRun;
  inputSnapshot: QuestionSimulationInputSnapshot;
};

export async function startQuestionSimulation(account: AccountContext, input: {
  brandId: string;
  subjectType: "brand" | "product";
  subjectId: string;
  mode: QuestionSimulationMode;
}) {
  assertWorkspaceOwner(account, "生成模拟用户问题");
  const organizationId = requireOrganization(account);
  assertUuid(input.brandId, "品牌ID");
  assertUuid(input.subjectId, "检测对象ID");
  const supabase = createSupabaseAdminClient();

  const active = await findActiveRun(supabase, organizationId, input.subjectType, input.subjectId);
  if (active) {
    if (text(active.status) === "queued") await ensureSimulationJob(supabase, organizationId, input.brandId, text(active.id));
    return loadRunWithCandidates(supabase, organizationId, text(active.id));
  }

  const baseline = await loadConfirmedBaseline(supabase, organizationId, input);
  const snapshot = await buildSimulationSnapshot(supabase, organizationId, input, baseline);
  assertSimulationInputReady(snapshot, baseline.items);
  const inputHash = sha(snapshot);
  const configHash = sha({
    mode: input.mode,
    promptVersion: QUESTION_SIMULATION_PROMPT_VERSION,
    qualityVersion: QUESTION_QUALITY_RULE_VERSION,
    outputCount: 12,
  });
  const keyPrefix = `${input.subjectType}:${input.subjectId}:${baseline.id}:${baseline.version}:${configHash}`;
  const sequenceResult = await supabase.from("question_simulation_runs").select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId).like("idempotency_key", `${keyPrefix}:%`);
  if (sequenceResult.error) throw new Error(sequenceResult.error.message);
  const idempotencyKey = `${keyPrefix}:${(sequenceResult.count || 0) + 1}`;

  const inserted = await supabase.from("question_simulation_runs").insert({
    organization_id: organizationId,
    brand_id: input.brandId,
    subject_type: input.subjectType,
    subject_id: input.subjectId,
    subject_name: snapshot.subjectName,
    cognition_insight_id: baseline.id,
    cognition_version: baseline.version,
    mode: input.mode,
    status: "queued",
    stage: "persona",
    input_hash: inputHash,
    input_snapshot: snapshot,
    config_hash: configHash,
    idempotency_key: idempotencyKey,
    prompt_version: QUESTION_SIMULATION_PROMPT_VERSION,
    quality_rule_version: QUESTION_QUALITY_RULE_VERSION,
    created_by: account.userId,
  }).select("*").maybeSingle();
  if (inserted.error) {
    if (inserted.error.code === "23505") {
      const concurrent = await findActiveRun(supabase, organizationId, input.subjectType, input.subjectId);
      if (concurrent) return loadRunWithCandidates(supabase, organizationId, text(concurrent.id));
    }
    throw new Error(inserted.error.message);
  }
  if (!inserted.data) throw new Error("模拟生成批次创建失败");
  const runId = text(inserted.data.id);
  await enqueueSimulationJob(supabase, organizationId, input.brandId, runId);
  return mapRun(inserted.data as Row, []);
}

export async function getQuestionSimulation(account: AccountContext, input: {
  runId?: string;
  brandId?: string;
  subjectType?: "brand" | "product";
  subjectId?: string;
}) {
  const organizationId = requireOrganization(account);
  const supabase = createSupabaseAdminClient();
  if (input.runId) {
    assertUuid(input.runId, "模拟生成批次ID");
    return loadRunWithCandidates(supabase, organizationId, input.runId);
  }
  if (!input.brandId || !input.subjectType || !input.subjectId) throw new Error("缺少模拟生成批次或检测对象");
  assertUuid(input.brandId, "品牌ID");
  assertUuid(input.subjectId, "检测对象ID");
  const result = await supabase.from("question_simulation_runs").select("id")
    .eq("organization_id", organizationId).eq("brand_id", input.brandId)
    .eq("subject_type", input.subjectType).eq("subject_id", input.subjectId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data ? loadRunWithCandidates(supabase, organizationId, text(result.data.id)) : undefined;
}

export async function retryQuestionSimulation(account: AccountContext, runId: string) {
  assertWorkspaceOwner(account, "重试模拟问题生成");
  const organizationId = requireOrganization(account);
  assertUuid(runId, "模拟生成批次ID");
  const supabase = createSupabaseAdminClient();
  const current = await loadRunWithCandidates(supabase, organizationId, runId);
  if (current.status !== "failed") return current;
  const reset = await supabase.from("question_simulation_runs").update({
    status: "queued", stage: "persona", error: null, error_category: null, error_retryable: false,
  }).eq("organization_id", organizationId).eq("id", runId).eq("status", "failed")
    .select("brand_id").maybeSingle();
  if (reset.error) throw new Error(reset.error.message);
  if (!reset.data) throw new Error("模拟生成批次状态已变化，请刷新后重试");
  const cleared = await supabase.from("question_candidates").delete()
    .eq("organization_id", organizationId).eq("run_id", runId);
  if (cleared.error) throw new Error(cleared.error.message);
  await enqueueSimulationJob(supabase, organizationId, text(reset.data.brand_id), runId);
  return loadRunWithCandidates(supabase, organizationId, runId);
}

export async function confirmQuestionSimulation(
  account: AccountContext,
  runId: string,
  reviewed: QuestionCandidateReview[],
) {
  assertWorkspaceOwner(account, "确认模拟问题入库");
  const organizationId = requireOrganization(account);
  assertUuid(runId, "模拟生成批次ID");
  const validated = validateReviewedCandidates(reviewed);
  if (new Set(validated.map((item) => item.id)).size !== validated.length) {
    throw new Error("候选问题记录不能重复选择");
  }
  const supabase = createSupabaseAdminClient();
  const confirmed = await supabase.rpc("confirm_question_simulation", {
    target_organization_id: organizationId,
    target_run_id: runId,
    actor_id: account.userId,
    reviewed_questions: validated,
  });
  if (confirmed.error) throw new Error(confirmed.error.message);
  const run = await loadRunWithCandidates(supabase, organizationId, runId);
  return { run, questions: await listBrandQuestions(account, run.brandId) };
}

export async function cancelQuestionSimulation(account: AccountContext, runId: string) {
  assertWorkspaceOwner(account, "放弃模拟问题批次");
  const organizationId = requireOrganization(account);
  assertUuid(runId, "模拟生成批次ID");
  const supabase = createSupabaseAdminClient();
  const current = await loadRunWithCandidates(supabase, organizationId, runId);
  if (current.status === "confirmed" || current.status === "cancelled") return current;
  if (!(["queued", "review_required", "failed"] as const).includes(current.status as "queued" | "review_required" | "failed")) {
    throw new Error("正在生成的问题暂时不能放弃");
  }
  const updated = await supabase.from("question_simulation_runs").update({
    status: "cancelled", deleted_count: current.generatedCount,
    completed_at: new Date().toISOString(), error: null, error_retryable: false,
  }).eq("organization_id", organizationId).eq("id", runId)
    .in("status", ["queued", "review_required", "failed"]).select("id").maybeSingle();
  if (updated.error) throw new Error(updated.error.message);
  await supabase.from("question_candidates").delete().eq("organization_id", organizationId).eq("run_id", runId);
  await supabase.from("background_jobs").update({ status: "completed", locked_at: null, locked_by: null })
    .eq("organization_id", organizationId).eq("type", "question_simulation").eq("entity_id", runId).eq("status", "pending");
  return loadRunWithCandidates(supabase, organizationId, runId);
}

export async function claimNextQuestionSimulationWork(workerId: string): Promise<QuestionSimulationWork | undefined> {
  const supabase = createSupabaseAdminClient();
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  await supabase.from("background_jobs").update({
    status: "pending", locked_at: null, locked_by: null, available_at: new Date().toISOString(),
  }).eq("type", "question_simulation").eq("status", "running").lt("locked_at", staleBefore);
  const next = await supabase.from("background_jobs").select("*")
    .eq("type", "question_simulation").eq("status", "pending")
    .lte("available_at", new Date().toISOString()).order("available_at").limit(1).maybeSingle();
  if (next.error) throw new Error(next.error.message);
  if (!next.data) return undefined;
  const job = next.data as Row;
  const attempt = numberValue(job.attempt) + 1;
  const claimed = await supabase.from("background_jobs").update({
    status: "running", attempt, locked_at: new Date().toISOString(), locked_by: workerId, error: null,
  }).eq("id", text(job.id)).eq("status", "pending").select("id,organization_id,entity_id").maybeSingle();
  if (claimed.error) throw new Error(claimed.error.message);
  if (!claimed.data) return undefined;
  const organizationId = text(claimed.data.organization_id);
  const runId = text(claimed.data.entity_id);
  const runUpdate = await supabase.from("question_simulation_runs").update({
    status: "generating", stage: "persona", attempt, started_at: new Date().toISOString(), error: null,
  }).eq("organization_id", organizationId).eq("id", runId).in("status", ["queued", "failed"])
    .select("id").maybeSingle();
  if (runUpdate.error) throw new Error(runUpdate.error.message);
  if (!runUpdate.data) {
    await supabase.from("background_jobs").update({ status: "completed", locked_at: null, locked_by: null }).eq("id", text(job.id));
    return undefined;
  }
  const run = await loadRunWithCandidates(supabase, organizationId, runId);
  return { jobId: text(job.id), run, inputSnapshot: record((await loadRunRow(supabase, organizationId, runId)).input_snapshot) as unknown as QuestionSimulationInputSnapshot };
}

export async function completeQuestionSimulationWork(
  work: QuestionSimulationWork,
  analysis: QuestionSimulationAnalysis,
) {
  const organizationId = await runOrganizationId(work.run.id);
  const supabase = createSupabaseAdminClient();
  const cleared = await supabase.from("question_candidates").delete()
    .eq("organization_id", organizationId).eq("run_id", work.run.id);
  if (cleared.error) throw new Error(cleared.error.message);
  if (analysis.questions.length) {
    const inserted = await supabase.from("question_candidates").insert(analysis.questions.map((item) => ({
      id: randomUUID(), organization_id: organizationId, brand_id: work.run.brandId, run_id: work.run.id,
      text: item.text, persona: item.persona, decision_scenario: item.decisionScenario,
    })));
    if (inserted.error) throw new Error(inserted.error.message);
  }
  const now = new Date().toISOString();
  const runUpdate = await supabase.from("question_simulation_runs").update({
    status: analysis.questions.length ? "review_required" : "failed",
    stage: "validation",
    personas: analysis.personas,
    coverage_gaps: analysis.coverageGaps,
    external_references: analysis.references,
    model: analysis.model,
    prompt_version: analysis.promptVersion,
    generated_count: analysis.questions.length,
    error: analysis.questions.length ? null : "未生成可审核的问题，请补充信息后新建批次",
    error_category: analysis.questions.length ? null : "invalid_response",
    error_retryable: false,
    completed_at: now,
  }).eq("organization_id", organizationId).eq("id", work.run.id).eq("status", "generating");
  if (runUpdate.error) throw new Error(runUpdate.error.message);
  const jobUpdate = await supabase.from("background_jobs").update({
    status: "completed", error: null, locked_at: null, locked_by: null,
  }).eq("id", work.jobId);
  if (jobUpdate.error) throw new Error(jobUpdate.error.message);
}

export async function failQuestionSimulationWork(
  work: QuestionSimulationWork,
  error: unknown,
  retryable: boolean,
  category = "analysis",
) {
  const supabase = createSupabaseAdminClient();
  const jobResult = await supabase.from("background_jobs").select("organization_id,attempt,max_attempts")
    .eq("id", work.jobId).maybeSingle();
  if (jobResult.error) throw new Error(jobResult.error.message);
  if (!jobResult.data) return;
  const organizationId = text(jobResult.data.organization_id);
  const attempt = numberValue(jobResult.data.attempt);
  const canRetry = retryable && attempt < numberValue(jobResult.data.max_attempts, 3);
  const message = error instanceof Error ? error.message : "模拟问题生成失败";
  const jobUpdate = await supabase.from("background_jobs").update(canRetry ? {
    status: "pending", error: message,
    available_at: new Date(Date.now() + Math.min(60_000, 2_000 * 2 ** attempt)).toISOString(),
    locked_at: null, locked_by: null,
  } : { status: "failed", error: message, locked_at: null, locked_by: null })
    .eq("id", work.jobId);
  if (jobUpdate.error) throw new Error(jobUpdate.error.message);
  const runUpdate = await supabase.from("question_simulation_runs").update({
    status: canRetry ? "queued" : "failed",
    error: canRetry ? null : message,
    error_category: canRetry ? null : category,
    error_retryable: !canRetry && retryable,
  }).eq("organization_id", organizationId).eq("id", work.run.id);
  if (runUpdate.error) throw new Error(runUpdate.error.message);
}

async function loadConfirmedBaseline(
  supabase: SupabaseAdmin,
  organizationId: string,
  input: { brandId: string; subjectType: "brand" | "product"; subjectId: string },
) {
  const result = await supabase.from("cognition_insights").select("*")
    .eq("organization_id", organizationId).eq("brand_id", input.brandId)
    .eq("subject_type", input.subjectType).eq("subject_id", input.subjectId)
    .eq("status", "confirmed").eq("is_current", true).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("请先完成并确认该对象的认知洞察");
  return {
    id: text(result.data.id),
    runId: text(result.data.run_id),
    version: numberValue(result.data.version),
    items: jsonArray<CognitionInsightItem>(result.data.payload),
  };
}

async function buildSimulationSnapshot(
  supabase: SupabaseAdmin,
  organizationId: string,
  input: { brandId: string; subjectType: "brand" | "product"; subjectId: string },
  baseline: { runId: string; items: CognitionInsightItem[] },
): Promise<QuestionSimulationInputSnapshot> {
  const [runResult, questionResult] = await Promise.all([
    supabase.from("cognition_runs").select("input_snapshot").eq("organization_id", organizationId)
      .eq("id", baseline.runId).eq("status", "confirmed").maybeSingle(),
    supabase.from("detection_questions").select("text").eq("organization_id", organizationId)
      .eq("brand_id", input.brandId),
  ]);
  if (runResult.error || questionResult.error) throw new Error(runResult.error?.message || questionResult.error?.message);
  if (!runResult.data) throw new Error("认知基准对应的事实快照不存在");
  const source = record(runResult.data.input_snapshot) as unknown as CognitionInputSnapshot;
  if (!source.brand || source.brand.id !== input.brandId) throw new Error("认知基准事实快照不完整");
  const product = input.subjectType === "product"
    ? source.products.find((item) => item.id === input.subjectId)
    : undefined;
  if (input.subjectType === "product" && !product) throw new Error("认知基准中没有该产品或服务的事实快照");
  const brandFacts = compactRecord({
    name: source.brand.name,
    shortName: source.brand.shortName,
    characteristics: source.brand.characteristics,
    categoryName: source.brand.categoryName,
    positioningStatement: source.brand.positioningStatement,
    industry: source.brand.industry,
    serviceArea: source.brand.serviceArea,
    targetAudience: source.brand.targetAudience,
    coreScenarios: source.brand.coreScenarios,
    valuePromise: source.brand.valuePromise,
    cognitionBoundary: source.brand.cognitionBoundary,
  });
  const subjectFacts = input.subjectType === "brand" ? brandFacts : compactRecord({
    name: product?.name,
    type: product?.type,
    description: product?.description,
    features: product?.features,
    audience: product?.audience,
    scenarios: product?.scenarios,
    advantages: product?.advantages,
    problemsSolved: product?.problemsSolved,
    quantitativeFacts: product?.quantitativeFacts,
    evidence: product?.evidence,
    limitations: product?.limitations,
    otherInfo: product?.otherInfo,
  });
  return {
    brandId: input.brandId,
    brandName: source.brand.name,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    subjectName: input.subjectType === "brand" ? source.brand.name : product?.name || "",
    audience: input.subjectType === "brand" ? source.brand.targetAudience : product?.audience || source.brand.targetAudience,
    category: input.subjectType === "brand" ? source.brand.categoryName || source.brand.industry : product?.type || source.brand.categoryName,
    scenarios: input.subjectType === "brand" ? source.brand.coreScenarios : product?.scenarios || "",
    problems: input.subjectType === "brand" ? source.brand.valuePromise : product?.problemsSolved || "",
    limitations: input.subjectType === "brand" ? source.brand.cognitionBoundary : product?.limitations || "",
    brandFacts,
    subjectFacts,
    competitors: source.competitors.map((item) => ({ name: item.name, description: item.description })),
    cognition: baseline.items,
    existingQuestions: rows(questionResult.data).map((row) => text(row.text)).filter(Boolean),
  };
}

function assertSimulationInputReady(snapshot: QuestionSimulationInputSnapshot, insight: CognitionInsightItem[]) {
  if (!snapshot.audience.trim()) throw new Error("请补充明确的目标用户，并按需更新认知洞察");
  const relevantAudience = insight.filter((item) => item.key === "audience_scenarios" || item.key === "benefit");
  if (relevantAudience.length && relevantAudience.every((item) => item.supportStatus === "insufficient" || isInsufficient(item.conclusion))) {
    throw new Error("当前认知洞察没有可用的目标用户结论，请补充事实并按需更新洞察");
  }
  if (![snapshot.scenarios, snapshot.problems, snapshot.limitations].some((item) => item.trim())
    && !insight.some((item) => item.supportStatus !== "insufficient" && !isInsufficient(item.conclusion))) {
    throw new Error("请补充场景、待解决问题或决策任务，并按需更新认知洞察");
  }
}

async function loadRunWithCandidates(supabase: SupabaseAdmin, organizationId: string, runId: string) {
  const [run, candidates] = await Promise.all([
    loadRunRow(supabase, organizationId, runId),
    supabase.from("question_candidates").select("*").eq("organization_id", organizationId)
      .eq("run_id", runId).order("created_at"),
  ]);
  if (candidates.error) throw new Error(candidates.error.message);
  return mapRun(run, rows(candidates.data));
}

async function loadRunRow(supabase: SupabaseAdmin, organizationId: string, runId: string) {
  const result = await supabase.from("question_simulation_runs").select("*")
    .eq("organization_id", organizationId).eq("id", runId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new WorkspaceAccessError("模拟生成批次不存在", 404);
  return result.data as Row;
}

async function findActiveRun(
  supabase: SupabaseAdmin,
  organizationId: string,
  subjectType: "brand" | "product",
  subjectId: string,
) {
  const result = await supabase.from("question_simulation_runs").select("*")
    .eq("organization_id", organizationId).eq("subject_type", subjectType).eq("subject_id", subjectId)
    .in("status", ["queued", "generating", "review_required"]).order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data as Row | null;
}

async function enqueueSimulationJob(
  supabase: SupabaseAdmin,
  organizationId: string,
  brandId: string,
  runId: string,
) {
  const result = await supabase.from("background_jobs").insert({
    organization_id: organizationId, brand_id: brandId, type: "question_simulation",
    entity_type: "question_simulation_run", entity_id: runId, status: "pending", payload: { runId }, max_attempts: 3,
  });
  if (result.error && result.error.code !== "23505") throw new Error(result.error.message);
}

async function ensureSimulationJob(supabase: SupabaseAdmin, organizationId: string, brandId: string, runId: string) {
  const existing = await supabase.from("background_jobs").select("id")
    .eq("organization_id", organizationId).eq("type", "question_simulation").eq("entity_id", runId)
    .in("status", ["pending", "running"]).limit(1).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (!existing.data) await enqueueSimulationJob(supabase, organizationId, brandId, runId);
}

async function runOrganizationId(runId: string) {
  const result = await createSupabaseAdminClient().from("question_simulation_runs")
    .select("organization_id").eq("id", runId).maybeSingle();
  if (result.error || !result.data) throw new Error(result.error?.message || "模拟生成批次不存在");
  return text(result.data.organization_id);
}

function mapRun(row: Row, candidateRows: Row[]): QuestionSimulationRun {
  return {
    id: text(row.id),
    brandId: text(row.brand_id),
    subjectType: text(row.subject_type) === "product" ? "product" : "brand",
    subjectId: text(row.subject_id),
    subjectName: text(row.subject_name),
    cognitionInsightId: text(row.cognition_insight_id),
    cognitionVersion: numberValue(row.cognition_version),
    mode: text(row.mode) as QuestionSimulationMode,
    status: text(row.status) as QuestionSimulationRun["status"],
    stage: optionalText(row.stage) as QuestionSimulationRun["stage"],
    personas: jsonArray<QuestionPersona>(row.personas),
    candidates: candidateRows.map(mapCandidate),
    coverageGaps: stringArray(row.coverage_gaps),
    externalReferences: jsonArray(row.external_references),
    attempt: numberValue(row.attempt),
    error: optionalText(row.error),
    retryable: row.error_retryable === true,
    model: optionalText(row.model),
    promptVersion: text(row.prompt_version),
    generatedCount: numberValue(row.generated_count),
    adoptedCount: numberValue(row.adopted_count),
    deletedCount: numberValue(row.deleted_count),
    editedCount: numberValue(row.edited_count),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    completedAt: optionalText(row.completed_at),
    confirmedAt: optionalText(row.confirmed_at),
  };
}

function mapCandidate(row: Row): QuestionCandidate {
  return {
    id: text(row.id), runId: text(row.run_id), text: text(row.text), persona: text(row.persona),
    decisionScenario: text(row.decision_scenario), createdAt: text(row.created_at),
  };
}

function compactRecord(value: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => Boolean(item?.trim()))) as Record<string, string>;
}

function sha(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function isInsufficient(value: string) { return /^(信息不足|暂无|未知|未提供)[。.!！]?$/u.test(value.trim()); }
function requireOrganization(account: AccountContext) { if (!account.organizationId) throw new Error("账号尚未分配组织"); return account.organizationId; }
function rows(value: unknown): Row[] { return Array.isArray(value) ? value as Row[] : []; }
function record(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function jsonArray<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function optionalText(value: unknown) { return typeof value === "string" && value ? value : undefined; }
function numberValue(value: unknown, fallback = 0) { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
