import type {
  Brand,
  ContentItem,
  Detection,
  OptimizationCycle,
  PublishBatch,
  PublishingPlatform,
  PublishRecord,
  UserProfile,
} from "@/lib/types";

/** 各领域数据组合而成的启动读取模型，不可直接作为远程写入载荷。 */
export type WorkspaceSnapshot = {
  workspaceRevision: string;
  user: UserProfile;
  brands: Brand[];
  currentBrandId: string;
  detections: Detection[];
  cycles: OptimizationCycle[];
  contents: ContentItem[];
  publishBatches: PublishBatch[];
  publishRecords: PublishRecord[];
  platforms: PublishingPlatform[];
};

export type WorkspaceSyncStatus =
  | "idle"
  | "loading"
  | "ready"
  | "syncing"
  | "error";

export const workspaceSaveScopes = [
  "brands",
  "currentBrand",
  "cycles",
  "contents",
] as const;

export type WorkspaceSaveScope = typeof workspaceSaveScopes[number];

/** 工作区写入编排接受的窄载荷；用户、检测与发布数据使用各自的专用命令。 */
export type WorkspaceWriteSnapshot = Pick<
  WorkspaceSnapshot,
  "brands" | "currentBrandId" | "cycles" | "contents"
>;

export type WorkspaceSaveRequest = {
  snapshot: WorkspaceWriteSnapshot;
  scopes: WorkspaceSaveScope[];
  expectedRevision: string;
};

export type WorkspaceSaveResult = {
  workspaceRevision: string;
};
