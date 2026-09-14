import type { StateCreator } from "zustand";
import type {
  Brand,
  ChannelId,
  Competitor,
  ContentItem,
  Detection,
  DetectionQuestion,
  Diagnosis,
  DetectionResult,
  KnowledgeAttachment,
  OptimizationCycle,
  ProductService,
  ProviderErrorCategory,
  ProviderId,
  PublishBatch,
  PublishRecord,
  PublishingPlatform,
  TaskStatus,
  UserProfile,
} from "@/lib/types";
import type {
  WorkspaceSaveRequest,
  WorkspaceSaveResult,
  WorkspaceSnapshot,
  WorkspaceSyncStatus,
} from "@/lib/workspace";

type BrandPatch = Partial<Omit<Brand, "id" | "products" | "competitors" | "knowledge" | "questions">>;

export type CreateBrandInput = Pick<Brand, "name"> & Partial<Pick<
  Brand,
  "shortName" | "characteristics" | "categoryName" | "trustProof" | "positioningStatement" | "industry" | "intro" | "serviceArea" | "targetAudience"
>> & {
  products?: Omit<ProductService, "id" | "updatedAt">[];
  competitors?: Omit<Competitor, "id">[];
};

export type WorkspaceSlice = {
  hydrated: boolean;
  loggedIn: boolean;
  dataMode: "local" | "supabase";
  workspaceLoaded: boolean;
  workspaceStatus: WorkspaceSyncStatus;
  workspaceError: string;
  workspaceRevision: string;
  user: UserProfile;
  publishBatches: PublishBatch[];
  publishRecords: PublishRecord[];
  platforms: PublishingPlatform[];
  setHydrated: (value: boolean) => void;
  configureDataMode: (mode: "local" | "supabase") => void;
  replaceWorkspace: (snapshot: WorkspaceSnapshot) => void;
  setWorkspaceSyncStatus: (status: WorkspaceSyncStatus, error?: string) => void;
  setWorkspaceRevision: (revision: string) => void;
  clearWorkspace: () => void;
  login: () => void;
  logout: () => void;
  resetDemo: () => void;
  updateUser: (patch: Partial<UserProfile>) => void;
};

export type BrandSlice = {
  brands: Brand[];
  currentBrandId: string;
  setCurrentBrand: (brandId: string) => void;
  createBrand: (input: CreateBrandInput) => string;
  removeBrand: (brandId: string, nextBrandId?: string | null) => void;
  updateBrand: (brandId: string, patch: BrandPatch) => void;
  addProduct: (brandId: string, product: Omit<ProductService, "id" | "updatedAt">) => void;
  updateProduct: (brandId: string, productId: string, patch: Partial<ProductService>) => void;
  deleteProduct: (brandId: string, productId: string) => void;
  addCompetitor: (brandId: string, competitor: Omit<Competitor, "id">) => void;
  updateCompetitor: (brandId: string, competitorId: string, patch: Partial<Competitor>) => void;
  deleteCompetitor: (brandId: string, competitorId: string) => void;
  addKnowledge: (brandId: string, attachment: Omit<KnowledgeAttachment, "id" | "uploadedAt">) => string;
  updateKnowledgeStatus: (brandId: string, attachmentId: string, status: KnowledgeAttachment["status"], error?: string) => void;
  deleteKnowledge: (brandId: string, attachmentId: string) => void;
  addQuestion: (brandId: string, text: string, category: string) => void;
  updateQuestion: (brandId: string, questionId: string, patch: Partial<Brand["questions"][number]>) => void;
  deleteQuestion: (brandId: string, questionId: string) => void;
  addGeneratedQuestions: (brandId: string, questions: string[]) => string[];
  mergePersistedQuestions: (brandId: string, questions: DetectionQuestion[], generatedAt: string) => string[];
};

export type DetectionSlice = {
  detections: Detection[];
  startDetection: (brandId: string, providers: ProviderId[], questionIds: string[], sourceDetectionId?: string) => string;
  advanceDetection: (detectionId: string) => void;
  advanceLiveDetectionStep: (detectionId: string) => void;
  appendDetectionResult: (detectionId: string, result: DetectionResult) => void;
  recordDetectionError: (
    detectionId: string,
    provider: ProviderId,
    questionId: string,
    message: string,
    runKey?: string,
    category?: ProviderErrorCategory,
    retryable?: boolean,
  ) => void;
  applyLiveDetectionAnalysis: (detectionId: string, results: DetectionResult[], diagnosis: Diagnosis, analysisModel: string) => void;
  finishLiveDetection: (detectionId: string) => void;
  syncServerDetection: (detection: Detection) => void;
  mergeServerDetections: (detections: Detection[]) => void;
  retryDetection: (detectionId: string) => Promise<void>;
};

export type OptimizationSlice = {
  cycles: OptimizationCycle[];
  contents: ContentItem[];
  selectObjective: (detectionId: string, suggestionId: string) => Promise<string>;
  updateTaskStatus: (cycleId: string, taskId: string, status: TaskStatus) => void;
  mergePublishedTaskCompletion: (cycleId: string, taskId: string) => void;
  terminateCycle: (cycleId: string) => void;
  ensureTaskContent: (cycleId: string, taskId: string) => Promise<string>;
  updateContent: (contentId: string, patch: Partial<Pick<ContentItem, "title" | "body" | "selectedChannel">>) => void;
  updateChannelContent: (contentId: string, channel: ChannelId, title: string, body: string) => void;
  regenerateContent: (contentId: string) => Promise<void>;
  runRiskCheck: (contentId: string) => void;
};

export type AppStore = WorkspaceSlice & BrandSlice & DetectionSlice & OptimizationSlice;

export type ContentGenerationInput = {
  cycleId: string;
  taskId: string;
  contentId?: string;
};

export type StoreRemotePort = {
  saveWorkspace: (request: WorkspaceSaveRequest) => Promise<WorkspaceSaveResult>;
  retryDetection: (detectionId: string) => Promise<Detection>;
  createOptimizationCycle: (detectionId: string, suggestionId: string) => Promise<OptimizationCycle>;
  generateOptimizationContent: (input: ContentGenerationInput) => Promise<ContentItem>;
};

export type StoreDependencies = {
  remote: StoreRemotePort;
  applyPersistedProjection: (dataMode: AppStore["dataMode"], update: () => void) => void;
};

export type AppSliceCreator<T> = StateCreator<AppStore, [], [], T>;
