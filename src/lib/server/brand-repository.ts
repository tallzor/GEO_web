import "server-only";

import { randomUUID } from "node:crypto";
import { assertWorkspaceOwner } from "@/lib/auth/workspace-permissions";
import type { AccountContext } from "@/lib/auth/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Brand, DetectionQuestion } from "@/lib/types";
import { WorkspaceAccessError } from "@/lib/server/workspace-access";
import { assertUuid } from "@/lib/server/workspace-write-rules";

type Row = Record<string, unknown>;
type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

export async function saveBrandSnapshots(account: AccountContext, brands: Brand[]) {
  const organizationId = requireOrganization(account);
  if (!brands.length) return;
  brands.forEach((brand) => {
    assertUuid(brand.id, "品牌ID");
    if (!brand.name.trim()) throw new Error("品牌名称不能为空");
  });

  const supabase = createSupabaseAdminClient();
  await assertBrandWriteOwnership(supabase, organizationId, brands);
  const brandIds = brands.map((brand) => brand.id);
  const { data: existingBrandData, error: existingBrandError } = await supabase
    .from("brands")
    .select("id,deleted_at")
    .eq("organization_id", organizationId)
    .in("id", brandIds);
  if (existingBrandError) throw new Error(existingBrandError.message);
  const existingRows = rows(existingBrandData);
  if (existingRows.some((row) => Boolean(row.deleted_at))) {
    throw new Error("工作空间包含已删除品牌，请重新加载后再操作");
  }
  const existingActiveIds = new Set(existingRows.map((row) => text(row.id)));
  if (brandIds.some((id) => !existingActiveIds.has(id))) {
    assertWorkspaceOwner(account, "创建品牌");
  }

  await upsertOrThrow(supabase, "brands", brands.map((brand) => ({
    id: brand.id,
    organization_id: organizationId,
    name: brand.name.trim(),
    short_name: brand.shortName || null,
    characteristics: brand.characteristics || null,
    category_name: brand.categoryName || null,
    trust_proof: brand.trustProof || null,
    positioning_statement: brand.positioningStatement || null,
    industry: brand.industry || null,
    industry_code: brand.industryCode || null,
    industry_path: brand.industryPath || null,
    industry_standard: brand.industryStandard || null,
    website: brand.website || null,
    intro: brand.intro || null,
    city: brand.city || null,
    service_area: brand.serviceArea || null,
    target_audience: brand.targetAudience || null,
    core_scenarios: brand.coreScenarios || null,
    value_promise: brand.valuePromise || null,
    cognition_boundary: brand.cognitionBoundary || null,
    other_info: brand.otherInfo || null,
    question_context_updated_at: brand.questionContextUpdatedAt || null,
    questions_generated_at: brand.questionsGeneratedAt || null,
    created_by: account.userId,
    updated_by: account.userId,
    created_at: brand.createdAt,
    updated_at: brand.updatedAt,
  })));

  for (const brand of brands) {
    await Promise.all([
      syncBrandRows(supabase, "brand_stores", organizationId, brand.id, brand.stores.map((item, index) => ({
        id: item.id, organization_id: organizationId, brand_id: brand.id, name: item.name, address: item.address, sort_order: index,
      }))),
      syncBrandRows(supabase, "brand_products", organizationId, brand.id, brand.products.map((item, index) => ({
        id: item.id, organization_id: organizationId, brand_id: brand.id, name: item.name, type: item.type || null,
        description: item.description || null, price: item.price || null, features: item.features || null,
        audience: item.audience || null, scenarios: item.scenarios || null, advantages: item.advantages || null,
        problems_solved: item.problemsSolved || null, quantitative_facts: item.quantitativeFacts || null,
        evidence: item.evidence || null, limitations: item.limitations || null, other_info: item.otherInfo || null,
        sort_order: index, updated_at: item.updatedAt,
      }))),
      syncBrandRows(supabase, "brand_competitors", organizationId, brand.id, brand.competitors.map((item, index) => ({
        id: item.id, organization_id: organizationId, brand_id: brand.id, name: item.name,
        description: item.description || null, sort_order: index,
      }))),
      syncBrandRows(supabase, "brand_knowledge_files", organizationId, brand.id, brand.knowledge.map((item) => ({
        id: item.id, organization_id: organizationId, brand_id: brand.id, file_name: item.fileName,
        product_id: item.productId || null,
        file_type: item.fileType || null, object_path: `${organizationId}/${brand.id}/${item.id}/${safeObjectName(item.fileName)}`,
        size_label: item.sizeLabel || null, status: item.status, fact_count: item.factCount || 0,
        error: item.error || null, uploaded_by: account.userId, uploaded_by_name: item.uploadedBy || account.displayName,
        created_at: item.uploadedAt,
      }))),
      syncQuestionRows(supabase, organizationId, brand.id, brand.questions.map((item) => ({
        id: item.id, organization_id: organizationId, brand_id: brand.id, text: item.text,
        source: item.source, category: item.category || null, enabled: item.enabled, updated_at: item.updatedAt,
      }))),
    ]);
  }
}

export async function uploadBrandKnowledgeFile(account: AccountContext, input: {
  brandId: string;
  attachmentId: string;
  productId?: string;
  fileName: string;
  extension: string;
  contentType: string;
  size: number;
  sizeLabel: string;
  bytes: Uint8Array;
}) {
  const organizationId = requireOrganization(account);
  assertUuid(input.brandId, "品牌ID");
  assertUuid(input.attachmentId, "附件ID");
  const supabase = createSupabaseAdminClient();
  await assertActiveBrand(supabase, organizationId, input.brandId);
  if (input.productId) await assertProductBelongsToBrand(supabase, organizationId, input.brandId, input.productId);
  await assertIdsOwned(supabase, "brand_knowledge_files", organizationId, [input.attachmentId]);

  const objectPath = `${organizationId}/${input.brandId}/${input.attachmentId}/${safeObjectName(input.fileName)}`;
  const uploaded = await supabase.storage.from("brand-knowledge").upload(objectPath, input.bytes, {
    contentType: input.contentType || "application/octet-stream",
    upsert: false,
  });
  if (uploaded.error) throw new Error(uploaded.error.message);

  const inserted = await supabase.from("brand_knowledge_files").upsert({
    id: input.attachmentId,
    organization_id: organizationId,
    brand_id: input.brandId,
    product_id: input.productId || null,
    file_name: input.fileName,
    file_type: input.extension.toUpperCase(),
    object_path: objectPath,
    size_bytes: input.size,
    size_label: input.sizeLabel,
    status: "uploaded",
    fact_count: 0,
    uploaded_by: account.userId,
    uploaded_by_name: account.displayName,
  }, { onConflict: "id" });
  if (inserted.error) {
    await supabase.storage.from("brand-knowledge").remove([objectPath]);
    throw new Error(inserted.error.message);
  }
  return { objectPath };
}

export async function getBrandKnowledgeDownloadUrl(account: AccountContext, attachmentId: string) {
  const organizationId = requireOrganization(account);
  assertUuid(attachmentId, "附件ID");
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("brand_knowledge_files").select("object_path")
    .eq("organization_id", organizationId).eq("id", attachmentId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new WorkspaceAccessError("附件不存在", 404);
  const objectPath = text(data.object_path);
  const signed = await supabase.storage.from("brand-knowledge").createSignedUrl(objectPath, 60);
  if (signed.error || !signed.data?.signedUrl) throw new Error(signed.error?.message || "附件下载地址生成失败");
  return signed.data.signedUrl;
}

export async function deleteBrandKnowledgeFile(account: AccountContext, attachmentId: string) {
  const organizationId = requireOrganization(account);
  assertUuid(attachmentId, "附件ID");
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("brand_knowledge_files").select("object_path")
    .eq("organization_id", organizationId).eq("id", attachmentId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new WorkspaceAccessError("附件不存在", 404);

  const objectPath = text(data.object_path);
  if (objectPath) {
    const removed = await supabase.storage.from("brand-knowledge").remove([objectPath]);
    if (removed.error) throw new Error(removed.error.message);
  }
  const deleted = await supabase.from("brand_knowledge_files").delete()
    .eq("organization_id", organizationId).eq("id", attachmentId).select("id").maybeSingle();
  if (deleted.error) throw new Error(deleted.error.message);
  if (!deleted.data) throw new Error("附件删除未生效，请刷新后重试");
}

export async function saveGeneratedBrandQuestions(account: AccountContext, input: {
  brandId: string;
  texts: string[];
  generatedAt: string;
  promptVersion: string;
}): Promise<DetectionQuestion[]> {
  const organizationId = requireOrganization(account);
  assertUuid(input.brandId, "品牌ID");
  const generatedTexts = [...new Set(input.texts.map((item) => item.trim()).filter(Boolean))];
  if (!generatedTexts.length) throw new Error("没有可保存的检测问题");
  const supabase = createSupabaseAdminClient();
  await assertActiveBrand(supabase, organizationId, input.brandId);

  const existingResult = await supabase.from("detection_questions")
    .select("id,text,source,category,enabled,updated_at")
    .eq("organization_id", organizationId)
    .eq("brand_id", input.brandId);
  if (existingResult.error) throw new Error(existingResult.error.message);
  const existingByText = new Map(rows(existingResult.data).map((row) => [text(row.text).trim(), row]));
  const questions = generatedTexts.map((questionText): DetectionQuestion => {
    const existing = existingByText.get(questionText);
    return existing ? {
      id: text(existing.id),
      text: questionText,
      source: normalizeQuestionSource(existing.source),
      category: text(existing.category),
      enabled: true,
      updatedAt: input.generatedAt,
    } : {
      id: randomUUID(),
      text: questionText,
      source: "generated",
      category: "",
      enabled: true,
      updatedAt: input.generatedAt,
    };
  });
  await assertIdsOwned(supabase, "detection_questions", organizationId, questions.map((question) => question.id));

  const saveQuestions = await supabase.from("detection_questions").upsert(questions.map((question) => ({
    id: question.id,
    organization_id: organizationId,
    brand_id: input.brandId,
    text: question.text,
    source: question.source,
    category: question.category || null,
    enabled: true,
    prompt_version: input.promptVersion,
    updated_at: input.generatedAt,
  })), { onConflict: "id" });
  if (saveQuestions.error) throw new Error(saveQuestions.error.message);

  const saveBrand = await supabase.from("brands").update({
    questions_generated_at: input.generatedAt,
    updated_at: input.generatedAt,
    updated_by: account.userId,
  }).eq("organization_id", organizationId).eq("id", input.brandId).is("deleted_at", null)
    .select("id").maybeSingle();
  if (saveBrand.error) throw new Error(saveBrand.error.message);
  if (!saveBrand.data) throw new Error("品牌问题生成状态保存未生效");
  return questions;
}

async function assertBrandWriteOwnership(supabase: SupabaseAdmin, organizationId: string, brands: Brand[]) {
  const checks: Array<[string, string[]]> = [
    ["brands", brands.map((item) => item.id)],
    ["brand_stores", brands.flatMap((brand) => brand.stores.map((item) => item.id))],
    ["brand_products", brands.flatMap((brand) => brand.products.map((item) => item.id))],
    ["brand_competitors", brands.flatMap((brand) => brand.competitors.map((item) => item.id))],
    ["brand_knowledge_files", brands.flatMap((brand) => brand.knowledge.map((item) => item.id))],
    ["detection_questions", brands.flatMap((brand) => brand.questions.map((item) => item.id))],
  ];
  for (const [table, ids] of checks) await assertIdsOwned(supabase, table, organizationId, ids);
}

async function assertIdsOwned(supabase: SupabaseAdmin, table: string, organizationId: string, ids: string[]) {
  if (!ids.length) return;
  const { data, error } = await supabase.from(table).select("id,organization_id").in("id", ids);
  if (error) throw new Error(error.message);
  if (rows(data).some((row) => text(row.organization_id) !== organizationId)) {
    throw new Error("检测到不属于当前组织的数据ID");
  }
}

async function assertActiveBrand(supabase: SupabaseAdmin, organizationId: string, brandId: string) {
  const { data, error } = await supabase.from("brands").select("id")
    .eq("organization_id", organizationId).eq("id", brandId).is("deleted_at", null).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new WorkspaceAccessError("品牌不属于当前组织", 403);
}

async function assertProductBelongsToBrand(
  supabase: SupabaseAdmin,
  organizationId: string,
  brandId: string,
  productId: string,
) {
  assertUuid(productId, "产品ID");
  const { data, error } = await supabase.from("brand_products").select("id")
    .eq("organization_id", organizationId).eq("brand_id", brandId).eq("id", productId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new WorkspaceAccessError("附件产品归属不正确", 400);
}

async function upsertOrThrow(
  supabase: SupabaseAdmin,
  table: string,
  values: Record<string, unknown>[],
  onConflict = "id",
) {
  if (!values.length) return;
  const { error } = await supabase.from(table).upsert(values, { onConflict });
  if (error) throw new Error(error.message);
}

async function syncBrandRows(
  supabase: SupabaseAdmin,
  table: string,
  organizationId: string,
  brandId: string,
  values: Record<string, unknown>[],
) {
  await upsertOrThrow(supabase, table, values);
  const { data, error } = await supabase.from(table).select("id")
    .eq("organization_id", organizationId).eq("brand_id", brandId);
  if (error) throw new Error(error.message);
  const desired = new Set(values.map((item) => text(item.id)));
  const stale = rows(data).map((item) => text(item.id)).filter((id) => !desired.has(id));
  if (!stale.length) return;
  const deletion = await supabase.from(table).delete().eq("organization_id", organizationId).in("id", stale);
  if (deletion.error) throw new Error(deletion.error.message);
}

async function syncQuestionRows(
  supabase: SupabaseAdmin,
  organizationId: string,
  brandId: string,
  values: Record<string, unknown>[],
) {
  await upsertOrThrow(supabase, "detection_questions", values);
  const { data, error } = await supabase.from("detection_questions").select("id")
    .eq("organization_id", organizationId).eq("brand_id", brandId).eq("enabled", true);
  if (error) throw new Error(error.message);
  const desired = new Set(values.map((item) => text(item.id)));
  const stale = rows(data).map((item) => text(item.id)).filter((id) => !desired.has(id));
  if (!stale.length) return;
  const disabled = await supabase.from("detection_questions").update({ enabled: false })
    .eq("organization_id", organizationId).in("id", stale);
  if (disabled.error) throw new Error(disabled.error.message);
}

function requireOrganization(account: AccountContext) {
  if (!account.organizationId) throw new Error("账号尚未分配组织");
  return account.organizationId;
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value as Row[] : [];
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeQuestionSource(value: unknown): DetectionQuestion["source"] {
  return value === "industry" || value === "custom" ? value : "generated";
}

function safeObjectName(fileName: string) {
  return fileName.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(-160) || "attachment";
}
