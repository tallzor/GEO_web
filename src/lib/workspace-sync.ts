import type {
  WorkspaceSaveRequest,
  WorkspaceSaveResult,
  WorkspaceSaveScope,
  WorkspaceSyncStatus,
  WorkspaceWriteSnapshot,
} from "@/lib/workspace";

export type WorkspaceSyncState = WorkspaceWriteSnapshot & {
  dataMode: "local" | "supabase";
  workspaceLoaded: boolean;
  workspaceStatus: WorkspaceSyncStatus;
  workspaceRevision: string;
};

type WorkspaceSyncOptions = {
  getState: () => WorkspaceSyncState;
  setStatus: (status: WorkspaceSyncStatus, error?: string) => void;
  save: (request: WorkspaceSaveRequest) => Promise<WorkspaceSaveResult>;
  setRevision: (revision: string) => void;
  debounceMs?: number;
};

const scopeFields: ReadonlyArray<readonly [WorkspaceSaveScope, keyof WorkspaceWriteSnapshot]> = [
  ["brands", "brands"],
  ["currentBrand", "currentBrandId"],
  ["cycles", "cycles"],
  ["contents", "contents"],
];

export function workspaceWriteSnapshot(state: WorkspaceWriteSnapshot): WorkspaceWriteSnapshot {
  return {
    brands: state.brands,
    currentBrandId: state.currentBrandId,
    cycles: state.cycles,
    contents: state.contents,
  };
}

export function changedWorkspaceSaveScopes(
  state: WorkspaceWriteSnapshot,
  previous: WorkspaceWriteSnapshot,
) {
  return scopeFields.flatMap(([scope, field]) => state[field] !== previous[field] ? [scope] : []);
}

export function createWorkspaceSyncCoordinator(options: WorkspaceSyncOptions) {
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let requestedRevision = 0;
  let persistedRevision = 0;
  let savePromise: Promise<void> | undefined;
  let applyingServerProjection = false;
  const pendingScopes = new Set<WorkspaceSaveScope>();
  const debounceMs = options.debounceMs ?? 100;

  function schedule(scopes: WorkspaceSaveScope[]) {
    scopes.forEach((scope) => pendingScopes.add(scope));
    requestedRevision += 1;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      void ensureSaveWorker().catch(() => undefined);
    }, debounceMs);
  }

  function recordChanges(state: WorkspaceSyncState, previous: WorkspaceSyncState) {
    if (applyingServerProjection) return;
    if (state.dataMode !== "supabase" || !state.workspaceLoaded) return;
    if (state.workspaceStatus === "idle" || state.workspaceStatus === "loading") return;
    if (previous.workspaceStatus === "idle" || previous.workspaceStatus === "loading") return;
    const scopes = changedWorkspaceSaveScopes(state, previous);
    if (scopes.length) schedule(scopes);
  }

  function ensureSaveWorker() {
    if (!savePromise) {
      savePromise = runSaveLoop().finally(() => {
        savePromise = undefined;
      });
    }
    return savePromise;
  }

  async function runSaveLoop() {
    while (persistedRevision < requestedRevision) {
      const targetRevision = requestedRevision;
      const scopes = [...pendingScopes];
      pendingScopes.clear();
      const state = options.getState();
      if (state.dataMode !== "supabase" || !state.workspaceLoaded || state.workspaceStatus === "loading") {
        persistedRevision = targetRevision;
        return;
      }
      options.setStatus("syncing");
      try {
        const result = await options.save({
          snapshot: workspaceWriteSnapshot(state),
          scopes,
          expectedRevision: state.workspaceRevision,
        });
        options.setRevision(result.workspaceRevision);
        persistedRevision = targetRevision;
      } catch (error) {
        scopes.forEach((scope) => pendingScopes.add(scope));
        options.setStatus(
          "error",
          error instanceof Error ? error.message : "工作空间数据保存失败",
        );
        throw error;
      }
    }
    options.setStatus("ready");
  }

  async function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    if (options.getState().dataMode !== "supabase") return;
    if (savePromise) await savePromise.catch(() => undefined);
    if (persistedRevision >= requestedRevision && !pendingScopes.size) return;
    await ensureSaveWorker();
  }

  function applyServerProjection(update: () => void) {
    applyingServerProjection = true;
    try {
      update();
    } finally {
      applyingServerProjection = false;
    }
  }

  return { recordChanges, flush, applyServerProjection };
}
