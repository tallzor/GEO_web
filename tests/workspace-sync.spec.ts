import { expect, test } from "@playwright/test";
import {
  changedWorkspaceSaveScopes,
  createWorkspaceSyncCoordinator,
  workspaceWriteSnapshot,
  type WorkspaceSyncState,
} from "../src/lib/workspace-sync";
import type { WorkspaceSaveRequest, WorkspaceSyncStatus } from "../src/lib/workspace";

function syncState(overrides: Partial<WorkspaceSyncState> = {}): WorkspaceSyncState {
  return {
    dataMode: "supabase",
    workspaceLoaded: true,
    workspaceStatus: "ready",
    workspaceRevision: "revision-1",
    brands: [],
    currentBrandId: "",
    cycles: [],
    contents: [],
    ...overrides,
  };
}

test("工作空间写入范围只包含其拥有的数据", () => {
  const previous = syncState();
  const state = syncState({
    brands: [...previous.brands],
    currentBrandId: "brand-1",
    cycles: [...previous.cycles],
    contents: [...previous.contents],
  });

  expect(changedWorkspaceSaveScopes(state, previous)).toEqual([
    "brands",
    "currentBrand",
    "cycles",
    "contents",
  ]);
  expect(workspaceWriteSnapshot(state)).toEqual({
    brands: state.brands,
    currentBrandId: state.currentBrandId,
    cycles: state.cycles,
    contents: state.contents,
  });
  expect(workspaceWriteSnapshot(state)).not.toHaveProperty("user");
  expect(workspaceWriteSnapshot(state)).not.toHaveProperty("detections");
  expect(workspaceWriteSnapshot(state)).not.toHaveProperty("publishBatches");
  expect(workspaceWriteSnapshot(state)).not.toHaveProperty("publishRecords");
  expect(workspaceWriteSnapshot(state)).not.toHaveProperty("platforms");
});

test("检测与发布等专用仓储数据变化不会触发工作空间保存", () => {
  const previous = syncState();
  const state = {
    ...previous,
    detections: [{ id: "detection-1" }],
    publishRecords: [{ id: "publish-1" }],
    platforms: [{ id: "platform-1" }],
  };

  expect(changedWorkspaceSaveScopes(state, previous)).toEqual([]);
});

test("服务端结果合并到读取投影时不会再次回写", async () => {
  const requests: WorkspaceSaveRequest[] = [];
  let state = syncState();
  const coordinator = createWorkspaceSyncCoordinator({
    getState: () => state,
    setStatus: (workspaceStatus) => { state = { ...state, workspaceStatus }; },
    setRevision: (workspaceRevision) => { state = { ...state, workspaceRevision }; },
    save: async (request) => {
      requests.push(request);
      return { workspaceRevision: "revision-2" };
    },
  });

  coordinator.applyServerProjection(() => {
    const previous = state;
    state = { ...state, cycles: [...state.cycles] };
    coordinator.recordChanges(state, previous);
  });
  await coordinator.flush();

  expect(requests).toEqual([]);
});

test("同步协调器合并连续变更并一次写入", async () => {
  const requests: WorkspaceSaveRequest[] = [];
  let state = syncState();
  const coordinator = createWorkspaceSyncCoordinator({
    getState: () => state,
    setStatus: (workspaceStatus) => { state = { ...state, workspaceStatus }; },
    setRevision: (workspaceRevision) => { state = { ...state, workspaceRevision }; },
    save: async (request) => {
      requests.push(request);
      return { workspaceRevision: "revision-2" };
    },
    debounceMs: 60_000,
  });

  const initial = state;
  state = { ...state, brands: [...state.brands] };
  coordinator.recordChanges(state, initial);
  const afterBrand = state;
  state = { ...state, currentBrandId: "brand-1" };
  coordinator.recordChanges(state, afterBrand);
  await coordinator.flush();

  expect(requests).toHaveLength(1);
  expect(requests[0].scopes).toEqual(["brands", "currentBrand"]);
  expect(requests[0].expectedRevision).toBe("revision-1");
  expect(state.workspaceRevision).toBe("revision-2");
  expect(state.workspaceStatus).toBe("ready");
});

test("保存失败时保留待写范围，手动刷新可以完整重试", async () => {
  let attempts = 0;
  let state = syncState();
  const statuses: Array<{ status: WorkspaceSyncStatus; error?: string }> = [];
  const coordinator = createWorkspaceSyncCoordinator({
    getState: () => state,
    setStatus: (workspaceStatus, error) => {
      statuses.push({ status: workspaceStatus, error });
      state = { ...state, workspaceStatus };
    },
    setRevision: (workspaceRevision) => { state = { ...state, workspaceRevision }; },
    save: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("暂时无法保存");
      return { workspaceRevision: "revision-2" };
    },
    debounceMs: 60_000,
  });

  const initial = state;
  state = { ...state, contents: [...state.contents] };
  coordinator.recordChanges(state, initial);
  await expect(coordinator.flush()).rejects.toThrow("暂时无法保存");
  expect(statuses.at(-1)).toEqual({ status: "error", error: "暂时无法保存" });

  await coordinator.flush();
  expect(attempts).toBe(2);
  expect(statuses.at(-1)).toEqual({ status: "ready", error: undefined });
});
