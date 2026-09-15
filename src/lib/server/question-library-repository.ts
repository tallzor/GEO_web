import "server-only";

import type { AccountContext } from "@/lib/auth/types";
import { assertWorkspaceOwner } from "@/lib/auth/workspace-permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { DetectionQuestion } from "@/lib/types";
import { WorkspaceAccessError } from "@/lib/server/workspace-access";
import { assertUuid } from "@/lib/server/workspace-write-rules";

type Row = Record<string, unknown>;

export async function listBrandQuestions(account: AccountContext, brandId: string) {
  const organizationId = requireOrganization(account);
  assertUuid(brandId, "品牌ID");
  const result = await createSupabaseAdminClient().from("detection_questions").select("*")
    .eq("organization_id", organizationId).eq("brand_id", brandId)
    .order("created_at", { ascending: false });
  if (result.error) throw new Error(result.error.message);
  return rows(result.data).map(mapQuestion);
}

export async function addManualQuestion(account: AccountContext, input: {
  brandId: string;
  subjectType: "brand" | "product";
  subjectId: string;
  text: string;
  persona: string;
  decisionScenario: string;
}) {
  assertWorkspaceOwner(account, "添加检测问题");
  const organizationId = requireOrganization(account);
  assertUuid(input.brandId, "品牌ID");
  assertUuid(input.subjectId, "检测对象ID");
  const supabase = createSupabaseAdminClient();
  const created = await supabase.rpc("create_manual_detection_question", {
    target_organization_id: organizationId,
    target_brand_id: input.brandId,
    target_subject_type: input.subjectType,
    target_subject_id: input.subjectId,
    question_text: input.text,
    question_persona: input.persona,
    question_scenario: input.decisionScenario,
    actor_id: account.userId,
  });
  if (created.error) throw new Error(created.error.message);
  const id = text(created.data);
  const result = await supabase.from("detection_questions").select("*")
    .eq("organization_id", organizationId).eq("id", id).maybeSingle();
  if (result.error || !result.data) throw new Error(result.error?.message || "检测问题保存失败");
  return mapQuestion(result.data as Row);
}

export async function setQuestionEnabled(account: AccountContext, questionId: string, enabled: boolean) {
  assertWorkspaceOwner(account, enabled ? "启用检测问题" : "停用检测问题");
  const organizationId = requireOrganization(account);
  assertUuid(questionId, "检测问题ID");
  const result = await createSupabaseAdminClient().from("detection_questions")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("organization_id", organizationId).eq("id", questionId)
    .select("*").maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new WorkspaceAccessError("检测问题不存在", 404);
  return mapQuestion(result.data as Row);
}

export async function deleteQuestionPermanently(account: AccountContext, questionId: string) {
  assertWorkspaceOwner(account, "删除检测问题");
  const organizationId = requireOrganization(account);
  assertUuid(questionId, "检测问题ID");
  const supabase = createSupabaseAdminClient();
  const existing = await supabase.from("detection_questions")
    .select("id,brand_id,subject_type,product_id,source")
    .eq("organization_id", organizationId).eq("id", questionId).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (!existing.data) throw new WorkspaceAccessError("检测问题不存在", 404);
  const deleted = await supabase.from("detection_questions").delete()
    .eq("organization_id", organizationId).eq("id", questionId).select("id").maybeSingle();
  if (deleted.error) throw new Error(deleted.error.message);
  if (!deleted.data) throw new Error("检测问题删除未生效");
  await supabase.from("audit_logs").insert({
    organization_id: organizationId,
    user_id: account.userId,
    action: "detection_question.deleted",
    entity_type: "detection_question",
    entity_id: questionId,
    metadata: {
      brandId: text(existing.data.brand_id),
      subjectType: text(existing.data.subject_type),
      subjectId: text(existing.data.product_id) || text(existing.data.brand_id),
      source: text(existing.data.source),
    },
  });
}

export function mapQuestion(row: Row): DetectionQuestion {
  const brandId = text(row.brand_id);
  const subjectType = text(row.subject_type) === "product" ? "product" : "brand";
  return {
    id: text(row.id),
    text: text(row.text),
    subjectType,
    subjectId: subjectType === "product" ? text(row.product_id) : brandId,
    persona: text(row.persona) || "旧数据迁移",
    decisionScenario: text(row.decision_scenario) || "历史检测场景",
    source: normalizeSource(row.source),
    enabled: row.enabled !== false,
    createdAt: text(row.created_at) || text(row.updated_at),
    updatedAt: text(row.updated_at) || text(row.created_at),
  };
}

function normalizeSource(value: unknown): DetectionQuestion["source"] {
  return value === "simulator" || value === "manual" ? value : "legacy";
}

function requireOrganization(account: AccountContext) {
  if (!account.organizationId) throw new Error("账号尚未分配组织");
  return account.organizationId;
}

function rows(value: unknown): Row[] { return Array.isArray(value) ? value as Row[] : []; }
function text(value: unknown) { return typeof value === "string" ? value : ""; }
