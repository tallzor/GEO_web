import "server-only";

import { assertWorkspaceOwner } from "@/lib/auth/workspace-permissions";
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
import type { WorkspaceSaveScope, WorkspaceSnapshot } from "@/lib/workspace";

type Row = Record<string, unknown>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function assertUuid(value: string, field: string) {
  if (!uuidPattern.test(value)) throw new Error(`${field}不是有效的数据ID`);
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

export async function loadWorkspaceSnapshot(account: AccountContext): Promise<WorkspaceSnapshot> {
  const organizationId = account.organizationId;
  if (!organizationId) throw new Error("账号尚未分配组织");
  const supabase = createSupabaseAdminClient();

  const [
    brandsQuery,
    cyclesQuery,
    contentsQuery,
    publishBatchesQuery,
    publishRecordsQuery,
    accountsQuery,
    preferenceQuery,
  ] = await Promise.all([
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
    const id = text(row.id);
    const currentVersion = numberValue(row.current_version, 1);
    const version = sortedRows(row.versions, "version").find((item) => numberValue(item.version) === currentVersion);
    return {
      id,
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

export async function createOptimizationCycle(
  account: AccountContext,
  requestedCycle: OptimizationCycle,
): Promise<OptimizationCycle> {
  const organizationId = account.organizationId;
  if (!organizationId) throw new Error("账号尚未分配组织");
  validateOptimizationCycle(requestedCycle);
  const supabase = createSupabaseAdminClient();

  const existingResult = await supabase.from("optimization_cycles")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("brand_id", requestedCycle.brandId)
    .eq("status", "active")
    .maybeSingle();
  if (existingResult.error) throw new Error(existingResult.error.message);
  if (existingResult.data) return loadExistingCycle(account, text(existingResult.data.id));

  const suggestionResult = await supabase.from("optimization_suggestions")
    .select("id,brand_id,detection_id,dimension,title,description,reason")
    .eq("organization_id", organizationId)
    .eq("id", requestedCycle.suggestionId)
    .maybeSingle();
  if (suggestionResult.error) throw new Error(suggestionResult.error.message);
  if (!suggestionResult.data) throw new Error("优化建议不属于当前组织");
  const source = suggestionResult.data as Row;
  if (text(source.brand_id) !== requestedCycle.brandId || text(source.detection_id) !== requestedCycle.detectionId) {
    throw new Error("优化目标与检测来源不匹配");
  }

  const cycle: OptimizationCycle = {
    ...requestedCycle,
    dimension: text(source.dimension) as OptimizationCycle["dimension"],
    target: text(source.title),
    description: text(source.description),
  };
  const cycleInsert = await supabase.from("optimization_cycles").insert(
    cycleRow(cycle, source, organizationId, account.userId),
  );
  if (cycleInsert.error) {
    if (cycleInsert.error.code === "23505") {
      const concurrent = await supabase.from("optimization_cycles").select("id")
        .eq("organization_id", organizationId).eq("brand_id", cycle.brandId).eq("status", "active").maybeSingle();
      if (concurrent.data) return loadExistingCycle(account, text(concurrent.data.id));
    }
    throw new Error(cycleInsert.error.message);
  }

  try {
    const taskInsert = await supabase.from("optimization_tasks").insert(cycle.tasks.map((task, index) => ({
      id: task.id,
      organization_id: organizationId,
      brand_id: cycle.brandId,
      cycle_id: cycle.id,
      day: task.day,
      sort_order: index,
      title: task.title,
      description: task.description,
      type: task.type,
      delivery: task.delivery,
      channel: task.channel || null,
      content_title: task.contentTitle || null,
      required_fields: task.requiredFields || [],
      material_route: task.materialRoute || null,
      status: task.status,
      completed_at: task.completedAt || null,
    })));
    if (taskInsert.error) throw new Error(taskInsert.error.message);

    const suggestionUpdate = await supabase.from("optimization_suggestions")
      .update({ selected: true, selected_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .eq("id", cycle.suggestionId);
    if (suggestionUpdate.error) throw new Error(suggestionUpdate.error.message);
  } catch (error) {
    await supabase.from("optimization_cycles").delete()
      .eq("organization_id", organizationId)
      .eq("id", cycle.id);
    throw error;
  }

  return cycle;
}

export async function saveGeneratedContent(
  account: AccountContext,
  content: ContentItem,
) {
  const organizationId = account.organizationId;
  if (!organizationId) throw new Error("账号尚未分配组织");
  assertUuid(content.id, "内容ID");
  assertUuid(content.brandId, "内容品牌ID");
  assertUuid(content.cycleId, "内容周期ID");
  assertUuid(content.taskId, "内容任务ID");
  const supabase = createSupabaseAdminClient();
  const taskResult = await supabase.from("optimization_tasks")
    .select("id,brand_id,cycle_id,status")
    .eq("organization_id", organizationId)
    .eq("id", content.taskId)
    .maybeSingle();
  if (taskResult.error) throw new Error(taskResult.error.message);
  const task = taskResult.data as Row | null;
  if (!task
    || text(task.brand_id) !== content.brandId
    || text(task.cycle_id) !== content.cycleId) {
    throw new Error("内容任务不属于当前组织或数据归属不匹配");
  }

  const contentResult = await supabase.from("contents").upsert({
    id: content.id,
    organization_id: organizationId,
    brand_id: content.brandId,
    cycle_id: content.cycleId,
    task_id: content.taskId,
    title: content.title,
    body: content.body,
    selected_channel: content.selectedChannel,
    current_version: content.version,
    status: content.status,
    risk_status: content.riskStatus,
    risk_issues: content.riskIssues,
    created_at: content.createdAt,
    updated_at: content.updatedAt,
  }, { onConflict: "id" });
  if (contentResult.error) throw new Error(contentResult.error.message);

  const versionResult = await supabase.from("content_versions").upsert({
    organization_id: organizationId,
    brand_id: content.brandId,
    content_id: content.id,
    version: content.version,
    title: content.title,
    body: content.body,
    channels: content.channels,
    generated_by: content.generationSource || "foundation_model",
    generation_model: content.generationModel || null,
    prompt_version: content.promptVersion || null,
    created_by: account.userId,
  }, { onConflict: "content_id,version" });
  if (versionResult.error) throw new Error(versionResult.error.message);

  if (text(task.status) === "pending") {
    const taskUpdate = await supabase.from("optimization_tasks")
      .update({ status: "in_progress" })
      .eq("organization_id", organizationId)
      .eq("id", content.taskId);
    if (taskUpdate.error) throw new Error(taskUpdate.error.message);
  }
}

async function loadExistingCycle(account: AccountContext, cycleId: string) {
  const snapshot = await loadWorkspaceSnapshot(account);
  const cycle = snapshot.cycles.find((item) => item.id === cycleId);
  if (!cycle) throw new Error("已有优化任务存在，但加载失败");
  return cycle;
}

const allWorkspaceScopes: WorkspaceSaveScope[] = [
  "user", "brands", "currentBrand", "cycles", "contents", "publishRecords", "platforms",
];

export async function saveWorkspaceSnapshot(
  account: AccountContext,
  snapshot: WorkspaceSnapshot,
  requestedScopes: WorkspaceSaveScope[] = allWorkspaceScopes,
) {
  const organizationId = account.organizationId;
  if (!organizationId) throw new Error("账号尚未分配组织");
  validateSnapshot(snapshot);
  const supabase = createSupabaseAdminClient();
  const scopes = new Set(requestedScopes);
  const hasScope = (scope: WorkspaceSaveScope) => scopes.has(scope);
  const brandIds = new Set(snapshot.brands.map((brand) => brand.id));
  if (snapshot.currentBrandId && !brandIds.has(snapshot.currentBrandId)) {
    throw new Error("当前品牌不属于本工作空间");
  }
  await assertWorkspaceOwnership(supabase, organizationId, snapshot, scopes);

  if (hasScope("brands") && snapshot.brands.length) {
    const snapshotBrandIds = snapshot.brands.map((brand) => brand.id);
    const { data: existingBrandData, error: existingBrandError } = await supabase
      .from("brands")
      .select("id,deleted_at")
      .eq("organization_id", organizationId)
      .in("id", snapshotBrandIds);
    if (existingBrandError) throw new Error(existingBrandError.message);
    const existingRows = rows(existingBrandData);
    const deletedBrandIds = new Set(existingRows.filter((row) => Boolean(row.deleted_at)).map((row) => text(row.id)));
    if (snapshotBrandIds.some((id) => deletedBrandIds.has(id))) {
      throw new Error("工作空间包含已删除品牌，请重新加载后再操作");
    }
    const existingActiveIds = new Set(existingRows.map((row) => text(row.id)));
    if (snapshotBrandIds.some((id) => !existingActiveIds.has(id))) {
      assertWorkspaceOwner(account, "创建品牌");
    }
  }

  if (hasScope("user")) {
    const profileResult = await supabase.from("profiles").update({
      display_name: snapshot.user.name,
      phone: snapshot.user.phone || null,
      updated_at: new Date().toISOString(),
    }).eq("id", account.userId);
    if (profileResult.error) throw new Error(profileResult.error.message);
  }

  if (hasScope("brands")) {
    const brandRows = snapshot.brands.map((brand) => ({
    id: brand.id,
    organization_id: organizationId,
    name: brand.name.trim(),
    short_name: brand.shortName || null,
    characteristics: brand.characteristics || null,
    category_name: brand.categoryName || null,
    trust_proof: brand.trustProof || null,
    positioning_statement: brand.positioningStatement || null,
    industry: brand.industry || null,
    website: brand.website || null,
    intro: brand.intro || null,
    city: brand.city || null,
    service_area: brand.serviceArea || null,
    target_audience: brand.targetAudience || null,
    question_context_updated_at: brand.questionContextUpdatedAt || null,
    questions_generated_at: brand.questionsGeneratedAt || null,
    created_by: account.userId,
    updated_by: account.userId,
    created_at: brand.createdAt,
    updated_at: brand.updatedAt,
  }));
    await upsertOrThrow(supabase, "brands", brandRows);

    for (const brand of snapshot.brands) {
      await Promise.all([
      syncBrandRows(supabase, "brand_stores", organizationId, brand.id, brand.stores.map((item, index) => ({
        id: item.id, organization_id: organizationId, brand_id: brand.id, name: item.name, address: item.address, sort_order: index,
      }))),
      syncBrandRows(supabase, "brand_products", organizationId, brand.id, brand.products.map((item, index) => ({
        id: item.id, organization_id: organizationId, brand_id: brand.id, name: item.name, type: item.type || null,
        description: item.description || null, price: item.price || null, features: item.features || null,
        audience: item.audience || null, sort_order: index, updated_at: item.updatedAt,
      }))),
      syncBrandRows(supabase, "brand_competitors", organizationId, brand.id, brand.competitors.map((item, index) => ({
        id: item.id, organization_id: organizationId, brand_id: brand.id, name: item.name,
        description: item.description || null, sort_order: index,
      }))),
      syncBrandRows(supabase, "brand_knowledge_files", organizationId, brand.id, brand.knowledge.map((item) => ({
        id: item.id, organization_id: organizationId, brand_id: brand.id, file_name: item.fileName,
        file_type: item.fileType || null, object_path: `${organizationId}/${brand.id}/${item.id}/${safeObjectName(item.fileName)}`,
        size_label: item.sizeLabel || null, status: item.status, fact_count: item.factCount,
        error: item.error || null, uploaded_by: account.userId, created_at: item.uploadedAt,
      }))),
      syncQuestionRows(supabase, organizationId, brand.id, brand.questions.map((item) => ({
        id: item.id, organization_id: organizationId, brand_id: brand.id, text: item.text,
        source: item.source, category: item.category || null, enabled: item.enabled, updated_at: item.updatedAt,
      }))),
      ]);
    }
  }

  if (hasScope("cycles")) {
    const suggestionIds = [...new Set(snapshot.cycles.map((cycle) => cycle.suggestionId))];
  const { data: suggestionData, error: suggestionError } = suggestionIds.length
    ? await supabase.from("optimization_suggestions").select("id,brand_id,detection_id,dimension,title,description,reason")
      .eq("organization_id", organizationId).in("id", suggestionIds)
    : { data: [], error: null };
  if (suggestionError) throw new Error(suggestionError.message);
  const suggestionSources = new Map(rows(suggestionData).map((row) => [text(row.id), row]));
    await upsertOrThrow(supabase, "optimization_cycles", snapshot.cycles.map((cycle) => ({
      ...cycleRow(cycle, suggestionSources.get(cycle.suggestionId), organizationId, account.userId),
    })));
    await upsertOrThrow(supabase, "optimization_tasks", snapshot.cycles.flatMap((cycle) =>
      cycle.tasks.map((task, index) => ({
      id: task.id, organization_id: organizationId, brand_id: cycle.brandId, cycle_id: cycle.id,
      day: task.day, sort_order: index, title: task.title, description: task.description,
      type: task.type, delivery: task.delivery, channel: task.channel || null,
      content_title: task.contentTitle || null, required_fields: task.requiredFields || [],
      material_route: task.materialRoute || null, status: task.status, completed_at: task.completedAt || null,
      })),
    ));
  }

  if (hasScope("contents")) {
    await upsertOrThrow(supabase, "contents", snapshot.contents.map((content) => ({
    id: content.id, organization_id: organizationId, brand_id: content.brandId,
    cycle_id: content.cycleId, task_id: content.taskId, title: content.title, body: content.body,
    selected_channel: content.selectedChannel, current_version: content.version, status: content.status,
    risk_status: content.riskStatus, risk_issues: content.riskIssues,
    created_at: content.createdAt, updated_at: content.updatedAt,
  })));
    await upsertOrThrow(supabase, "content_versions", snapshot.contents.map((content) => ({
    organization_id: organizationId, brand_id: content.brandId, content_id: content.id,
    version: content.version, title: content.title, body: content.body, channels: content.channels,
    generated_by: content.generationSource || "foundation_model",
    generation_model: content.generationModel || null,
    prompt_version: content.promptVersion || null,
    created_by: account.userId,
    })), "content_id,version");
  }

  let savedAccounts: Row[] = [];
  if (hasScope("platforms") || hasScope("publishRecords")) {
    const { data: existingAccountData, error: existingAccountError } = await supabase
      .from("publishing_accounts")
      .select("id,brand_id,channel,account_name")
      .eq("organization_id", organizationId);
    if (existingAccountError) throw new Error(existingAccountError.message);
    savedAccounts = rows(existingAccountData);
  }
  if (hasScope("platforms")) {
    const existingAccounts = savedAccounts;
    savedAccounts = [];
    for (const platform of snapshot.platforms) {
      const brandId = platform.brandId || snapshot.currentBrandId;
      if (!brandIds.has(brandId)) throw new Error("发布账号关联了无权访问的品牌");
      const accountName = platform.accountName || `${platform.name}未配置账号`;
      const existingId = platform.id || text(existingAccounts.find((item) => (
        text(item.brand_id) === brandId && text(item.channel) === platform.channel
      ))?.id);
      const row = {
        ...(existingId ? { id: existingId } : {}),
        organization_id: organizationId,
        brand_id: brandId,
        channel: platform.channel,
        name: platform.name,
        account_name: accountName,
        mode: platform.mode || "demo",
        status: platform.configured ? "configured" : "unconfigured",
        app_id_masked: platform.appIdMasked || null,
        draft_enabled: platform.draftEnabled || false,
        connection_status: platform.connectionStatus || "disconnected",
        connection_mode: platform.connectionMode || (platform.channel === "zhihu" ? "browser_extension" : "server_api"),
        default_cover_object_path: platform.defaultCoverObjectPath || null,
        extension_version: platform.extensionVersion || null,
        last_connected_at: platform.lastConnectedAt || null,
        verified_at: platform.verifiedAt || null,
        error: platform.error || null,
      };
      const { data, error } = await supabase.from("publishing_accounts")
        .upsert(row, { onConflict: existingId ? "id" : "organization_id,brand_id,channel" })
        .select("id,brand_id,channel,account_name").single();
      if (error || !data) throw new Error(error?.message || "发布平台保存失败");
      savedAccounts.push(data as Row);
    }
  }

  if (hasScope("publishRecords")) {
    await upsertOrThrow(supabase, "publish_records", snapshot.publishRecords.map((record) => {
      const publishingAccount = savedAccounts.find((item) => (
        text(item.brand_id) === record.brandId && text(item.channel) === record.channel
      ));
      return {
        id: record.id, organization_id: organizationId, brand_id: record.brandId,
        batch_id: record.batchId || null,
        cycle_id: record.cycleId, task_id: record.taskId, content_id: record.contentId,
        content_version: record.contentVersion, title_snapshot: record.title,
        body_snapshot: record.bodySnapshot, channel: record.channel,
        publishing_account_id: text(publishingAccount?.id) || null, account_name_snapshot: record.accountName,
        status: record.status, attempt_count: record.attemptCount || 0,
        external_draft_id: record.externalDraftId || null,
        external_draft_url: record.externalDraftUrl || null,
        error_code: record.errorCode || null,
        started_at: record.startedAt || null,
        error: record.error || null, completed_at: record.completedAt || null,
        created_at: record.createdAt,
      };
    }));
  }

  if (hasScope("currentBrand")) {
    const preferenceResult = await supabase.from("user_preferences").upsert({
      user_id: account.userId,
      organization_id: organizationId,
      active_brand_id: snapshot.currentBrandId || null,
    }, { onConflict: "user_id" });
    if (preferenceResult.error) throw new Error(preferenceResult.error.message);
  }

  const selectedSuggestionIds = hasScope("cycles") ? snapshot.cycles.map((cycle) => cycle.suggestionId) : [];
  if (selectedSuggestionIds.length) {
    const selectedResult = await supabase.from("optimization_suggestions")
      .update({ selected: true, selected_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .in("id", selectedSuggestionIds);
    if (selectedResult.error) throw new Error(selectedResult.error.message);
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
}

function validateSnapshot(snapshot: WorkspaceSnapshot) {
  if (!snapshot || !Array.isArray(snapshot.brands) || !Array.isArray(snapshot.cycles)) {
    throw new Error("工作空间数据格式不正确");
  }
  if (snapshot.brands.length > 100) throw new Error("品牌数量超出限制");
  for (const brand of snapshot.brands) {
    assertUuid(brand.id, "品牌ID");
    if (!brand.name.trim()) throw new Error("品牌名称不能为空");
    [...brand.stores, ...brand.products, ...brand.competitors, ...brand.knowledge, ...brand.questions]
      .forEach((item) => assertUuid(item.id, "品牌子数据ID"));
  }
  snapshot.detections.forEach((item) => assertUuid(item.id, "检测ID"));
  snapshot.cycles.forEach(validateOptimizationCycle);
  const brandIds = new Set(snapshot.brands.map((brand) => brand.id));
  const cycleIds = new Set(snapshot.cycles.map((cycle) => cycle.id));
  const taskIds = new Set(snapshot.cycles.flatMap((cycle) => cycle.tasks.map((task) => task.id)));
  const contentIds = new Set(snapshot.contents.map((content) => content.id));
  snapshot.cycles.forEach((cycle) => {
    if (!brandIds.has(cycle.brandId)) throw new Error("优化周期品牌归属不正确");
  });
  snapshot.contents.forEach((content) => {
    assertUuid(content.id, "内容ID");
    if (!brandIds.has(content.brandId) || !cycleIds.has(content.cycleId) || !taskIds.has(content.taskId)) {
      throw new Error("内容任务归属不正确");
    }
  });
  snapshot.publishRecords.forEach((record) => {
    assertUuid(record.id, "发布记录ID");
    if (!brandIds.has(record.brandId) || !cycleIds.has(record.cycleId) || !taskIds.has(record.taskId) || !contentIds.has(record.contentId)) {
      throw new Error("发布记录归属不正确");
    }
  });
}

function validateOptimizationCycle(cycle: OptimizationCycle) {
  assertUuid(cycle.id, "优化周期ID");
  assertUuid(cycle.brandId, "优化周期品牌ID");
  assertUuid(cycle.detectionId, "优化周期检测ID");
  assertUuid(cycle.suggestionId, "优化建议ID");
  cycle.tasks.forEach((task) => {
    assertUuid(task.id, "优化任务ID");
    if (task.cycleId !== cycle.id) throw new Error("优化任务与周期归属不匹配");
  });
  const days = new Set(cycle.tasks.map((task) => task.day));
  if (cycle.tasks.length !== 7 || days.size !== 7 || [...days].some((day) => day < 1 || day > 7)) {
    throw new Error("7天优化任务结构不完整");
  }
}

function cycleRow(
  cycle: OptimizationCycle,
  source: Row | undefined,
  organizationId: string,
  userId: string,
) {
  if (!source
    || text(source.brand_id) !== cycle.brandId
    || text(source.detection_id) !== cycle.detectionId) {
    throw new Error("优化目标与检测来源不匹配");
  }
  return {
    id: cycle.id,
    organization_id: organizationId,
    brand_id: cycle.brandId,
    detection_id: cycle.detectionId,
    suggestion_id: cycle.suggestionId,
    dimension: text(source.dimension),
    target_snapshot: text(source.title),
    description_snapshot: text(source.description),
    reason_snapshot: text(source.reason),
    status: cycle.status,
    current_day: cycle.currentDay,
    start_date: cycle.startDate.slice(0, 10),
    end_date: cycle.endDate.slice(0, 10),
    terminated_at: cycle.terminatedAt || null,
    created_by: userId,
  };
}

async function assertWorkspaceOwnership(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  organizationId: string,
  snapshot: WorkspaceSnapshot,
  scopes: Set<WorkspaceSaveScope>,
) {
  const checks: Array<[string, string[]]> = [];
  if (scopes.has("brands")) checks.push(
    ["brands", snapshot.brands.map((item) => item.id)],
    ["brand_stores", snapshot.brands.flatMap((brand) => brand.stores.map((item) => item.id))],
    ["brand_products", snapshot.brands.flatMap((brand) => brand.products.map((item) => item.id))],
    ["brand_competitors", snapshot.brands.flatMap((brand) => brand.competitors.map((item) => item.id))],
    ["brand_knowledge_files", snapshot.brands.flatMap((brand) => brand.knowledge.map((item) => item.id))],
    ["detection_questions", snapshot.brands.flatMap((brand) => brand.questions.map((item) => item.id))],
  );
  if (scopes.has("cycles")) checks.push(
    ["optimization_cycles", snapshot.cycles.map((item) => item.id)],
    ["optimization_tasks", snapshot.cycles.flatMap((cycle) => cycle.tasks.map((item) => item.id))],
  );
  if (scopes.has("contents")) checks.push(["contents", snapshot.contents.map((item) => item.id)]);
  if (scopes.has("publishRecords")) checks.push(["publish_records", snapshot.publishRecords.map((item) => item.id)]);
  if (scopes.has("platforms")) checks.push(["publishing_accounts", snapshot.platforms.flatMap((item) => item.id ? [item.id] : [])]);
  for (const [table, ids] of checks) {
    if (!ids.length) continue;
    const { data, error } = await supabase.from(table).select("id,organization_id").in("id", ids);
    if (error) throw new Error(error.message);
    if (rows(data).some((row) => text(row.organization_id) !== organizationId)) {
      throw new Error("检测到不属于当前组织的数据ID");
    }
  }

  const detectionIds = scopes.has("cycles") ? [...new Set(snapshot.cycles.map((cycle) => cycle.detectionId))] : [];
  const suggestionIds = scopes.has("cycles") ? [...new Set(snapshot.cycles.map((cycle) => cycle.suggestionId))] : [];
  for (const [table, ids] of [["detections", detectionIds], ["optimization_suggestions", suggestionIds]] as const) {
    if (!ids.length) continue;
    const { data, error } = await supabase.from(table).select("id,organization_id").eq("organization_id", organizationId).in("id", ids);
    if (error) throw new Error(error.message);
    if (rows(data).length !== ids.length) throw new Error("优化目标来源数据不属于当前组织");
  }
}

async function upsertOrThrow(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  table: string,
  values: Record<string, unknown>[],
  onConflict = "id",
) {
  if (!values.length) return;
  const { error } = await supabase.from(table).upsert(values, { onConflict });
  if (error) throw new Error(error.message);
}

async function syncBrandRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
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
  supabase: ReturnType<typeof createSupabaseAdminClient>,
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

function defaultPlatforms(brandId: string): PublishingPlatform[] {
  return [
    { brandId, channel: "wechat", name: "公众号", configured: false, accountName: "", verifiedAt: "", mode: "real", draftEnabled: false, connectionStatus: "disconnected", connectionMode: "server_api", availability: "available" },
    { brandId, channel: "zhihu", name: "知乎", configured: false, accountName: "", verifiedAt: "", mode: "real", connectionStatus: "disconnected", connectionMode: "browser_extension", availability: "available" },
    { brandId, channel: "xiaohongshu", name: "小红书", configured: false, accountName: "", verifiedAt: "", mode: "real", connectionStatus: "disconnected", connectionMode: "unavailable", availability: "coming_soon" },
  ];
}

function safeObjectName(fileName: string) {
  return fileName.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(-160) || "attachment";
}
