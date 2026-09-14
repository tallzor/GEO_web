"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSeedData } from "@/lib/seed";
import type { AppStore, StoreDependencies } from "@/lib/store/contracts";
import { createAppStoreState } from "@/lib/store/factory";
import { httpStoreAdapter } from "@/lib/store/http-adapter";
import { createWorkspaceSyncCoordinator } from "@/lib/workspace-sync";

export type { AppStore } from "@/lib/store/contracts";

const initial = createSeedData();

const dependencies: StoreDependencies = {
  remote: httpStoreAdapter,
  applyPersistedProjection: (dataMode, update) => {
    if (dataMode === "supabase") {
      workspaceSyncCoordinator.applyServerProjection(update);
      return;
    }
    update();
  },
};

export const useAppStore = create<AppStore>()(
  persist(
    createAppStoreState(initial, dependencies),
    {
      name: "geo-web-demo-v3",
      version: 4,
      migrate: (persistedState, version) => {
        const state = persistedState as Partial<AppStore>;
        if (version >= 4) return state as AppStore;
        const cycleIds = new Set((state.cycles || []).map((cycle) => cycle.id));
        const taskIds = new Set((state.cycles || []).flatMap((cycle) => cycle.tasks.map((task) => task.id)));
        const contentIds = new Set((state.contents || []).map((content) => content.id));
        return {
          ...state,
          publishBatches: [],
          publishRecords: (state.publishRecords || []).filter((record) => (
            cycleIds.has(record.cycleId)
            && taskIds.has(record.taskId)
            && contentIds.has(record.contentId)
          )),
          platforms: [],
        } as AppStore;
      },
      partialize: (state) => ({
        loggedIn: state.loggedIn,
        user: state.user,
        ...(state.dataMode === "local" ? {
          brands: state.brands,
          currentBrandId: state.currentBrandId,
          detections: state.detections,
          cycles: state.cycles,
          contents: state.contents,
          publishBatches: state.publishBatches,
          publishRecords: state.publishRecords,
          platforms: state.platforms,
        } : {}),
      }),
      onRehydrateStorage: () => (state) => state?.setHydrated(true),
    },
  ),
);

const workspaceSyncCoordinator = createWorkspaceSyncCoordinator({
  getState: () => useAppStore.getState(),
  setStatus: (status, error) => useAppStore.getState().setWorkspaceSyncStatus(status, error),
  setRevision: (revision) => useAppStore.getState().setWorkspaceRevision(revision),
  save: (request) => dependencies.remote.saveWorkspace(request),
});

export async function flushWorkspaceNow() {
  await workspaceSyncCoordinator.flush();
}

if (typeof window !== "undefined") {
  useAppStore.subscribe((state, previous) => {
    workspaceSyncCoordinator.recordChanges(state, previous);
  });
}

export function currentBrand(state: Pick<AppStore, "brands" | "currentBrandId">) {
  return state.brands.find((brand) => brand.id === state.currentBrandId);
}

export function activeCycle(state: Pick<AppStore, "cycles" | "currentBrandId">) {
  return state.cycles.find((cycle) => cycle.brandId === state.currentBrandId && cycle.status === "active");
}
