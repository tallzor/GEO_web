import "server-only";

import type { AccountContext } from "@/lib/auth/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  Brand,
  ContentItem,
  OptimizationCycle,
  OptimizationTask,
  PublishBatch,
  PublishingPlatform,
  PublishRecord,
} from "@/lib/types";
import type { WorkspaceSnapshot } from "@/lib/workspace";

type Row = Record<string, unknown>;

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value as Row[] : [];
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function optionalText(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function sortedRows(source: unknown, field: string, descending = false) {
  return rows(source).sort((left, right) => {
    const leftValue = left[field];
    const rightValue = right[field];
    const comparison = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue ?? "").localeCompare(String(rightValue ?? ""));
    return descending ? -comparison : comparison;
  });
}

/** 组合各领域数据供工作台启动读取；该投影不接受反向整包写入。 */
export async function loadWorkspaceSnapshot(account: AccountContext): Promise<WorkspaceSnapshot> {
  const organizationId = account.organizationId;
  if (!organizationId) throw new Error("账号尚未分配组织");
  const supabase = createSupabaseAdminClient();

  const [
    organizationQuery,
    brandsQuery,
    cyclesQuery,
    contentsQuery,
    publishBatchesQuery,
    publishRecordsQuery,
    accountsQuery,
    preferenceQuery,
  ] = await Promise.all([
    supabase.from("organizations").select("updated_at").eq("id", organizationId).maybeSingle(),
    supabase.from("brands").select(`
      *,
      stores:brand_stores(*),
      products:brand_products(*),
      competitors:brand_competitors(*),
      knowledge:brand_knowledge_files(*),
      questions:detection_questions(*)
    `).eq("organization_id", organizationId).is("deleted_at", null).order("created_at"),
    supabase.from("optimization_cycles").select("*, tasks:optimization_tasks(*)").eq("organization_id", organizationId).order("created_at"),
    supabase.from("contents").select("*, versions:content_versions(*)").eq("organization_id", organizationId).order("created_at"),
    supabase.from("publish_batches").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("publish_records").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("publishing_accounts").select("id,organization_id,brand_id,channel,name,account_name,mode,status,app_id_masked,draft_enabled,connection_status,connection_mode,default_cover_object_path,extension_version,last_connected_at,verified_at,error,created_at,updated_at").eq("organization_id", organizationId),
    supabase.from("user_preferences").select("active_brand_id").eq("user_id", account.userId).maybeSingle(),
  ]);

  const queryErrors = [
    organizationQuery.error,
    brandsQuery.error,
    cyclesQuery.error,
    contentsQuery.error,
    publishBatchesQuery.error,
    publishRecordsQuery.error,
    accountsQuery.error,
    preferenceQuery.error,
  ].filter(Boolean);
  if (queryErrors.length) throw new Error(queryErrors[0]?.message || "工作空间数据读取失败");

  const brands: Brand[] = rows(brandsQuery.data).map((row) => {
    const id = text(row.id);
    return {
      id,
      name: text(row.name),
      shortName: text(row.short_name),
      characteristics: text(row.characteristics),
      categoryName: text(row.category_name),
      trustProof: text(row.trust_proof),
      positioningStatement: text(row.positioning_statement),
      industry: text(row.industry),
      website: text(row.website),
      intro: text(row.intro),
      city: text(row.city),
      serviceArea: text(row.service_area),
      targetAudience: text(row.target_audience),
      stores: sortedRows(row.stores, "sort_order").map((item) => ({
        id: text(item.id),
        name: text(item.name),
        address: text(item.address),
      })),
      products: sortedRows(row.products, "sort_order").map((item) => ({
        id: text(item.id),
        name: text(item.name),
        type: text(item.type),
        description: text(item.description),
        price: text(item.price),
        features: text(item.features),
        audience: text(item.audience),
        updatedAt: text(item.updated_at),
      })),
      competitors: sortedRows(row.competitors, "sort_order").map((item) => ({
        id: text(item.id),
        name: text(item.name),
        description: text(item.description),
      })),
      knowledge: sortedRows(row.knowledge, "created_at", true).map((item) => ({
        id: text(item.id),
        fileName: text(item.file_name),
        fileType: text(item.file_type),
        sizeLabel: text(item.size_label),
        status: text(item.status) as Brand["knowledge"][number]["status"],
        factCount: numberValue(item.fact_count),
        uploadedAt: text(item.created_at),
        error: optionalText(item.error),
      })),
      questions: sortedRows(row.questions, "updated_at", true).filter((item) => item.enabled !== false).map((item) => ({
        id: text(item.id),
        text: text(item.text),
        source: text(item.source) as Brand["questions"][number]["source"],
        category: text(item.category),
        enabled: item.enabled !== false,
        updatedAt: text(item.updated_at),
      })),
      questionContextUpdatedAt: optionalText(row.question_context_updated_at),
      questionsGeneratedAt: optionalText(row.questions_generated_at),
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
    };
  });

  const activeBrandIds = new Set(brands.map((brand) => brand.id));
  const contentRows = rows(contentsQuery.data).filter((row) => activeBrandIds.has(text(row.brand_id)));
  const contentIdByTask = new Map(contentRows.map((row) => [text(row.task_id), text(row.id)]));
  const cycles: OptimizationCycle[] = rows(cyclesQuery.data).filter((row) => activeBrandIds.has(text(row.brand_id))).map((row) => {
    const id = text(row.id);
    return {
      id,
      brandId: text(row.brand_id),
      detectionId: text(row.detection_id),
      suggestionId: text(row.suggestion_id),
      dimension: text(row.dimension) as OptimizationCycle["dimension"],
      target: text(row.target_snapshot),
      description: text(row.description_snapshot),
      status: text(row.status) as OptimizationCycle["status"],
      currentDay: numberValue(row.current_day, 1),
      startDate: text(row.start_date),
      endDate: text(row.end_date),
      terminatedAt: optionalText(row.terminated_at),
      tasks: sortedRows(row.tasks, "sort_order").sort((left, right) => numberValue(left.day) - numberValue(right.day)).map((task) => ({
        id: text(task.id),
        cycleId: id,
        day: numberValue(task.day, 1),
        title: text(task.title),
        description: text(task.description),
        type: text(task.type) as OptimizationTask["type"],
        delivery: text(task.delivery) as OptimizationTask["delivery"],
        channel: optionalText(task.channel) as OptimizationTask["channel"],
        contentTitle: optionalText(task.content_title),
        requiredFields: stringArray(task.required_fields),
        materialRoute: optionalText(task.material_route),
        status: text(task.status) as OptimizationTask["status"],
        contentId: contentIdByTask.get(text(task.id)),
        completedAt: optionalText(task.completed_at),
      })),
    };
  });

  const contents: ContentItem[] = contentRows.map((row) => {
    const currentVersion = numberValue(row.current_version, 1);
    const version = sortedRows(row.versions, "version").find((item) => numberValue(item.version) === currentVersion);
    return {
      id: text(row.id),
      brandId: text(row.brand_id),
      cycleId: text(row.cycle_id),
      taskId: text(row.task_id),
      title: text(row.title),
      body: text(row.body),
      selectedChannel: text(row.selected_channel) as ContentItem["selectedChannel"],
      channels: jsonArray<ContentItem["channels"][number]>(version?.channels),
      version: currentVersion,
      status: text(row.status) as ContentItem["status"],
      riskStatus: text(row.risk_status) as ContentItem["riskStatus"],
      riskIssues: jsonArray<ContentItem["riskIssues"][number]>(row.risk_issues),
      generationSource: optionalText(version?.generated_by) as ContentItem["generationSource"],
      generationModel: optionalText(version?.generation_model),
      promptVersion: optionalText(version?.prompt_version),
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
    };
  });

  const publishRecords: PublishRecord[] = rows(publishRecordsQuery.data).filter((row) => activeBrandIds.has(text(row.brand_id))).map((row) => ({
    id: text(row.id),
    batchId: optionalText(row.batch_id),
    brandId: text(row.brand_id),
    cycleId: text(row.cycle_id),
    taskId: text(row.task_id),
    contentId: text(row.content_id),
    contentVersion: numberValue(row.content_version, 1),
    title: text(row.title_snapshot),
    bodySnapshot: text(row.body_snapshot),
    channel: text(row.channel) as PublishRecord["channel"],
    accountName: text(row.account_name_snapshot),
    status: text(row.status) as PublishRecord["status"],
    attemptCount: numberValue(row.attempt_count),
    externalDraftId: optionalText(row.external_draft_id),
    externalDraftUrl: optionalText(row.external_draft_url),
    errorCode: optionalText(row.error_code),
    startedAt: optionalText(row.started_at),
    createdAt: text(row.created_at),
    completedAt: optionalText(row.completed_at),
    error: optionalText(row.error),
  }));

  const publishBatches: PublishBatch[] = rows(publishBatchesQuery.data).filter((row) => activeBrandIds.has(text(row.brand_id))).map((row) => ({
    id: text(row.id),
    brandId: text(row.brand_id),
    taskId: text(row.task_id),
    contentId: text(row.content_id),
    contentVersion: numberValue(row.content_version, 1),
    idempotencyKey: text(row.idempotency_key),
    status: text(row.status) as PublishBatch["status"],
    successCount: numberValue(row.success_count),
    failureCount: numberValue(row.failure_count),
    createdAt: text(row.created_at),
    completedAt: optionalText(row.completed_at),
    records: publishRecords.filter((record) => record.batchId === text(row.id)),
  }));

  const platforms: PublishingPlatform[] = rows(accountsQuery.data).filter((row) => activeBrandIds.has(text(row.brand_id))).map((row) => ({
    id: text(row.id),
    brandId: text(row.brand_id),
    channel: text(row.channel) as PublishingPlatform["channel"],
    name: text(row.name),
    configured: text(row.status) === "configured",
    accountName: text(row.account_name),
    verifiedAt: text(row.verified_at),
    mode: text(row.mode) as PublishingPlatform["mode"],
    appIdMasked: optionalText(row.app_id_masked),
    draftEnabled: row.draft_enabled === true,
    connectionStatus: text(row.connection_status) as PublishingPlatform["connectionStatus"],
    connectionMode: text(row.connection_mode) as PublishingPlatform["connectionMode"],
    availability: text(row.channel) === "xiaohongshu" ? "coming_soon" : "available",
    defaultCoverObjectPath: optionalText(row.default_cover_object_path),
    extensionVersion: optionalText(row.extension_version),
    lastConnectedAt: optionalText(row.last_connected_at),
    error: optionalText(row.error),
  }));
  for (const brand of brands) {
    for (const fallback of defaultPlatforms(brand.id)) {
      if (!platforms.some((platform) => platform.brandId === brand.id && platform.channel === fallback.channel)) {
        platforms.push(fallback);
      }
    }
  }

  const preferredBrandId = text((preferenceQuery.data as Row | null)?.active_brand_id);
  const currentBrandId = brands.some((brand) => brand.id === preferredBrandId)
    ? preferredBrandId
    : brands[0]?.id || "";

  return {
    workspaceRevision: text((organizationQuery.data as Row | null)?.updated_at),
    user: {
      id: account.userId,
      name: account.displayName,
      phone: account.phone,
      email: account.email,
    },
    brands,
    currentBrandId,
    detections: [],
    cycles,
    contents,
    publishBatches,
    publishRecords,
    platforms,
  };
}

function defaultPlatforms(brandId: string): PublishingPlatform[] {
  return [
    { brandId, channel: "wechat", name: "公众号", configured: false, accountName: "", verifiedAt: "", mode: "real", draftEnabled: false, connectionStatus: "disconnected", connectionMode: "server_api", availability: "available" },
    { brandId, channel: "zhihu", name: "知乎", configured: false, accountName: "", verifiedAt: "", mode: "real", connectionStatus: "disconnected", connectionMode: "browser_extension", availability: "available" },
    { brandId, channel: "xiaohongshu", name: "小红书", configured: false, accountName: "", verifiedAt: "", mode: "real", connectionStatus: "disconnected", connectionMode: "unavailable", availability: "coming_soon" },
  ];
}
