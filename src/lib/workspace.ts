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

export type WorkspaceSnapshot = {
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

export type WorkspaceSaveScope =
  | "user"
  | "brands"
  | "currentBrand"
  | "cycles"
  | "contents"
  | "publishBatches"
  | "publishRecords"
  | "platforms";

export type WorkspaceSaveRequest = {
  snapshot: WorkspaceSnapshot;
  scopes: WorkspaceSaveScope[];
};
