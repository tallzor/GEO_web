import "server-only";

import type { AccountContext } from "@/lib/auth/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ContentItem, OptimizationCycle, OptimizationTask } from "@/lib/types";
import {
  assertUuid,
  validateContentIdentity,
  validateOptimizationCycle,
} from "@/lib/server/workspace-write-rules";

type Row = Record<string, unknown>;
type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

export async function saveOptimizationSnapshots(account: AccountContext, input: {
  cycles?: OptimizationCycle[];
  contents?: ContentItem[];
}) {
  const organizationId = requireOrganization(account);
  const supabase = createSupabaseAdminClient();

  if (input.cycles) {
    input.cycles.forEach(validateOptimizationCycle);
    await assertIdsOwned(supabase, "optimization_cycles", organizationId, input.cycles.map((cycle) => cycle.id));
    await assertIdsOwned(supabase, "optimization_tasks", organizationId, input.cycles.flatMap((cycle) => cycle.tasks.map((task) => task.id)));
    await assertActiveBrands(supabase, organizationId, input.cycles.map((cycle) => cycle.brandId));
    const suggestionSources = await loadSuggestionSources(supabase, organizationId, input.cycles);

    await upsertOrThrow(supabase, "optimization_cycles", input.cycles.map((cycle) => (
      cycleRow(cycle, suggestionSources.get(cycle.suggestionId), organizationId, account.userId)
    )));
    await upsertOrThrow(supabase, "optimization_tasks", input.cycles.flatMap((cycle) =>
      cycle.tasks.map((task, index) => taskRow(cycle, task, organizationId, index)),
    ));

    const suggestionIds = [...suggestionSources.keys()];
    if (suggestionIds.length) {
      const selectedResult = await supabase.from("optimization_suggestions")
        .update({ selected: true, selected_at: new Date().toISOString() })
        .eq("organization_id", organizationId)
        .in("id", suggestionIds)
        .select("id");
      if (selectedResult.error) throw new Error(selectedResult.error.message);
      if (rows(selectedResult.data).length !== suggestionIds.length) {
        throw new Error("部分优化建议采用状态未能保存");
      }
    }
  }

  if (input.contents) {
    input.contents.forEach(validateContentIdentity);
    await assertContentRelationships(supabase, organizationId, input.contents);
    await upsertOrThrow(supabase, "contents", input.contents.map((content) => contentRow(content, organizationId)));
    await upsertOrThrow(supabase, "content_versions", input.contents.map((content) => (
      contentVersionRow(content, organizationId, account.userId)
    )), "content_id,version");
  }
}

export async function createOptimizationCycle(
  account: AccountContext,
  requestedCycle: OptimizationCycle,
): Promise<OptimizationCycle> {
  const organizationId = requireOrganization(account);
  validateOptimizationCycle(requestedCycle);
  const supabase = createSupabaseAdminClient();
  await assertActiveBrands(supabase, organizationId, [requestedCycle.brandId]);

  const existingResult = await supabase.from("optimization_cycles")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("brand_id", requestedCycle.brandId)
    .eq("status", "active")
    .maybeSingle();
  if (existingResult.error) throw new Error(existingResult.error.message);
  if (existingResult.data) return loadOptimizationCycle(organizationId, text(existingResult.data.id));

  const suggestionSources = await loadSuggestionSources(supabase, organizationId, [requestedCycle]);
  const source = suggestionSources.get(requestedCycle.suggestionId);
  const cycle: OptimizationCycle = {
    ...requestedCycle,
    dimension: text(source?.dimension) as OptimizationCycle["dimension"],
    target: text(source?.title),
    description: text(source?.description),
  };

  await assertIdsAbsent(supabase, "optimization_cycles", [cycle.id], "优化周期ID已存在");
  await assertIdsAbsent(supabase, "optimization_tasks", cycle.tasks.map((task) => task.id), "优化任务ID已存在");
  const cycleInsert = await supabase.from("optimization_cycles").insert(
    cycleRow(cycle, source, organizationId, account.userId),
  );
  if (cycleInsert.error) {
    if (cycleInsert.error.code === "23505") {
      const concurrent = await supabase.from("optimization_cycles").select("id")
        .eq("organization_id", organizationId).eq("brand_id", cycle.brandId).eq("status", "active").maybeSingle();
      if (concurrent.error) throw new Error(concurrent.error.message);
      if (concurrent.data) return loadOptimizationCycle(organizationId, text(concurrent.data.id));
    }
    throw new Error(cycleInsert.error.message);
  }

  try {
    const taskInsert = await supabase.from("optimization_tasks").insert(
      cycle.tasks.map((task, index) => taskRow(cycle, task, organizationId, index)),
    );
    if (taskInsert.error) throw new Error(taskInsert.error.message);

    const suggestionUpdate = await supabase.from("optimization_suggestions")
      .update({ selected: true, selected_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .eq("id", cycle.suggestionId)
      .select("id")
      .maybeSingle();
    if (suggestionUpdate.error) throw new Error(suggestionUpdate.error.message);
    if (!suggestionUpdate.data) throw new Error("优化建议采用状态未能保存");
  } catch (error) {
    await supabase.from("optimization_cycles").delete()
      .eq("organization_id", organizationId)
      .eq("id", cycle.id);
    throw error;
  }

  return cycle;
}

export async function saveGeneratedContent(account: AccountContext, content: ContentItem) {
  const organizationId = requireOrganization(account);
  validateContentIdentity(content);
  const supabase = createSupabaseAdminClient();
  const taskResult = await supabase.from("optimization_tasks")
    .select("id,brand_id,cycle_id,status")
    .eq("organization_id", organizationId)
    .eq("id", content.taskId)
    .maybeSingle();
  if (taskResult.error) throw new Error(taskResult.error.message);
  const task = taskResult.data as Row | null;
  if (!task || text(task.brand_id) !== content.brandId || text(task.cycle_id) !== content.cycleId) {
    throw new Error("内容任务不属于当前组织或数据归属不匹配");
  }

  const existingByIdResult = await supabase.from("contents")
    .select("id,organization_id,brand_id,cycle_id,task_id,current_version")
    .eq("id", content.id)
    .maybeSingle();
  if (existingByIdResult.error) throw new Error(existingByIdResult.error.message);
  const existingById = existingByIdResult.data as Row | null;
  if (existingById && (
    text(existingById.organization_id) !== organizationId
    || text(existingById.brand_id) !== content.brandId
    || text(existingById.cycle_id) !== content.cycleId
    || text(existingById.task_id) !== content.taskId
  )) {
    throw new Error("内容ID已被其他数据占用");
  }
  if (existingById && content.version < numberValue(existingById.current_version, 1)) {
    throw new Error("内容版本已更新，请刷新后重试");
  }

  const existingTaskContent = await supabase.from("contents")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("cycle_id", content.cycleId)
    .eq("task_id", content.taskId)
    .limit(1)
    .maybeSingle();
  if (existingTaskContent.error) throw new Error(existingTaskContent.error.message);
  if (existingTaskContent.data && text(existingTaskContent.data.id) !== content.id) {
    throw new Error("当前任务已有其他内容，请刷新后重试");
  }

  if (existingById) {
    await upsertOrThrow(supabase, "content_versions", [contentVersionRow(content, organizationId, account.userId)], "content_id,version");
    const contentUpdate = await supabase.from("contents").update(contentRow(content, organizationId))
      .eq("organization_id", organizationId)
      .eq("id", content.id)
      .eq("cycle_id", content.cycleId)
      .eq("task_id", content.taskId)
      .select("id")
      .maybeSingle();
    if (contentUpdate.error) throw new Error(contentUpdate.error.message);
    if (!contentUpdate.data) throw new Error("内容保存未生效，请刷新后重试");
  } else {
    const contentInsert = await supabase.from("contents").insert({
      ...contentRow(content, organizationId),
    }).select("id").maybeSingle();
    if (contentInsert.error) throw new Error(contentInsert.error.message);
    if (!contentInsert.data) throw new Error("内容创建未生效，请重试");
    try {
      await upsertOrThrow(supabase, "content_versions", [contentVersionRow(content, organizationId, account.userId)], "content_id,version");
    } catch (error) {
      await supabase.from("contents").delete().eq("organization_id", organizationId).eq("id", content.id);
      throw error;
    }
  }

  if (text(task.status) === "pending") {
    const taskUpdate = await supabase.from("optimization_tasks")
      .update({ status: "in_progress" })
      .eq("organization_id", organizationId)
      .eq("id", content.taskId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (taskUpdate.error) throw new Error(taskUpdate.error.message);
    if (!taskUpdate.data) throw new Error("任务状态已变化，请刷新后重试");
  }
}

export async function applyPublicationState(input: {
  organizationId: string;
  cycleId: string;
  taskId: string;
  contentId: string;
  status: "publishing" | "published" | "failed";
}) {
  assertUuid(input.organizationId, "组织ID");
  assertUuid(input.cycleId, "优化周期ID");
  assertUuid(input.taskId, "优化任务ID");
  assertUuid(input.contentId, "内容ID");
  const supabase = createSupabaseAdminClient();
  const [taskResult, contentResult] = await Promise.all([
    supabase.from("optimization_tasks").select("id,status")
      .eq("organization_id", input.organizationId).eq("cycle_id", input.cycleId).eq("id", input.taskId).maybeSingle(),
    supabase.from("contents").select("id")
      .eq("organization_id", input.organizationId).eq("cycle_id", input.cycleId).eq("task_id", input.taskId).eq("id", input.contentId).maybeSingle(),
  ]);
  if (taskResult.error) throw new Error(taskResult.error.message);
  if (contentResult.error) throw new Error(contentResult.error.message);
  if (!taskResult.data || !contentResult.data) throw new Error("发布结果关联的任务或内容不存在");
  if (text(taskResult.data.status) === "void") throw new Error("已作废任务不能更新发布状态");

  if (input.status === "published") {
    const now = new Date().toISOString();
    const taskUpdate = await supabase.from("optimization_tasks")
      .update({ status: "completed", completed_at: now })
      .eq("organization_id", input.organizationId)
      .eq("cycle_id", input.cycleId)
      .eq("id", input.taskId)
      .neq("status", "void")
      .select("id")
      .maybeSingle();
    if (taskUpdate.error) throw new Error(taskUpdate.error.message);
    if (!taskUpdate.data) throw new Error("发布完成，但任务进度更新未生效");

    const allTasksResult = await supabase.from("optimization_tasks")
      .select("id,day,status")
      .eq("organization_id", input.organizationId)
      .eq("cycle_id", input.cycleId)
      .order("day");
    if (allTasksResult.error) throw new Error(allTasksResult.error.message);
    const tasks = rows(allTasksResult.data);
    const remaining = tasks.find((item) => !["completed", "void"].includes(text(item.status)));
    if (!remaining) {
      await updateCycleProgress(supabase, input.organizationId, input.cycleId, { status: "completed", current_day: 7 });
    } else {
      if (text(remaining.status) === "pending") {
        const nextTaskUpdate = await supabase.from("optimization_tasks")
          .update({ status: "in_progress" })
          .eq("organization_id", input.organizationId)
          .eq("cycle_id", input.cycleId)
          .eq("id", text(remaining.id))
          .eq("status", "pending")
          .select("id")
          .maybeSingle();
        if (nextTaskUpdate.error) throw new Error(nextTaskUpdate.error.message);
        if (!nextTaskUpdate.data) throw new Error("下一项优化任务状态更新未生效");
      }
      await updateCycleProgress(supabase, input.organizationId, input.cycleId, {
        current_day: numberValue(remaining.day, 1),
      });
    }
  }

  const contentUpdate = await supabase.from("contents")
    .update({ status: input.status })
    .eq("organization_id", input.organizationId)
    .eq("cycle_id", input.cycleId)
    .eq("task_id", input.taskId)
    .eq("id", input.contentId)
    .select("id")
    .maybeSingle();
  if (contentUpdate.error) throw new Error(contentUpdate.error.message);
  if (!contentUpdate.data) throw new Error("内容发布状态更新未生效");
}

async function loadOptimizationCycle(organizationId: string, cycleId: string): Promise<OptimizationCycle> {
  const supabase = createSupabaseAdminClient();
  const [cycleResult, contentResult] = await Promise.all([
    supabase.from("optimization_cycles").select("*, tasks:optimization_tasks(*)")
      .eq("organization_id", organizationId).eq("id", cycleId).maybeSingle(),
    supabase.from("contents").select("id,task_id")
      .eq("organization_id", organizationId).eq("cycle_id", cycleId),
  ]);
  if (cycleResult.error) throw new Error(cycleResult.error.message);
  if (contentResult.error) throw new Error(contentResult.error.message);
  if (!cycleResult.data) throw new Error("已有优化任务存在，但加载失败");
  const contentIdByTask = new Map(rows(contentResult.data).map((row) => [text(row.task_id), text(row.id)]));
  return cycleFromRow(cycleResult.data as Row, contentIdByTask);
}

async function loadSuggestionSources(
  supabase: SupabaseAdmin,
  organizationId: string,
  cycles: OptimizationCycle[],
) {
  const suggestionIds = [...new Set(cycles.map((cycle) => cycle.suggestionId))];
  if (!suggestionIds.length) return new Map<string, Row>();
  const { data, error } = await supabase.from("optimization_suggestions")
    .select("id,brand_id,detection_id,dimension,title,description,reason")
    .eq("organization_id", organizationId)
    .in("id", suggestionIds);
  if (error) throw new Error(error.message);
  const sources = new Map(rows(data).map((row) => [text(row.id), row]));
  if (sources.size !== suggestionIds.length) throw new Error("优化目标来源数据不属于当前组织");
  cycles.forEach((cycle) => {
    const source = sources.get(cycle.suggestionId);
    if (!source || text(source.brand_id) !== cycle.brandId || text(source.detection_id) !== cycle.detectionId) {
      throw new Error("优化目标与检测来源不匹配");
    }
  });
  return sources;
}

async function assertContentRelationships(
  supabase: SupabaseAdmin,
  organizationId: string,
  contents: ContentItem[],
) {
  const contentIds = contents.map((content) => content.id);
  if (contentIds.length) {
    const existingResult = await supabase.from("contents")
      .select("id,organization_id,brand_id,cycle_id,task_id")
      .in("id", contentIds);
    if (existingResult.error) throw new Error(existingResult.error.message);
    const expected = new Map(contents.map((content) => [content.id, content]));
    for (const row of rows(existingResult.data)) {
      const content = expected.get(text(row.id));
      if (!content || text(row.organization_id) !== organizationId
        || text(row.brand_id) !== content.brandId
        || text(row.cycle_id) !== content.cycleId
        || text(row.task_id) !== content.taskId) {
        throw new Error("内容ID已被其他数据占用");
      }
    }
  }

  const taskIds = [...new Set(contents.map((content) => content.taskId))];
  if (!taskIds.length) return;
  const taskResult = await supabase.from("optimization_tasks")
    .select("id,brand_id,cycle_id")
    .eq("organization_id", organizationId)
    .in("id", taskIds);
  if (taskResult.error) throw new Error(taskResult.error.message);
  const tasks = new Map(rows(taskResult.data).map((row) => [text(row.id), row]));
  if (tasks.size !== taskIds.length) throw new Error("内容关联任务不属于当前组织");
  contents.forEach((content) => {
    const task = tasks.get(content.taskId);
    if (!task || text(task.brand_id) !== content.brandId || text(task.cycle_id) !== content.cycleId) {
      throw new Error("内容任务归属不正确");
    }
  });
}

async function assertActiveBrands(supabase: SupabaseAdmin, organizationId: string, brandIds: string[]) {
  const uniqueIds = [...new Set(brandIds)];
  if (!uniqueIds.length) return;
  uniqueIds.forEach((id) => assertUuid(id, "品牌ID"));
  const { data, error } = await supabase.from("brands").select("id")
    .eq("organization_id", organizationId).is("deleted_at", null).in("id", uniqueIds);
  if (error) throw new Error(error.message);
  if (rows(data).length !== uniqueIds.length) throw new Error("优化数据关联的品牌不属于当前组织");
}

async function assertIdsOwned(
  supabase: SupabaseAdmin,
  table: string,
  organizationId: string,
  ids: string[],
) {
  if (!ids.length) return;
  const { data, error } = await supabase.from(table).select("id,organization_id").in("id", ids);
  if (error) throw new Error(error.message);
  if (rows(data).some((row) => text(row.organization_id) !== organizationId)) {
    throw new Error("检测到不属于当前组织的数据ID");
  }
}

async function assertIdsAbsent(supabase: SupabaseAdmin, table: string, ids: string[], message: string) {
  if (!ids.length) return;
  const { data, error } = await supabase.from(table).select("id").in("id", ids).limit(1);
  if (error) throw new Error(error.message);
  if (rows(data).length) throw new Error(message);
}

async function updateCycleProgress(
  supabase: SupabaseAdmin,
  organizationId: string,
  cycleId: string,
  patch: Record<string, unknown>,
) {
  const result = await supabase.from("optimization_cycles").update(patch)
    .eq("organization_id", organizationId)
    .eq("id", cycleId)
    .select("id")
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("优化周期进度更新未生效");
}

function cycleRow(cycle: OptimizationCycle, source: Row | undefined, organizationId: string, userId: string) {
  if (!source || text(source.brand_id) !== cycle.brandId || text(source.detection_id) !== cycle.detectionId) {
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

function taskRow(cycle: OptimizationCycle, task: OptimizationTask, organizationId: string, index: number) {
  return {
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
  };
}

function contentRow(content: ContentItem, organizationId: string) {
  return {
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
  };
}

function contentVersionRow(content: ContentItem, organizationId: string, userId: string) {
  return {
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
    created_by: userId,
  };
}

function cycleFromRow(row: Row, contentIdByTask: Map<string, string>): OptimizationCycle {
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
    tasks: rows(row.tasks).sort((left, right) => numberValue(left.day) - numberValue(right.day)).map((task) => ({
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

function optionalText(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
