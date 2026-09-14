import "server-only";

import type { AccountContext } from "@/lib/auth/types";
import { saveBrandSnapshots } from "@/lib/server/brand-repository";
import { saveOptimizationSnapshots } from "@/lib/server/optimization-repository";
import { validateWorkspaceWriteSnapshot } from "@/lib/server/workspace-write-rules";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { WorkspaceSaveScope, WorkspaceWriteSnapshot } from "@/lib/workspace";

/** 编排工作区窄写入；具体领域表只能由相应领域仓储落库。 */
export async function saveWorkspaceSnapshot(
  account: AccountContext,
  snapshot: WorkspaceWriteSnapshot,
  requestedScopes: WorkspaceSaveScope[],
  expectedRevision: string,
) {
  const organizationId = account.organizationId;
  if (!organizationId) throw new Error("账号尚未分配组织");
  const scopes = new Set(requestedScopes);
  validateWorkspaceWriteSnapshot(snapshot, scopes);
  const hasScope = (scope: WorkspaceSaveScope) => scopes.has(scope);
  const supabase = createSupabaseAdminClient();
  const requiresRevision = hasScope("brands") || hasScope("cycles") || hasScope("contents");
  const workspaceRevision = requiresRevision
    ? await claimWorkspaceRevision(supabase, organizationId, expectedRevision)
    : await readWorkspaceRevision(supabase, organizationId);

  if (hasScope("brands")) {
    await saveBrandSnapshots(account, snapshot.brands);
  }

  if (hasScope("cycles") || hasScope("contents")) {
    await saveOptimizationSnapshots(account, {
      cycles: hasScope("cycles") ? snapshot.cycles : undefined,
      contents: hasScope("contents") ? snapshot.contents : undefined,
    });
  }

  if (hasScope("currentBrand")) {
    if (snapshot.currentBrandId) {
      const brandResult = await supabase.from("brands").select("id")
        .eq("organization_id", organizationId)
        .eq("id", snapshot.currentBrandId)
        .is("deleted_at", null)
        .maybeSingle();
      if (brandResult.error) throw new Error(brandResult.error.message);
      if (!brandResult.data) throw new Error("当前品牌不属于本工作空间");
    }
    const preferenceResult = await supabase.from("user_preferences").upsert({
      user_id: account.userId,
      organization_id: organizationId,
      active_brand_id: snapshot.currentBrandId || null,
    }, { onConflict: "user_id" });
    if (preferenceResult.error) throw new Error(preferenceResult.error.message);
  }

  const auditResult = await supabase.from("audit_logs").insert({
    organization_id: organizationId,
    user_id: account.userId,
    action: "workspace.sync",
    entity_type: "workspace",
    metadata: {
      scopes: [...scopes],
      brand_count: snapshot.brands.length,
      cycle_count: snapshot.cycles.length,
      content_count: snapshot.contents.length,
    },
  });
  if (auditResult.error) throw new Error(auditResult.error.message);
  return { workspaceRevision };
}

export class WorkspaceConflictError extends Error {
  readonly status = 409;

  constructor(message = "工作空间已被其他用户更新，请刷新后重新操作") {
    super(message);
    this.name = "WorkspaceConflictError";
  }
}

async function claimWorkspaceRevision(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  organizationId: string,
  expectedRevision: string,
) {
  if (!expectedRevision) throw new WorkspaceConflictError("缺少工作空间版本，请刷新后重新操作");
  const claimed = await supabase.from("organizations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", organizationId)
    .eq("updated_at", expectedRevision)
    .select("updated_at")
    .maybeSingle();
  if (claimed.error) throw new Error(claimed.error.message);
  if (!claimed.data) throw new WorkspaceConflictError();
  return String(claimed.data.updated_at || "");
}

async function readWorkspaceRevision(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  organizationId: string,
) {
  const result = await supabase.from("organizations").select("updated_at")
    .eq("id", organizationId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("工作空间不存在");
  return String(result.data.updated_at || "");
}
