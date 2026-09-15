import { createSeedData, type SeedData } from "@/lib/seed";
import type { AppSliceCreator, StoreDependencies, WorkspaceSlice } from "@/lib/store/contracts";

export function createWorkspaceSlice(
  initial: SeedData,
  dependencies: StoreDependencies,
): AppSliceCreator<WorkspaceSlice> {
  return (set, get) => ({
    hydrated: false,
    loggedIn: false,
    dataMode: "local",
    workspaceLoaded: false,
    workspaceStatus: "idle",
    workspaceError: "",
    workspaceRevision: "",
    user: initial.user,
    publishBatches: initial.publishBatches,
    publishRecords: initial.publishRecords,
    platforms: initial.platforms,
    setHydrated: (value) => set({ hydrated: value }),
    configureDataMode: (mode) => set((state) => ({
      dataMode: mode,
      workspaceLoaded: mode === "local" ? true : state.dataMode === "supabase" && state.workspaceLoaded,
      workspaceStatus: mode === "supabase"
        ? state.dataMode === "supabase" && state.workspaceStatus !== "idle"
          ? state.workspaceStatus
          : "loading"
        : "ready",
      workspaceError: "",
    })),
    replaceWorkspace: (snapshot) => set({
      ...snapshot,
      loggedIn: true,
      workspaceLoaded: true,
      workspaceStatus: "ready",
      workspaceError: "",
    }),
    setWorkspaceSyncStatus: (workspaceStatus, workspaceError = "") => set({
      workspaceStatus,
      workspaceError,
    }),
    setWorkspaceRevision: (workspaceRevision) => set({ workspaceRevision }),
    clearWorkspace: () => set({
      brands: [],
      currentBrandId: "",
      detections: [],
      cycles: [],
      contents: [],
      publishBatches: [],
      publishRecords: [],
      platforms: [],
      cognitionRuns: [],
      questionSimulationRuns: [],
      workspaceLoaded: false,
      workspaceStatus: "idle",
      workspaceError: "",
      workspaceRevision: "",
    }),
    login: () => set({ loggedIn: true }),
    logout: () => set({ loggedIn: false }),
    resetDemo: () => {
      const next = createSeedData();
      set({
        loggedIn: true,
        user: next.user,
        brands: next.brands,
        currentBrandId: next.brands[0]?.id || "",
        detections: next.detections,
        cycles: next.cycles,
        contents: next.contents,
        publishBatches: next.publishBatches,
        publishRecords: next.publishRecords,
        platforms: next.platforms,
        cognitionRuns: [],
        questionSimulationRuns: [],
      });
    },
    updateUser: (patch) => dependencies.applyPersistedProjection(get().dataMode, () => {
      set((state) => ({ user: { ...state.user, ...patch } }));
    }),
  });
}
