import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { preflightCognition, CognitionPreflightError } from "@/lib/cognition";
import type { AccountContext } from "@/lib/auth/types";
import { assertWorkspaceOwner } from "@/lib/auth/workspace-permissions";
import {
  BRAND_COGNITION_PROMPT_VERSION,
  PRODUCT_COGNITION_PROMPT_VERSION,
  type CognitionAnalysisResult,
} from "@/lib/server/cognition-analysis";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  CognitionInputSnapshot,
  CognitionInsight,
  CognitionInsightItem,
  CognitionInsightRevision,
  CognitionProductInput,
  CognitionRun,
  Competitor,
} from "@/lib/types";
import { assertUuid } from "@/lib/server/workspace-write-rules";
import { WorkspaceAccessError } from "@/lib/server/workspace-access";

type Row = Record<string, unknown>;
type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

export type CognitionWork = {
  jobId: string;
  run: CognitionRun;
};

export async function startCognitionRun(account: AccountContext, brandId: string) {
  assertWorkspaceOwner(account, "建立品牌认知");
  const organizationId = requireOrganization(account);
  assertUuid(brandId, "品牌ID");
  const supabase = createSupabaseAdminClient();
  const snapshot = await loadInputSnapshot(supabase, organizationId, brandId);
  const checked = preflightCognition(snapshot);
  if (!checked.ready) throw new CognitionPreflightError(checked.issues);
  const inputHash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  const idempotencyKey = `${brandId}:${inputHash}`;

  const existing = await findRunByKey(supabase, organizationId, idempotencyKey);
  if (existing) {
    if (text(existing.status) === "queued") {
      await ensureCognitionJob(supabase, organizationId, brandId, text(existing.id));
    }
    return loadRunWithInsights(supabase, organizationId, text(existing.id));
  }

  const inserted = await supabase.from("cognition_runs").insert({
    organization_id: organizationId,
    brand_id: brandId,
    idempotency_key: idempotencyKey,
    input_hash: inputHash,
    input_snapshot: snapshot,
    status: "queued",
    brand_prompt_version: BRAND_COGNITION_PROMPT_VERSION,
    product_prompt_version: PRODUCT_COGNITION_PROMPT_VERSION,
    created_by: account.userId,
  }).select("*").maybeSingle();
  if (inserted.error) {
    if (inserted.error.code === "23505") {
      const concurrent = await findRunByKey(supabase, organizationId, idempotencyKey);
      if (concurrent) return loadRunWithInsights(supabase, organizationId, text(concurrent.id));
    }
    throw new Error(inserted.error.message);
  }
  if (!inserted.data) throw new Error("认知分析批次创建失败");
  const runId = text(inserted.data.id);
  try {
    await enqueueCognitionJob(supabase, organizationId, brandId, runId);
    return mapRun(inserted.data as Row, []);
  } catch (error) {
    const message = error instanceof Error ? error.message : "认知分析任务创建失败";
    await supabase.from("cognition_runs").update({ status: "failed", error: message })
      .eq("organization_id", organizationId).eq("id", runId);
    return loadRunWithInsights(supabase, organizationId, runId);
  }
}

export async function getCognitionRun(
  account: AccountContext,
  input: { runId?: string; brandId?: string },
) {
  const organizationId = requireOrganization(account);
  if (!input.runId && !input.brandId) throw new Error("缺少认知分析批次或品牌ID");
  if (input.runId) assertUuid(input.runId, "认知分析批次ID");
  if (input.brandId) assertUuid(input.brandId, "品牌ID");
  const supabase = createSupabaseAdminClient();
  if (input.runId) return loadRunWithInsights(supabase, organizationId, input.runId);
  const query = await supabase.from("cognition_runs").select("*")
    .eq("organization_id", organizationId).eq("brand_id", input.brandId!)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (query.error) throw new Error(query.error.message);
  if (!query.data) return undefined;
  return loadRunWithInsights(supabase, organizationId, text(query.data.id));
}

export async function retryCognitionRun(account: AccountContext, runId: string) {
  assertWorkspaceOwner(account, "重试品牌认知分析");
  const organizationId = requireOrganization(account);
  assertUuid(runId, "认知分析批次ID");
  const supabase = createSupabaseAdminClient();
  const current = await loadRunWithInsights(supabase, organizationId, runId);
  if (current.status !== "failed") return current;
  const activeJob = await supabase.from("background_jobs").select("id")
    .eq("organization_id", organizationId).eq("type", "cognition_setup")
    .eq("entity_id", runId).in("status", ["pending", "running"]).limit(1).maybeSingle();
  if (activeJob.error) throw new Error(activeJob.error.message);
  const reset = await supabase.from("cognition_runs").update({ status: "queued", error: null })
    .eq("organization_id", organizationId).eq("id", runId).eq("status", "failed")
    .select("brand_id").maybeSingle();
  if (reset.error) throw new Error(reset.error.message);
  if (!reset.data) throw new Error("认知分析批次状态已变化，请刷新后重试");
  const drafts = await supabase.from("cognition_insights").delete()
    .eq("organization_id", organizationId).eq("run_id", runId).eq("status", "draft");
  if (drafts.error) throw new Error(drafts.error.message);
  if (!activeJob.data) await enqueueCognitionJob(supabase, organizationId, text(reset.data.brand_id), runId);
  return loadRunWithInsights(supabase, organizationId, runId);
}

export async function confirmCognitionRun(
  account: AccountContext,
  runId: string,
  revisions: CognitionInsightRevision[],
) {
  assertWorkspaceOwner(account, "确认品牌认知");
  const organizationId = requireOrganization(account);
  assertUuid(runId, "认知分析批次ID");
  const supabase = createSupabaseAdminClient();
  const run = await loadRunWithInsights(supabase, organizationId, runId);
  if (run.status === "confirmed") return run;
  if (run.status !== "review_required") throw new Error("当前认知分析批次不能确认");
  const revisionsById = new Map(revisions.map((item) => [item.insightId, item.items]));
  if (revisionsById.size !== run.insights.length) throw new Error("必须一次确认本批次的全部洞察");
  const revisedPayloads = run.insights.map((insight) => {
    const revisionItems = revisionsById.get(insight.id);
    if (!revisionItems) throw new Error("洞察修订不完整");
    const conclusionByKey = new Map(revisionItems.map((item) => [item.key, item.conclusion.trim()]));
    if (conclusionByKey.size !== insight.items.length) throw new Error("洞察修订不完整");
    const payload = insight.items.map((item) => {
      const conclusion = conclusionByKey.get(item.key);
      if (!conclusion || conclusion.length > 2_000) throw new Error(`${item.label}的审核内容不正确`);
      return { ...item, conclusion };
    });
    return { id: insight.id, payload };
  });
  const confirmed = await supabase.rpc("confirm_cognition_run", {
    target_organization_id: organizationId,
    target_run_id: runId,
    actor_id: account.userId,
    revised_payloads: revisedPayloads,
  });
  if (confirmed.error) throw new Error(confirmed.error.message);
  return loadRunWithInsights(supabase, organizationId, runId);
}

export async function claimNextCognitionWork(workerId: string): Promise<CognitionWork | undefined> {
  const supabase = createSupabaseAdminClient();
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  await supabase.from("background_jobs").update({
    status: "pending", locked_at: null, locked_by: null, available_at: new Date().toISOString(),
  }).eq("type", "cognition_setup").eq("status", "running").lt("locked_at", staleBefore);

  const next = await supabase.from("background_jobs").select("*")
    .eq("type", "cognition_setup").eq("status", "pending")
    .lte("available_at", new Date().toISOString())
    .order("available_at").limit(1).maybeSingle();
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
  const runUpdate = await supabase.from("cognition_runs").update({
    status: "analyzing", attempt, started_at: new Date().toISOString(), error: null,
  }).eq("organization_id", organizationId).eq("id", runId)
    .in("status", ["queued", "failed", "analyzing"]).select("id").maybeSingle();
  if (runUpdate.error) throw new Error(runUpdate.error.message);
  if (!runUpdate.data) {
    await supabase.from("background_jobs").update({ status: "completed", locked_at: null, locked_by: null })
      .eq("id", text(job.id));
    return undefined;
  }
  return { jobId: text(job.id), run: await loadRunWithInsights(supabase, organizationId, runId) };
}

export async function completeCognitionWork(
  work: CognitionWork,
  results: Array<{
    subjectType: CognitionInsight["subjectType"];
    subjectId: string;
    subjectName: string;
    modelType: CognitionInsight["modelType"];
    analysis: CognitionAnalysisResult;
  }>,
) {
  const organizationId = await runOrganizationId(work.run.id);
  const supabase = createSupabaseAdminClient();
  const cleared = await supabase.from("cognition_insights").delete()
    .eq("organization_id", organizationId).eq("run_id", work.run.id).eq("status", "draft");
  if (cleared.error) throw new Error(cleared.error.message);
  const inserted = await supabase.from("cognition_insights").insert(results.map((result) => ({
    id: randomUUID(),
    organization_id: organizationId,
    brand_id: work.run.brandId,
    run_id: work.run.id,
    subject_type: result.subjectType,
    subject_id: result.subjectId,
    subject_name: result.subjectName,
    model_type: result.modelType,
    payload: result.analysis.items,
    status: "draft",
    version: 0,
    is_current: false,
    provider: result.analysis.provider,
    model: result.analysis.model,
    prompt_version: result.analysis.promptVersion,
    web_search_used: result.analysis.webSearchUsed,
  })));
  if (inserted.error) throw new Error(inserted.error.message);
  const runUpdate = await supabase.from("cognition_runs").update({
    status: "review_required", error: null, completed_at: new Date().toISOString(),
  }).eq("organization_id", organizationId).eq("id", work.run.id).eq("status", "analyzing");
  if (runUpdate.error) throw new Error(runUpdate.error.message);
  const jobUpdate = await supabase.from("background_jobs").update({
    status: "completed", error: null, locked_at: null, locked_by: null,
  }).eq("id", work.jobId);
  if (jobUpdate.error) throw new Error(jobUpdate.error.message);
}

export async function failCognitionWork(work: CognitionWork, error: unknown, retryable: boolean) {
  const supabase = createSupabaseAdminClient();
  const { data: job, error: jobError } = await supabase.from("background_jobs")
    .select("organization_id,attempt,max_attempts").eq("id", work.jobId).maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) return;
  const organizationId = text(job.organization_id);
  const attempt = numberValue(job.attempt);
  const canRetry = retryable && attempt < numberValue(job.max_attempts, 3);
  const message = error instanceof Error ? error.message : "认知分析失败";
  const nextAvailableAt = new Date(Date.now() + Math.min(60_000, 2_000 * 2 ** attempt)).toISOString();
  const jobUpdate = await supabase.from("background_jobs").update(canRetry ? {
    status: "pending", error: message, available_at: nextAvailableAt, locked_at: null, locked_by: null,
  } : {
    status: "failed", error: message, locked_at: null, locked_by: null,
  }).eq("id", work.jobId);
  if (jobUpdate.error) throw new Error(jobUpdate.error.message);
  const runUpdate = await supabase.from("cognition_runs").update({
    status: canRetry ? "queued" : "failed", error: canRetry ? null : message,
  }).eq("organization_id", organizationId).eq("id", work.run.id);
  if (runUpdate.error) throw new Error(runUpdate.error.message);
}

async function loadInputSnapshot(
  supabase: SupabaseAdmin,
  organizationId: string,
  brandId: string,
): Promise<CognitionInputSnapshot> {
  const query = await supabase.from("brands").select("*,products:brand_products(*),competitors:brand_competitors(*)")
    .eq("organization_id", organizationId).eq("id", brandId).is("deleted_at", null).maybeSingle();
  if (query.error) throw new Error(query.error.message);
  if (!query.data) throw new WorkspaceAccessError("品牌不属于当前组织", 403);
  const row = query.data as Row;
  return {
    brand: {
      id: text(row.id),
      name: text(row.name),
      shortName: text(row.short_name),
      characteristics: text(row.characteristics),
      categoryName: text(row.category_name),
      trustProof: text(row.trust_proof),
      positioningStatement: text(row.positioning_statement),
      industry: text(row.industry),
      industryCode: text(row.industry_code),
      industryPath: text(row.industry_path),
      industryStandard: text(row.industry_standard),
      website: text(row.website),
      intro: text(row.intro),
      serviceArea: text(row.service_area),
      targetAudience: text(row.target_audience),
      coreScenarios: text(row.core_scenarios),
      valuePromise: text(row.value_promise),
      cognitionBoundary: text(row.cognition_boundary),
      otherInfo: text(row.other_info),
    },
    products: rows(row.products).sort(sortOrder).map(mapProduct),
    competitors: rows(row.competitors).sort(sortOrder).map((item): Competitor => ({
      id: text(item.id), name: text(item.name), description: text(item.description),
    })),
  };
}

async function loadRunWithInsights(supabase: SupabaseAdmin, organizationId: string, runId: string) {
  const [runQuery, insightQuery] = await Promise.all([
    supabase.from("cognition_runs").select("*").eq("organization_id", organizationId).eq("id", runId).maybeSingle(),
    supabase.from("cognition_insights").select("*").eq("organization_id", organizationId).eq("run_id", runId)
      .order("subject_type").order("subject_name"),
  ]);
  if (runQuery.error || insightQuery.error) throw new Error(runQuery.error?.message || insightQuery.error?.message);
  if (!runQuery.data) throw new WorkspaceAccessError("认知分析批次不存在", 404);
  return mapRun(runQuery.data as Row, rows(insightQuery.data));
}

async function findRunByKey(supabase: SupabaseAdmin, organizationId: string, idempotencyKey: string) {
  const result = await supabase.from("cognition_runs").select("*")
    .eq("organization_id", organizationId).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data as Row | null;
}

async function enqueueCognitionJob(
  supabase: SupabaseAdmin,
  organizationId: string,
  brandId: string,
  runId: string,
) {
  const result = await supabase.from("background_jobs").insert({
    organization_id: organizationId,
    brand_id: brandId,
    type: "cognition_setup",
    entity_type: "cognition_run",
    entity_id: runId,
    status: "pending",
    payload: { runId },
    max_attempts: 3,
  });
  if (result.error && result.error.code !== "23505") throw new Error(result.error.message);
}

async function ensureCognitionJob(
  supabase: SupabaseAdmin,
  organizationId: string,
  brandId: string,
  runId: string,
) {
  const existing = await supabase.from("background_jobs").select("id")
    .eq("organization_id", organizationId).eq("type", "cognition_setup")
    .eq("entity_id", runId).in("status", ["pending", "running"]).limit(1).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (!existing.data) await enqueueCognitionJob(supabase, organizationId, brandId, runId);
}

async function runOrganizationId(runId: string) {
  const result = await createSupabaseAdminClient().from("cognition_runs")
    .select("organization_id").eq("id", runId).maybeSingle();
  if (result.error || !result.data) throw new Error(result.error?.message || "认知分析批次不存在");
  return text(result.data.organization_id);
}

function mapRun(row: Row, insightRows: Row[]): CognitionRun {
  const snapshot = record(row.input_snapshot) as unknown as CognitionInputSnapshot;
  return {
    id: text(row.id),
    brandId: text(row.brand_id),
    brandName: text(snapshot.brand?.name),
    status: text(row.status) as CognitionRun["status"],
    error: optionalText(row.error),
    attempt: numberValue(row.attempt),
    inputSnapshot: snapshot,
    insights: insightRows.map(mapInsight),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    startedAt: optionalText(row.started_at),
    completedAt: optionalText(row.completed_at),
    confirmedAt: optionalText(row.confirmed_at),
  };
}

function mapInsight(row: Row): CognitionInsight {
  return {
    id: text(row.id),
    runId: text(row.run_id),
    brandId: text(row.brand_id),
    subjectType: text(row.subject_type) as CognitionInsight["subjectType"],
    subjectId: text(row.subject_id),
    subjectName: text(row.subject_name),
    modelType: text(row.model_type) as CognitionInsight["modelType"],
    items: jsonArray<CognitionInsightItem>(row.payload),
    status: text(row.status) as CognitionInsight["status"],
    version: numberValue(row.version),
    isCurrent: row.is_current === true,
    provider: text(row.provider),
    model: text(row.model),
    promptVersion: text(row.prompt_version),
    webSearchUsed: row.web_search_used === true,
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function mapProduct(row: Row): CognitionProductInput {
  return {
    id: text(row.id), name: text(row.name), type: text(row.type), description: text(row.description),
    features: text(row.features), audience: text(row.audience),
    scenarios: text(row.scenarios), advantages: text(row.advantages), problemsSolved: text(row.problems_solved),
    quantitativeFacts: text(row.quantitative_facts), evidence: text(row.evidence), limitations: text(row.limitations),
    otherInfo: text(row.other_info),
  };
}

function requireOrganization(account: AccountContext) {
  if (!account.organizationId) throw new Error("账号尚未分配组织");
  return account.organizationId;
}

function rows(value: unknown): Row[] { return Array.isArray(value) ? value as Row[] : []; }
function record(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function jsonArray<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function optionalText(value: unknown) { return typeof value === "string" && value ? value : undefined; }
function numberValue(value: unknown, fallback = 0) { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function sortOrder(left: Row, right: Row) { return numberValue(left.sort_order) - numberValue(right.sort_order); }
