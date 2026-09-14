import { expect, test } from "@playwright/test";
import { createStore } from "zustand/vanilla";
import { createSeedData } from "../src/lib/seed";
import type { AppStore, StoreDependencies, StoreRemotePort } from "../src/lib/store/contracts";
import { createAppStoreState } from "../src/lib/store/factory";
import type { ContentItem, Detection } from "../src/lib/types";

function createTestStore(overrides: Partial<StoreRemotePort> = {}) {
  const seed = createSeedData();
  let projectionCount = 0;
  const remote: StoreRemotePort = {
    saveWorkspace: async () => ({ workspaceRevision: "test-revision-2" }),
    retryDetection: async () => { throw new Error("未配置检测重试结果"); },
    createOptimizationCycle: async () => { throw new Error("未配置优化周期结果"); },
    generateOptimizationContent: async () => { throw new Error("未配置内容生成结果"); },
    ...overrides,
  };
  const dependencies: StoreDependencies = {
    remote,
    applyPersistedProjection: (_dataMode, update) => {
      projectionCount += 1;
      update();
    },
  };
  const store = createStore<AppStore>()(createAppStoreState(seed, dependencies));
  return { seed, store, projectionCount: () => projectionCount };
}

test("远程检测重试通过注入 adapter 并合并服务端结果", async () => {
  const seed = createSeedData();
  const failed: Detection = {
    ...seed.detections[0],
    status: "failed",
    stage: "failed",
    dataSource: "live_api",
    attempt: 1,
  };
  let requestedId = "";
  const completed: Detection = {
    ...failed,
    status: "completed",
    stage: "completed",
    completedRuns: failed.totalRuns,
    attempt: 2,
  };
  const { store } = createTestStore({
    retryDetection: async (detectionId) => {
      requestedId = detectionId;
      return completed;
    },
  });
  store.setState({ dataMode: "supabase", detections: [failed] });

  await store.getState().retryDetection(failed.id);

  expect(requestedId).toBe(failed.id);
  expect(store.getState().detections[0]).toEqual(completed);
});

test("同一任务并发生成内容时只发起一次远程请求", async () => {
  const seed = createSeedData();
  const cycle = seed.cycles[0];
  const task = cycle.tasks.find((item) => !item.contentId)!;
  let requestCount = 0;
  const generated: ContentItem = {
    ...seed.contents[0],
    id: "content_generated_once",
    cycleId: cycle.id,
    taskId: task.id,
  };
  const { store, projectionCount } = createTestStore({
    generateOptimizationContent: async () => {
      requestCount += 1;
      await Promise.resolve();
      return generated;
    },
  });
  store.setState({ dataMode: "supabase" });

  const [firstId, secondId] = await Promise.all([
    store.getState().ensureTaskContent(cycle.id, task.id),
    store.getState().ensureTaskContent(cycle.id, task.id),
  ]);

  expect(firstId).toBe(generated.id);
  expect(secondId).toBe(generated.id);
  expect(requestCount).toBe(1);
  expect(projectionCount()).toBe(1);
  expect(store.getState().contents.filter((item) => item.taskId === task.id)).toHaveLength(1);
});

test("品牌删除投影会同步清理所有关联领域数据", () => {
  const { seed, store } = createTestStore();
  const brandId = seed.brands[0].id;
  store.setState({
    publishBatches: [{
      id: "batch-1",
      brandId,
      taskId: seed.cycles[0].tasks[0].id,
      contentId: seed.contents[0].id,
      contentVersion: 1,
      idempotencyKey: "key-1",
      status: "succeeded",
      successCount: 1,
      failureCount: 0,
      createdAt: "2026-09-04T00:00:00.000Z",
      records: [],
    }],
  });

  store.getState().removeBrand(brandId);

  expect(store.getState().brands).toEqual([]);
  expect(store.getState().detections).toEqual([]);
  expect(store.getState().cycles).toEqual([]);
  expect(store.getState().contents).toEqual([]);
  expect(store.getState().publishBatches).toEqual([]);
  expect(store.getState().currentBrandId).toBe("");
});
