import { buildDetectionResults, buildDiagnosis } from "@/lib/engine";
import type { SeedData } from "@/lib/seed";
import type { AppSliceCreator, DetectionSlice, StoreDependencies } from "@/lib/store/contracts";
import type { Detection } from "@/lib/types";
import { createId, isoNow } from "@/lib/utils";

export function createDetectionSlice(
  initial: SeedData,
  dependencies: StoreDependencies,
): AppSliceCreator<DetectionSlice> {
  return (set, get) => ({
    detections: initial.detections,
    startDetection: (brandId, target, providers, questionIds, sourceDetectionId) => {
      const id = createId("detection");
      const usesLiveProvider = providers.length > 0
        && providers.every((provider) => provider === "doubao" || provider === "deepseek" || provider === "yuanbao");
      const detection: Detection = {
        id,
        brandId,
        ...target,
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
      if (!detection || detection.status !== "running" || detection.dataSource === "live_api") return;
      const increment = Math.max(1, Math.ceil(detection.totalRuns / 6));
      const completedRuns = Math.min(detection.totalRuns, detection.completedRuns + increment);
      if (completedRuns < detection.totalRuns) {
        set((current) => ({
          detections: current.detections.map((item) => item.id === detectionId ? { ...item, completedRuns } : item),
        }));
        return;
      }
      const brand = state.brands.find((item) => item.id === detection.brandId);
      if (!brand) return;
      const completedDetection = { ...detection, completedRuns, status: "completed" as const, completedAt: isoNow() };
      const results = buildDetectionResults(brand, completedDetection);
      const diagnosis = buildDiagnosis(brand, completedDetection, results);
      set((current) => ({
        detections: current.detections.map((item) => item.id === detectionId
          ? { ...completedDetection, results, diagnosis }
          : item),
      }));
    },
    advanceLiveDetectionStep: (detectionId) => set((state) => ({
      detections: state.detections.map((item) => item.id === detectionId && item.status === "running"
        ? { ...item, completedRuns: Math.min(item.totalRuns, item.completedRuns + 1) }
        : item),
    })),
    appendDetectionResult: (detectionId, result) => set((state) => ({
      detections: state.detections.map((item) => {
        if (item.id !== detectionId || item.status !== "running") return item;
        const duplicate = item.results.some(
          (existing) => existing.provider === result.provider && existing.questionId === result.questionId,
        );
        return duplicate ? item : { ...item, results: [...item.results, result] };
      }),
    })),
    recordDetectionError: (detectionId, provider, questionId, message, runKey, category, retryable) => set((state) => ({
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
    applyLiveDetectionAnalysis: (detectionId, results, diagnosis, analysisModel) => set((state) => ({
      detections: state.detections.map((item) => item.id === detectionId && item.dataSource === "live_api" ? {
        ...item,
        results,
        diagnosis,
        analysisModel,
        status: item.failedRuns > 0 ? "partial" : "completed",
        completedRuns: item.totalRuns,
        completedAt: isoNow(),
      } : item),
    })),
    finishLiveDetection: (detectionId) => set((state) => ({
      detections: state.detections.map((item) => {
        if (item.id !== detectionId || item.dataSource !== "live_api") return item;
        const status = item.results.length === 0 ? "failed" : item.failedRuns > 0 ? "partial" : "completed";
        return { ...item, status, completedRuns: item.totalRuns, completedAt: isoNow() };
      }),
    })),
    syncServerDetection: (detection) => set((state) => ({
      detections: state.detections.some((item) => item.id === detection.id)
        ? state.detections.map((item) => item.id === detection.id ? detection : item)
        : [detection, ...state.detections],
    })),
    mergeServerDetections: (detections) => set((state) => {
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
          detections: state.detections.map((item) => item.id === detectionId
            ? { ...item, status: "running", failedRuns: 0 }
            : item),
        }));
        return;
      }
      set((state) => ({
        detections: state.detections.map((item) => item.id === detectionId ? {
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
        } : item),
      }));
      try {
        const persisted = await dependencies.remote.retryDetection(detectionId);
        get().syncServerDetection(persisted);
      } catch (error) {
        set((state) => ({
          detections: state.detections.map((item) => item.id === detectionId ? {
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
          } : item),
        }));
      }
    },
  });
}
