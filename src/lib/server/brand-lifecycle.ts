import "server-only";

import type { AccountContext } from "@/lib/auth/types";
import {
  BRAND_NAME_MISMATCH_MESSAGE,
  getBrandDeletionBlockMessage,
  isExactBrandName,
  type BrandProcessCounts,
} from "@/lib/brand-deletion";
import { assertWorkspaceOwner } from "@/lib/auth/workspace-permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export class BrandLifecycleError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = "BrandLifecycleError";
  }
}

async function countRows(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>,
) {
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count || 0;
}

export async function softDeleteBrand(
  account: AccountContext,
  brandId: string,
  confirmedName: string,
) {
  const owner = assertWorkspaceOwner(account, "删除品牌");
  const supabase = createSupabaseAdminClient();
  const { data: brand, error: brandError } = await supabase
    .from("brands")
    .select("id,name")
    .eq("organization_id", owner.organizationId)
    .eq("id", brandId)
    .is("deleted_at", null)
    .maybeSingle();

  if (brandError) throw new Error(brandError.message);
  if (!brand) throw new BrandLifecycleError("品牌不存在或已删除", 404, "BRAND_NOT_FOUND");
  if (!isExactBrandName(confirmedName, brand.name)) {
    throw new BrandLifecycleError(BRAND_NAME_MISMATCH_MESSAGE, 400, "BRAND_NAME_MISMATCH");
  }

  const [optimizationCycles, detections, publishBatches, publishRecords, backgroundJobs] = await Promise.all([
    countRows(supabase.from("optimization_cycles").select("id", { count: "exact", head: true })
      .eq("organization_id", owner.organizationId).eq("brand_id", brandId).eq("status", "active")),
    countRows(supabase.from("detections").select("id", { count: "exact", head: true })
      .eq("organization_id", owner.organizationId).eq("brand_id", brandId)
      .in("stage", ["queued", "collecting", "analyzing", "aggregating"])),
    countRows(supabase.from("publish_batches").select("id", { count: "exact", head: true })
      .eq("organization_id", owner.organizationId).eq("brand_id", brandId)
      .in("status", ["queued", "running"])),
    countRows(supabase.from("publish_records").select("id", { count: "exact", head: true })
      .eq("organization_id", owner.organizationId).eq("brand_id", brandId)
      .in("status", ["queued", "syncing", "publishing"])),
    countRows(supabase.from("background_jobs").select("id", { count: "exact", head: true })
      .eq("organization_id", owner.organizationId).eq("brand_id", brandId)
      .in("status", ["pending", "running"])),
  ]);
  const processCounts: BrandProcessCounts = {
    optimizationCycles,
    detections,
    publishBatches,
    publishRecords,
    backgroundJobs,
  };
  const blockedReason = getBrandDeletionBlockMessage(processCounts);
  if (blockedReason) {
    throw new BrandLifecycleError(blockedReason, 409, "BRAND_HAS_ACTIVE_PROCESS");
  }

  const deletedAt = new Date().toISOString();
  const { error: deleteError } = await supabase.from("brands").update({
    deleted_at: deletedAt,
    deleted_by: owner.userId,
    updated_at: deletedAt,
    updated_by: owner.userId,
  }).eq("organization_id", owner.organizationId).eq("id", brandId).is("deleted_at", null);
  if (deleteError) throw new Error(deleteError.message);

  const { data: fallbackBrand, error: fallbackError } = await supabase.from("brands")
    .select("id")
    .eq("organization_id", owner.organizationId)
    .is("deleted_at", null)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (fallbackError) throw new Error(fallbackError.message);
  const activeBrandId = fallbackBrand?.id || null;

  const preferenceResult = await supabase.from("user_preferences")
    .update({ active_brand_id: activeBrandId })
    .eq("organization_id", owner.organizationId)
    .eq("active_brand_id", brandId);
  if (preferenceResult.error) throw new Error(preferenceResult.error.message);

  const auditResult = await supabase.from("audit_logs").insert({
    organization_id: owner.organizationId,
    user_id: owner.userId,
    action: "brand.soft_delete",
    entity_type: "brand",
    entity_id: brandId,
    metadata: { brand_name: brand.name, deleted_at: deletedAt },
  });
  if (auditResult.error) throw new Error(auditResult.error.message);

  return { activeBrandId, processCounts };
}
