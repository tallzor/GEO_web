import type { ContentItem, OptimizationCycle } from "@/lib/types";
import type { WorkspaceSaveScope, WorkspaceWriteSnapshot } from "@/lib/workspace";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, field: string) {
  if (!uuidPattern.test(value)) throw new Error(`${field}不是有效的数据ID`);
}

export function validateOptimizationCycle(cycle: OptimizationCycle) {
  assertUuid(cycle.id, "优化周期ID");
  assertUuid(cycle.brandId, "优化周期品牌ID");
  assertUuid(cycle.detectionId, "优化周期检测ID");
  assertUuid(cycle.suggestionId, "优化建议ID");
  assertUniqueIds(cycle.tasks, "优化任务ID");
  cycle.tasks.forEach((task) => {
    assertUuid(task.id, "优化任务ID");
    if (task.cycleId !== cycle.id) throw new Error("优化任务与周期归属不匹配");
  });
  const days = new Set(cycle.tasks.map((task) => task.day));
  if (cycle.tasks.length !== 7 || days.size !== 7 || [...days].some((day) => day < 1 || day > 7)) {
    throw new Error("7天优化任务结构不完整");
  }
}

export function validateContentIdentity(content: ContentItem) {
  assertUuid(content.id, "内容ID");
  assertUuid(content.brandId, "内容品牌ID");
  assertUuid(content.cycleId, "内容周期ID");
  assertUuid(content.taskId, "内容任务ID");
  if (!Number.isInteger(content.version) || content.version < 1) {
    throw new Error("内容版本不正确");
  }
}

export function validateWorkspaceWriteSnapshot(
  snapshot: WorkspaceWriteSnapshot,
  requestedScopes: Iterable<WorkspaceSaveScope>,
) {
  const scopes = new Set(requestedScopes);
  if (
    !snapshot
    || !Array.isArray(snapshot.brands)
    || typeof snapshot.currentBrandId !== "string"
    || !Array.isArray(snapshot.cycles)
    || !Array.isArray(snapshot.contents)
  ) {
    throw new Error("工作空间数据格式不正确");
  }

  const brandIds = new Set(snapshot.brands.map((brand) => brand.id));
  if (scopes.has("brands")) {
    if (snapshot.brands.length > 100) throw new Error("品牌数量超出限制");
    assertUniqueIds(snapshot.brands, "品牌ID");
    const childIds: Array<{ id: string }> = [];
    for (const brand of snapshot.brands) {
      assertUuid(brand.id, "品牌ID");
      if (!brand.name.trim()) throw new Error("品牌名称不能为空");
      childIds.push(...brand.stores, ...brand.products, ...brand.competitors, ...brand.knowledge, ...brand.questions);
    }
    assertUniqueIds(childIds, "品牌子数据ID");
    childIds.forEach((item) => assertUuid(item.id, "品牌子数据ID"));
  }

  if (scopes.has("currentBrand") && snapshot.currentBrandId && !brandIds.has(snapshot.currentBrandId)) {
    throw new Error("当前品牌不属于本工作空间");
  }

  const cycleById = new Map(snapshot.cycles.map((cycle) => [cycle.id, cycle]));
  const taskById = new Map(snapshot.cycles.flatMap((cycle) => cycle.tasks.map((task) => [task.id, { task, cycle }] as const)));
  if (scopes.has("cycles")) {
    assertUniqueIds(snapshot.cycles, "优化周期ID");
    assertUniqueIds(snapshot.cycles.flatMap((cycle) => cycle.tasks), "优化任务ID");
    snapshot.cycles.forEach((cycle) => {
      validateOptimizationCycle(cycle);
      if (!brandIds.has(cycle.brandId)) throw new Error("优化周期品牌归属不正确");
    });
  }

  if (scopes.has("contents")) {
    assertUniqueIds(snapshot.contents, "内容ID");
    snapshot.contents.forEach((content) => {
      validateContentIdentity(content);
      const cycle = cycleById.get(content.cycleId);
      const taskContext = taskById.get(content.taskId);
      if (
        !brandIds.has(content.brandId)
        || !cycle
        || cycle.brandId !== content.brandId
        || !taskContext
        || taskContext.cycle.id !== content.cycleId
      ) {
        throw new Error("内容任务归属不正确");
      }
    });
  }
}

function assertUniqueIds(items: Array<{ id: string }>, field: string) {
  const ids = items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new Error(`${field}不能重复`);
}
