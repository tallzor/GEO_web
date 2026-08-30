"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
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
import {
  buildDetectionResults,
  buildDiagnosis,
  createSevenDayCycle,
  generateContent,
  reviewContent,
} from "@/lib/engine";
import { createSeedData } from "@/lib/seed";
import { createId, isoNow } from "@/lib/utils";
import type { WorkspaceSaveScope, WorkspaceSnapshot, WorkspaceSyncStatus } from "@/lib/workspace";

type BrandPatch = Partial<Omit<Brand, "id" | "products" | "competitors" | "knowledge" | "questions">>;
type CreateBrandInput = Pick<Brand, "name"> & Partial<Pick<Brand, "shortName" | "characteristics" | "categoryName" | "trustProof" | "positioningStatement" | "industry" | "intro" | "serviceArea" | "targetAudience">> & {
  products?: Omit<ProductService, "id" | "updatedAt">[];
  competitors?: Omit<Competitor, "id">[];
};

export type AppStore = {
  hydrated: boolean;
  loggedIn: boolean;
  dataMode: "local" | "supabase";
  workspaceLoaded: boolean;
  workspaceStatus: WorkspaceSyncStatus;
  workspaceError: string;
  user: UserProfile;
  brands: Brand[];
  currentBrandId: string;
  detections: Detection[];
  cycles: OptimizationCycle[];
  contents: ContentItem[];
  publishBatches: PublishBatch[];
  publishRecords: PublishRecord[];
  platforms: PublishingPlatform[];
  setHydrated: (value: boolean) => void;
  configureDataMode: (mode: "local" | "supabase") => void;
  replaceWorkspace: (snapshot: WorkspaceSnapshot) => void;
  setWorkspaceSyncStatus: (status: WorkspaceSyncStatus, error?: string) => void;
  clearWorkspace: () => void;
  login: () => void;
  logout: () => void;
  resetDemo: () => void;
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
  startDetection: (brandId: string, providers: ProviderId[], questionIds: string[], sourceDetectionId?: string) => string;
  advanceDetection: (detectionId: string) => void;
  advanceLiveDetectionStep: (detectionId: string) => void;
  appendDetectionResult: (detectionId: string, result: DetectionResult) => void;
  recordDetectionError: (detectionId: string, provider: ProviderId, questionId: string, message: string, runKey?: string, category?: ProviderErrorCategory, retryable?: boolean) => void;
  applyLiveDetectionAnalysis: (detectionId: string, results: DetectionResult[], diagnosis: Diagnosis, analysisModel: string) => void;
  finishLiveDetection: (detectionId: string) => void;
  syncServerDetection: (detection: Detection) => void;
  mergeServerDetections: (detections: Detection[]) => void;
  retryDetection: (detectionId: string) => Promise<void>;
  selectObjective: (detectionId: string, suggestionId: string) => Promise<string>;
  updateTaskStatus: (cycleId: string, taskId: string, status: TaskStatus) => void;
  terminateCycle: (cycleId: string) => void;
  ensureTaskContent: (cycleId: string, taskId: string) => Promise<string>;
  updateContent: (contentId: string, patch: Partial<Pick<ContentItem, "title" | "body" | "selectedChannel">>) => void;
  updateChannelContent: (contentId: string, channel: ChannelId, title: string, body: string) => void;
  regenerateContent: (contentId: string) => Promise<void>;
  runRiskCheck: (contentId: string) => void;
  publishContent: (contentId: string, channel: ChannelId) => string;
  retryPublish: (recordId: string) => void;
  updateUser: (patch: Partial<UserProfile>) => void;
  updatePlatform: (channel: ChannelId, patch: Partial<PublishingPlatform>) => void;
};

const seed = createSeedData();

async function requestGeneratedContent(input: {
  cycleId: string;
  taskId: string;
  contentId?: string;
}) {
  const response = await fetch("/api/contents/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => undefined) as {
    content?: ContentItem;
    error?: string;
  } | undefined;
  if (!response.ok || !payload?.content) {
    throw new Error(payload?.error || "优化内容生成失败，请稍后重试");
  }
  return payload.content;
}

function setCycleTaskStatus(cycle: OptimizationCycle, taskId: string, status: TaskStatus) {
  let tasks = cycle.tasks.map((task) =>
    task.id === taskId
      ? { ...task, status, completedAt: status === "completed" ? isoNow() : task.completedAt }
      : task,
  );
  if (status === "completed") {
    const next = tasks.find((task) => task.status !== "completed" && task.status !== "void");
    if (next?.status === "pending") tasks = tasks.map((task) => task.id === next.id ? { ...task, status: "in_progress" as const } : task);
  }
  const firstOpen = tasks.find((task) => task.status !== "completed" && task.status !== "void");
  const allCompleted = tasks.every((task) => task.status === "completed" || task.status === "void");
  return { ...cycle, tasks, currentDay: firstOpen?.day || 7, status: allCompleted ? "completed" as const : cycle.status };
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      hydrated: false,
      loggedIn: false,
      dataMode: "local",
      workspaceLoaded: false,
      workspaceStatus: "idle",
      workspaceError: "",
      user: seed.user,
      brands: seed.brands,
      currentBrandId: seed.brands[0]?.id || "",
      detections: seed.detections,
      cycles: seed.cycles,
      contents: seed.contents,
      publishBatches: seed.publishBatches,
      publishRecords: seed.publishRecords,
      platforms: seed.platforms,
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
      clearWorkspace: () => set({
        brands: [],
        currentBrandId: "",
        detections: [],
        cycles: [],
        contents: [],
        publishBatches: [],
        publishRecords: [],
        platforms: [],
        workspaceLoaded: false,
        workspaceStatus: "idle",
        workspaceError: "",
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
        });
      },
      setCurrentBrand: (brandId) => set({ currentBrandId: brandId }),
      createBrand: (input) => {
        const id = createId("brand");
        const now = isoNow();
        const brand: Brand = {
          id,
          name: input.name,
          shortName: input.shortName || "",
          characteristics: input.characteristics || "",
          categoryName: input.categoryName || "",
          trustProof: input.trustProof || "",
          positioningStatement: input.positioningStatement || "",
          industry: input.industry || "",
          website: "",
          intro: input.intro || "",
          city: "",
          stores: [],
          serviceArea: input.serviceArea || "",
          targetAudience: input.targetAudience || "",
          products: (input.products || []).map((item) => ({ ...item, id: createId("product"), updatedAt: now })),
          competitors: (input.competitors || []).map((item) => ({ ...item, id: createId("competitor") })),
          knowledge: [],
          questions: [],
          questionContextUpdatedAt: now,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ brands: [...state.brands, brand], currentBrandId: id }));
        return id;
      },
      removeBrand: (brandId, nextBrandId) => set((state) => {
        const brands = state.brands.filter((brand) => brand.id !== brandId);
        const preferredBrandId = nextBrandId && brands.some((brand) => brand.id === nextBrandId)
          ? nextBrandId
          : brands[0]?.id || "";
        return {
          brands,
          currentBrandId: state.currentBrandId === brandId ? preferredBrandId : state.currentBrandId,
          detections: state.detections.filter((detection) => detection.brandId !== brandId),
          cycles: state.cycles.filter((cycle) => cycle.brandId !== brandId),
          contents: state.contents.filter((content) => content.brandId !== brandId),
          publishBatches: state.publishBatches.filter((batch) => batch.brandId !== brandId),
          publishRecords: state.publishRecords.filter((record) => record.brandId !== brandId),
          platforms: state.platforms.filter((platform) => platform.brandId !== brandId),
        };
      }),
      updateBrand: (brandId, patch) =>
        set((state) => ({
          brands: state.brands.map((brand) =>
            brand.id === brandId
              ? {
                  ...brand,
                  ...patch,
                  updatedAt: isoNow(),
                  questionContextUpdatedAt: ["name", "shortName", "characteristics", "categoryName", "trustProof", "positioningStatement", "industry", "intro", "serviceArea", "targetAudience"].some(
                    (key) => key in patch,
                  )
                    ? isoNow()
                    : brand.questionContextUpdatedAt,
                }
              : brand,
          ),
        })),
      addProduct: (brandId, product) =>
        set((state) => ({
          brands: state.brands.map((brand) =>
            brand.id === brandId
              ? { ...brand, products: [...brand.products, { ...product, id: createId("product"), updatedAt: isoNow() }], updatedAt: isoNow() }
              : brand,
          ),
        })),
      updateProduct: (brandId, productId, patch) =>
        set((state) => ({
          brands: state.brands.map((brand) =>
            brand.id === brandId
              ? {
                  ...brand,
                  products: brand.products.map((product) =>
                    product.id === productId ? { ...product, ...patch, updatedAt: isoNow() } : product,
                  ),
                  updatedAt: isoNow(),
                }
              : brand,
          ),
        })),
      deleteProduct: (brandId, productId) =>
        set((state) => ({
          brands: state.brands.map((brand) =>
            brand.id === brandId ? { ...brand, products: brand.products.filter((item) => item.id !== productId), updatedAt: isoNow() } : brand,
          ),
        })),
      addCompetitor: (brandId, competitor) =>
        set((state) => ({
          brands: state.brands.map((brand) =>
            brand.id === brandId
              ? { ...brand, competitors: [...brand.competitors, { ...competitor, id: createId("competitor") }], updatedAt: isoNow(), questionContextUpdatedAt: isoNow() }
              : brand,
          ),
        })),
      updateCompetitor: (brandId, competitorId, patch) =>
        set((state) => ({
          brands: state.brands.map((brand) =>
            brand.id === brandId
              ? { ...brand, competitors: brand.competitors.map((item) => (item.id === competitorId ? { ...item, ...patch } : item)), updatedAt: isoNow(), questionContextUpdatedAt: isoNow() }
              : brand,
          ),
        })),
      deleteCompetitor: (brandId, competitorId) =>
        set((state) => ({
          brands: state.brands.map((brand) =>
            brand.id === brandId ? { ...brand, competitors: brand.competitors.filter((item) => item.id !== competitorId), updatedAt: isoNow(), questionContextUpdatedAt: isoNow() } : brand,
          ),
        })),
      addKnowledge: (brandId, attachment) => {
        const id = createId("knowledge");
        set((state) => ({
          brands: state.brands.map((brand) =>
            brand.id === brandId
              ? { ...brand, knowledge: [...brand.knowledge, { ...attachment, id, uploadedAt: isoNow() }], updatedAt: isoNow() }
              : brand,
          ),
        }));
        return id;
      },
      updateKnowledgeStatus: (brandId, attachmentId, status, error) =>
        set((state) => ({
          brands: state.brands.map((brand) =>
            brand.id === brandId
              ? { ...brand, knowledge: brand.knowledge.map((item) => (item.id === attachmentId ? { ...item, status, error } : item)), updatedAt: isoNow() }
              : brand,
          ),
        })),
      deleteKnowledge: (brandId, attachmentId) =>
        set((state) => ({
          brands: state.brands.map((brand) =>
            brand.id === brandId ? { ...brand, knowledge: brand.knowledge.filter((item) => item.id !== attachmentId), updatedAt: isoNow() } : brand,
          ),
        })),
      addQuestion: (brandId, text, category) =>
        set((state) => ({
          brands: state.brands.map((brand) =>
            brand.id === brandId
              ? {
                  ...brand,
                  questions: [...brand.questions, { id: createId("question"), text, category, source: "custom", enabled: true, updatedAt: isoNow() }],
                }
              : brand,
          ),
        })),
      updateQuestion: (brandId, questionId, patch) =>
        set((state) => ({
          brands: state.brands.map((brand) =>
            brand.id === brandId
              ? { ...brand, questions: brand.questions.map((item) => (item.id === questionId ? { ...item, ...patch, updatedAt: isoNow() } : item)) }
              : brand,
          ),
        })),
      deleteQuestion: (brandId, questionId) =>
        set((state) => ({
          brands: state.brands.map((brand) =>
            brand.id === brandId ? { ...brand, questions: brand.questions.filter((item) => item.id !== questionId) } : brand,
          ),
        })),
      addGeneratedQuestions: (brandId, questionTexts) => {
        const now = isoNow();
        const ids: string[] = [];
        set((state) => ({
          brands: state.brands.map((brand) => {
            if (brand.id !== brandId) return brand;
            const existing = new Set(brand.questions.map((item) => item.text.trim()));
            const additions = questionTexts.flatMap((text) => {
              const normalized = text.trim();
              if (!normalized || existing.has(normalized)) return [];
              existing.add(normalized);
              const id = createId("question");
              ids.push(id);
              return [{
                id,
                text: normalized,
                source: "generated" as const,
                category: "",
                enabled: true,
                updatedAt: now,
              }];
            });
            return {
              ...brand,
              questions: [...brand.questions, ...additions],
              questionsGeneratedAt: now,
              updatedAt: now,
            };
          }),
        }));
        return ids;
      },
      mergePersistedQuestions: (brandId, questions, generatedAt) => {
        const ids = questions.map((question) => question.id);
        set((state) => ({
          brands: state.brands.map((brand) => {
            if (brand.id !== brandId) return brand;
            const incoming = new Map(questions.map((question) => [question.id, question]));
            const merged = brand.questions.map((question) => incoming.get(question.id) || question);
            const knownIds = new Set(brand.questions.map((question) => question.id));
            return {
              ...brand,
              questions: [...merged, ...questions.filter((question) => !knownIds.has(question.id))],
              questionsGeneratedAt: generatedAt,
              updatedAt: generatedAt,
            };
          }),
        }));
        return ids;
      },
      startDetection: (brandId, providers, questionIds, sourceDetectionId) => {
        const id = createId("detection");
        const usesLiveProvider = providers.length > 0
          && providers.every((provider) =>
            provider === "doubao" || provider === "deepseek" || provider === "yuanbao"
          );
        const detection: Detection = {
          id,
          brandId,
          name: sourceDetectionId ? "GEO复测" : "GEO检测",
          status: usesLiveProvider ? "pending" : "running",
          providers,
          questionIds,
          totalRuns: providers.length * questionIds.length + (usesLiveProvider ? 1 : 0),
          completedRuns: 0,
          failedRuns: 0,
          createdAt: isoNow(),
          sourceDetectionId,
          results: [],
          dataSource: usesLiveProvider ? "live_api" : "mock",
          collectionMethod: usesLiveProvider ? "model_api" : undefined,
          runErrors: [],
          attempt: 1,
          stage: usesLiveProvider ? "queued" : undefined,
          serverManaged: usesLiveProvider,
          updatedAt: isoNow(),
        };
        set((state) => ({ detections: [...state.detections, detection] }));
        return id;
      },
      advanceDetection: (detectionId) => {
        const state = get();
        const detection = state.detections.find((item) => item.id === detectionId);
        if (!detection || detection.status !== "running") return;
        if (detection.dataSource === "live_api") return;
        const increment = Math.max(1, Math.ceil(detection.totalRuns / 6));
        const completedRuns = Math.min(detection.totalRuns, detection.completedRuns + increment);
        if (completedRuns < detection.totalRuns) {
          set((current) => ({ detections: current.detections.map((item) => (item.id === detectionId ? { ...item, completedRuns } : item)) }));
          return;
        }
        const brand = state.brands.find((item) => item.id === detection.brandId);
        if (!brand) return;
        const completedDetection = { ...detection, completedRuns, status: "completed" as const, completedAt: isoNow() };
        const results = buildDetectionResults(brand, completedDetection);
        const diagnosis = buildDiagnosis(brand, completedDetection, results);
        set((current) => ({
          detections: current.detections.map((item) =>
            item.id === detectionId ? { ...completedDetection, results, diagnosis } : item,
          ),
        }));
      },
      advanceLiveDetectionStep: (detectionId) =>
        set((state) => ({
          detections: state.detections.map((item) =>
            item.id === detectionId && item.status === "running"
              ? { ...item, completedRuns: Math.min(item.totalRuns, item.completedRuns + 1) }
              : item,
          ),
        })),
      appendDetectionResult: (detectionId, result) =>
        set((state) => ({
          detections: state.detections.map((item) => {
            if (item.id !== detectionId || item.status !== "running") return item;
            const duplicate = item.results.some(
              (existing) => existing.provider === result.provider && existing.questionId === result.questionId,
            );
            if (duplicate) return item;
            const results = [...item.results, result];
            return { ...item, results };
          }),
        })),
      recordDetectionError: (detectionId, provider, questionId, message, runKey, category, retryable) =>
        set((state) => ({
          detections: state.detections.map((item) => {
            if (item.id !== detectionId || item.status !== "running") return item;
            const duplicate = item.runErrors?.some(
              (error) => error.provider === provider && error.questionId === questionId && error.runKey === runKey,
            );
            if (duplicate) return item;
            const runErrors = [...(item.runErrors || []), { provider, questionId, message, runKey, category, retryable }];
            return {
              ...item,
              runErrors,
              failedRuns: runErrors.length,
              completedRuns: Math.min(item.totalRuns, item.completedRuns + 1),
            };
          }),
        })),
      applyLiveDetectionAnalysis: (detectionId, results, diagnosis, analysisModel) =>
        set((state) => ({
          detections: state.detections.map((item) => {
            if (item.id !== detectionId || item.dataSource !== "live_api") return item;
            return {
              ...item,
              results,
              diagnosis,
              analysisModel,
              status: item.failedRuns > 0 ? "partial" as const : "completed" as const,
              completedRuns: item.totalRuns,
              completedAt: isoNow(),
            };
          }),
        })),
      finishLiveDetection: (detectionId) =>
        set((state) => ({
          detections: state.detections.map((item) => {
            if (item.id !== detectionId || item.dataSource !== "live_api") return item;
            const status = item.results.length === 0
              ? "failed" as const
              : item.failedRuns > 0
                ? "partial" as const
                : "completed" as const;
            return {
              ...item,
              status,
              completedRuns: item.totalRuns,
              completedAt: isoNow(),
            };
          }),
        })),
      syncServerDetection: (detection) =>
        set((state) => ({
          detections: state.detections.some((item) => item.id === detection.id)
            ? state.detections.map((item) => item.id === detection.id ? detection : item)
            : [detection, ...state.detections],
        })),
      mergeServerDetections: (detections) =>
        set((state) => {
          const serverIds = new Set(detections.map((item) => item.id));
          return {
            detections: [
              ...detections,
              ...state.detections.filter((item) => !serverIds.has(item.id)),
            ],
          };
        }),
      retryDetection: async (detectionId) => {
        const detection = get().detections.find((item) => item.id === detectionId);
        if (!detection) return;
        if (detection.dataSource !== "live_api") {
          set((state) => ({
            detections: state.detections.map((item) =>
              item.id === detectionId ? { ...item, status: "running", failedRuns: 0 } : item,
            ),
          }));
          return;
        }
        set((state) => ({
          detections: state.detections.map((item) =>
            item.id === detectionId
              ? {
                  ...item,
                  status: "pending",
                  stage: "queued",
                  failedRuns: 0,
                  completedRuns: 0,
                  results: [],
                  runErrors: [],
                  diagnosis: undefined,
                  analysisModel: undefined,
                  completedAt: undefined,
                  attempt: (item.attempt || 1) + 1,
                }
              : item,
          ),
        }));
        try {
          const response = await fetch(`/api/detections/${encodeURIComponent(detectionId)}/retry`, {
            method: "POST",
          });
          const payload = await response.json() as { detection?: Detection; error?: string };
          if (!response.ok || !payload.detection) throw new Error(payload.error || "重试检测失败");
          get().syncServerDetection(payload.detection);
        } catch (error) {
          set((state) => ({
            detections: state.detections.map((item) =>
              item.id === detectionId
                ? {
                    ...item,
                    status: "failed",
                    stage: "failed",
                    runErrors: [{
                      provider: item.providers[0] || "doubao",
                      questionId: "__task__",
                      message: error instanceof Error ? error.message : "重试检测失败",
                      category: "network",
                      retryable: true,
                    }],
                  }
                : item,
            ),
          }));
        }
      },
      selectObjective: async (detectionId, suggestionId) => {
        const state = get();
        const detection = state.detections.find((item) => item.id === detectionId);
        if (!detection?.diagnosis) throw new Error("诊断报告尚未完成");
        const existing = state.cycles.find((item) => item.brandId === detection.brandId && item.status === "active");
        if (existing) return existing.id;
        const suggestion = detection.diagnosis.suggestions.find((item) => item.id === suggestionId);
        if (!suggestion) throw new Error("优化建议不存在");
        const brand = state.brands.find((item) => item.id === detection.brandId);
        if (!brand) throw new Error("品牌档案不存在");
        let cycle: OptimizationCycle;
        if (state.dataMode === "supabase") {
          const response = await fetch("/api/optimization/cycles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ detectionId, suggestionId }),
          });
          const payload = await response.json().catch(() => undefined) as { cycle?: OptimizationCycle; error?: string } | undefined;
          if (!response.ok || !payload?.cycle) {
            throw new Error(payload?.error || "优化目标和7天任务保存失败");
          }
          cycle = payload.cycle;
        } else {
          cycle = createSevenDayCycle(brand, detection, suggestion);
        }
        set((current) => ({
          cycles: current.cycles.some((item) => item.id === cycle.id) ? current.cycles : [...current.cycles, cycle],
          detections: current.detections.map((item) =>
            item.id === detectionId && item.diagnosis
              ? { ...item, diagnosis: { ...item.diagnosis, suggestions: item.diagnosis.suggestions.map((s) => ({ ...s, selected: s.id === suggestionId })) } }
              : item,
          ),
        }));
        return cycle.id;
      },
      updateTaskStatus: (cycleId, taskId, status) =>
        set((state) => ({
          cycles: state.cycles.map((cycle) => cycle.id === cycleId ? setCycleTaskStatus(cycle, taskId, status) : cycle),
        })),
      terminateCycle: (cycleId) =>
        set((state) => ({
          cycles: state.cycles.map((cycle) =>
            cycle.id === cycleId
              ? { ...cycle, status: "terminated", terminatedAt: isoNow(), tasks: cycle.tasks.map((task) => (task.status === "completed" ? task : { ...task, status: "void" })) }
              : cycle,
          ),
        })),
      ensureTaskContent: async (cycleId, taskId) => {
        const state = get();
        const existing = state.contents.find((item) => item.cycleId === cycleId && item.taskId === taskId);
        if (existing) return existing.id;
        const cycle = state.cycles.find((item) => item.id === cycleId);
        const brand = cycle && state.brands.find((item) => item.id === cycle.brandId);
        if (!cycle || !brand) throw new Error("任务上下文不存在");
        const content = state.dataMode === "supabase"
          ? await requestGeneratedContent({ cycleId, taskId })
          : { ...generateContent(brand, cycle, taskId), generationSource: "rule_fallback" as const, promptVersion: "local-template-v1" };
        set((current) => ({
          contents: [...current.contents, content],
          cycles: current.cycles.map((item) =>
            item.id === cycleId
              ? { ...item, tasks: item.tasks.map((task) => (task.id === taskId ? { ...task, status: "in_progress", contentId: content.id } : task)) }
              : item,
          ),
        }));
        return content.id;
      },
      updateContent: (contentId, patch) =>
        set((state) => ({
          contents: state.contents.map((content) =>
            content.id === contentId
              ? { ...content, ...patch, version: content.version + 1, riskStatus: "unchecked", riskIssues: [], status: "draft", updatedAt: isoNow() }
              : content,
          ),
        })),
      updateChannelContent: (contentId, channel, title, body) =>
        set((state) => ({
          contents: state.contents.map((content) =>
            content.id === contentId
              ? {
                  ...content,
                  title,
                  body,
                  channels: content.channels.map((item) => (item.channel === channel ? { ...item, title, body } : item)),
                  version: content.version + 1,
                  riskStatus: "unchecked",
                  riskIssues: [],
                  status: "draft",
                  updatedAt: isoNow(),
                }
              : content,
          ),
        })),
      regenerateContent: async (contentId) => {
        const state = get();
        const content = state.contents.find((item) => item.id === contentId);
        if (!content) return;
        const cycle = state.cycles.find((item) => item.id === content.cycleId);
        const brand = cycle && state.brands.find((item) => item.id === cycle.brandId);
        if (!cycle || !brand) return;
        const generated = state.dataMode === "supabase"
          ? await requestGeneratedContent({ cycleId: cycle.id, taskId: content.taskId, contentId })
          : {
              ...generateContent(brand, cycle, content.taskId),
              id: contentId,
              version: content.version + 1,
              createdAt: content.createdAt,
              generationSource: "rule_fallback" as const,
              promptVersion: "local-template-v1",
            };
        set((current) => ({
          contents: current.contents.map((item) =>
            item.id === contentId ? generated : item,
          ),
        }));
      },
      runRiskCheck: (contentId) => {
        const state = get();
        const content = state.contents.find((item) => item.id === contentId);
        const brand = content && state.brands.find((item) => item.id === content.brandId);
        if (!content || !brand) return;
        const review = reviewContent(content, brand);
        set((current) => ({
          contents: current.contents.map((item) =>
            item.id === contentId
              ? { ...item, riskIssues: review.issues, riskStatus: review.status, status: review.status === "blocked" ? "blocked" : "publishable", updatedAt: isoNow() }
              : item,
          ),
        }));
      },
      publishContent: (contentId, channel) => {
        const state = get();
        const content = state.contents.find((item) => item.id === contentId);
        const platform = state.platforms.find((item) => item.channel === channel);
        const brand = content && state.brands.find((item) => item.id === content.brandId);
        if (!content || !brand) throw new Error("内容或品牌信息不存在");
        const liveReview = content.riskStatus === "unchecked" ? reviewContent(content, brand) : { status: content.riskStatus, issues: content.riskIssues };
        if (liveReview.status === "blocked") throw new Error("内容风险检查尚未通过");
        if (!platform?.configured) throw new Error("发布平台尚未配置");
        const channelContent = content.channels.find((item) => item.channel === channel);
        const id = createId("publish");
        const record: PublishRecord = {
          id,
          brandId: content.brandId,
          cycleId: content.cycleId,
          taskId: content.taskId,
          contentId: content.id,
          contentVersion: content.version,
          title: channelContent?.title || content.title,
          bodySnapshot: channelContent?.body || content.body,
          channel,
          accountName: platform.accountName,
          status: channel === "wechat" ? "draft_saved" : "published",
          createdAt: isoNow(),
          completedAt: isoNow(),
        };
        set((current) => ({
          publishRecords: [record, ...current.publishRecords],
          contents: current.contents.map((item) => (item.id === contentId ? { ...item, selectedChannel: channel, status: "published", riskStatus: liveReview.status, riskIssues: liveReview.issues, updatedAt: isoNow() } : item)),
          cycles: current.cycles.map((cycle) =>
            cycle.id === content.cycleId
              ? setCycleTaskStatus(cycle, content.taskId, "completed")
              : cycle,
          ),
        }));
        return id;
      },
      retryPublish: (recordId) =>
        set((state) => ({
          publishRecords: state.publishRecords.map((record) =>
            record.id === recordId
              ? { ...record, status: record.channel === "wechat" ? "draft_saved" : "published", error: undefined, completedAt: isoNow() }
              : record,
          ),
        })),
      updateUser: (patch) => set((state) => ({ user: { ...state.user, ...patch } })),
      updatePlatform: (channel, patch) =>
        set((state) => ({ platforms: state.platforms.map((platform) => (platform.channel === channel ? { ...platform, ...patch } : platform)) })),
    }),
    {
      name: "geo-web-demo-v3",
      version: 3,
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

export function workspaceSnapshot(state: AppStore): WorkspaceSnapshot {
  return {
    user: state.user,
    brands: state.brands,
    currentBrandId: state.currentBrandId,
    detections: state.detections,
    cycles: state.cycles,
    contents: state.contents,
    publishBatches: state.publishBatches,
    publishRecords: state.publishRecords,
    platforms: state.platforms,
  };
}

let remoteSaveTimer: ReturnType<typeof setTimeout> | undefined;
let requestedSaveRevision = 0;
let persistedSaveRevision = 0;
let remoteSavePromise: Promise<void> | undefined;
const pendingSaveScopes = new Set<WorkspaceSaveScope>();

function changedSaveScopes(state: AppStore, previous: AppStore) {
  const scopes: WorkspaceSaveScope[] = [];
  if (state.user !== previous.user) scopes.push("user");
  if (state.brands !== previous.brands) scopes.push("brands");
  if (state.currentBrandId !== previous.currentBrandId) scopes.push("currentBrand");
  if (state.cycles !== previous.cycles) scopes.push("cycles");
  if (state.contents !== previous.contents) scopes.push("contents");
  if (state.publishRecords !== previous.publishRecords) scopes.push("publishRecords");
  if (state.platforms !== previous.platforms) scopes.push("platforms");
  return scopes;
}

function scheduleRemoteSave(scopes: WorkspaceSaveScope[]) {
  scopes.forEach((scope) => pendingSaveScopes.add(scope));
  requestedSaveRevision += 1;
  if (remoteSaveTimer) clearTimeout(remoteSaveTimer);
  remoteSaveTimer = setTimeout(() => {
    remoteSaveTimer = undefined;
    void ensureRemoteSaveWorker().catch(() => undefined);
  }, 100);
}

function ensureRemoteSaveWorker() {
  if (!remoteSavePromise) {
    remoteSavePromise = runRemoteSaveLoop().finally(() => {
      remoteSavePromise = undefined;
    });
  }
  return remoteSavePromise;
}

async function runRemoteSaveLoop() {
  while (persistedSaveRevision < requestedSaveRevision) {
    const targetRevision = requestedSaveRevision;
    const scopes = [...pendingSaveScopes];
    pendingSaveScopes.clear();
    const state = useAppStore.getState();
    if (state.dataMode !== "supabase" || !state.workspaceLoaded || state.workspaceStatus === "loading") {
      persistedSaveRevision = targetRevision;
      return;
    }
    state.setWorkspaceSyncStatus("syncing");
    try {
      const response = await fetch("/api/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot: workspaceSnapshot(state), scopes }),
      });
      const payload = await response.json().catch(() => undefined) as { error?: string } | undefined;
      if (!response.ok) throw new Error(payload?.error || "工作空间数据保存失败");
      persistedSaveRevision = targetRevision;
    } catch (error) {
      scopes.forEach((scope) => pendingSaveScopes.add(scope));
      useAppStore.getState().setWorkspaceSyncStatus(
        "error",
        error instanceof Error ? error.message : "工作空间数据保存失败",
      );
      throw error;
    }
  }
  useAppStore.getState().setWorkspaceSyncStatus("ready");
}

export async function flushWorkspaceNow() {
  if (remoteSaveTimer) {
    clearTimeout(remoteSaveTimer);
    remoteSaveTimer = undefined;
  }
  const state = useAppStore.getState();
  if (state.dataMode !== "supabase") return;
  if (remoteSavePromise) await remoteSavePromise.catch(() => undefined);
  if (persistedSaveRevision >= requestedSaveRevision && !pendingSaveScopes.size) return;
  await ensureRemoteSaveWorker();
  const currentState = useAppStore.getState();
  if (currentState.workspaceStatus === "error") {
    throw new Error(currentState.workspaceError || "工作空间数据保存失败");
  }
}

if (typeof window !== "undefined") {
  useAppStore.subscribe((state, previous) => {
    if (state.dataMode !== "supabase" || state.workspaceStatus === "loading") return;
    if (previous.workspaceStatus === "idle" || previous.workspaceStatus === "loading") return;
    const scopes = changedSaveScopes(state, previous);
    if (scopes.length) scheduleRemoteSave(scopes);
  });
}

export function currentBrand(state: Pick<AppStore, "brands" | "currentBrandId">) {
  return state.brands.find((brand) => brand.id === state.currentBrandId);
}

export function brandDetections(state: Pick<AppStore, "detections" | "currentBrandId">) {
  return state.detections
    .filter((item) => item.brandId === state.currentBrandId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function activeCycle(state: Pick<AppStore, "cycles" | "currentBrandId">) {
  return state.cycles.find((cycle) => cycle.brandId === state.currentBrandId && cycle.status === "active");
}
