import { createSevenDayCycle, generateContent, reviewContent } from "@/lib/engine";
import type { SeedData } from "@/lib/seed";
import type { AppSliceCreator, OptimizationSlice, StoreDependencies } from "@/lib/store/contracts";
import type { OptimizationCycle } from "@/lib/types";
import { isoNow } from "@/lib/utils";

export function createOptimizationSlice(
  initial: SeedData,
  dependencies: StoreDependencies,
): AppSliceCreator<OptimizationSlice> {
  const contentRequests = new Map<string, Promise<string>>();

  return (set, get) => ({
    cycles: initial.cycles,
    contents: initial.contents,
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

      const cycle = state.dataMode === "supabase"
        ? await dependencies.remote.createOptimizationCycle(detectionId, suggestionId)
        : createSevenDayCycle(brand, detection, suggestion);
      dependencies.applyPersistedProjection(state.dataMode, () => {
        set((current) => ({
          cycles: current.cycles.some((item) => item.id === cycle.id) ? current.cycles : [...current.cycles, cycle],
          detections: current.detections.map((item) => item.id === detectionId && item.diagnosis ? {
            ...item,
            diagnosis: {
              ...item.diagnosis,
              suggestions: item.diagnosis.suggestions.map((candidate) => ({
                ...candidate,
                selected: candidate.id === suggestionId,
              })),
            },
          } : item),
        }));
      });
      return cycle.id;
    },
    updateTaskStatus: (cycleId, taskId, status) => set((state) => ({
      cycles: state.cycles.map((cycle) => cycle.id === cycleId
        ? setCycleTaskStatus(cycle, taskId, status)
        : cycle),
    })),
    mergePublishedTaskCompletion: (cycleId, taskId) => {
      dependencies.applyPersistedProjection(get().dataMode, () => {
        set((state) => ({
          cycles: state.cycles.map((cycle) => cycle.id === cycleId
            ? setCycleTaskStatus(cycle, taskId, "completed")
            : cycle),
        }));
      });
    },
    terminateCycle: (cycleId) => set((state) => ({
      cycles: state.cycles.map((cycle) => cycle.id === cycleId ? {
        ...cycle,
        status: "terminated",
        terminatedAt: isoNow(),
        tasks: cycle.tasks.map((task) => task.status === "completed" ? task : { ...task, status: "void" }),
      } : cycle),
    })),
    ensureTaskContent: (cycleId, taskId) => {
      const existing = get().contents.find((item) => item.cycleId === cycleId && item.taskId === taskId);
      if (existing) return Promise.resolve(existing.id);
      const requestKey = `${cycleId}:${taskId}`;
      const activeRequest = contentRequests.get(requestKey);
      if (activeRequest) return activeRequest;

      const request = createTaskContent(cycleId, taskId, get, set, dependencies)
        .finally(() => contentRequests.delete(requestKey));
      contentRequests.set(requestKey, request);
      return request;
    },
    updateContent: (contentId, patch) => set((state) => ({
      contents: state.contents.map((content) => content.id === contentId ? {
        ...content,
        ...patch,
        version: content.version + 1,
        riskStatus: "unchecked",
        riskIssues: [],
        status: "draft",
        updatedAt: isoNow(),
      } : content),
    })),
    updateChannelContent: (contentId, channel, title, body) => set((state) => ({
      contents: state.contents.map((content) => content.id === contentId ? {
        ...content,
        title,
        body,
        channels: content.channels.map((item) => item.channel === channel ? { ...item, title, body } : item),
        version: content.version + 1,
        riskStatus: "unchecked",
        riskIssues: [],
        status: "draft",
        updatedAt: isoNow(),
      } : content),
    })),
    regenerateContent: async (contentId) => {
      const state = get();
      const content = state.contents.find((item) => item.id === contentId);
      if (!content) return;
      const cycle = state.cycles.find((item) => item.id === content.cycleId);
      const brand = cycle && state.brands.find((item) => item.id === cycle.brandId);
      if (!cycle || !brand) return;
      const generated = state.dataMode === "supabase"
        ? await dependencies.remote.generateOptimizationContent({ cycleId: cycle.id, taskId: content.taskId, contentId })
        : {
            ...generateContent(brand, cycle, content.taskId),
            id: contentId,
            version: content.version + 1,
            createdAt: content.createdAt,
            generationSource: "rule_fallback" as const,
            promptVersion: "local-template-v1",
          };
      dependencies.applyPersistedProjection(state.dataMode, () => {
        set((current) => ({
          contents: current.contents.map((item) => item.id === contentId ? generated : item),
        }));
      });
    },
    runRiskCheck: (contentId) => {
      const state = get();
      const content = state.contents.find((item) => item.id === contentId);
      const brand = content && state.brands.find((item) => item.id === content.brandId);
      if (!content || !brand) return;
      const review = reviewContent(content, brand);
      set((current) => ({
        contents: current.contents.map((item) => item.id === contentId ? {
          ...item,
          riskIssues: review.issues,
          riskStatus: review.status,
          status: review.status === "blocked" ? "blocked" : "publishable",
          updatedAt: isoNow(),
        } : item),
      }));
    },
  });
}

async function createTaskContent(
  cycleId: string,
  taskId: string,
  get: Parameters<AppSliceCreator<OptimizationSlice>>[1],
  set: Parameters<AppSliceCreator<OptimizationSlice>>[0],
  dependencies: StoreDependencies,
) {
  const state = get();
  const existing = state.contents.find((item) => item.cycleId === cycleId && item.taskId === taskId);
  if (existing) return existing.id;
  const cycle = state.cycles.find((item) => item.id === cycleId);
  const brand = cycle && state.brands.find((item) => item.id === cycle.brandId);
  if (!cycle || !brand) throw new Error("任务上下文不存在");
  const content = state.dataMode === "supabase"
    ? await dependencies.remote.generateOptimizationContent({ cycleId, taskId })
    : { ...generateContent(brand, cycle, taskId), generationSource: "rule_fallback" as const, promptVersion: "local-template-v1" };
  dependencies.applyPersistedProjection(state.dataMode, () => {
    set((current) => ({
      contents: current.contents.some((item) => item.id === content.id)
        ? current.contents
        : [...current.contents, content],
      cycles: current.cycles.map((item) => item.id === cycleId ? {
        ...item,
        tasks: item.tasks.map((task) => task.id === taskId
          ? { ...task, status: "in_progress", contentId: content.id }
          : task),
      } : item),
    }));
  });
  return content.id;
}

function setCycleTaskStatus(cycle: OptimizationCycle, taskId: string, status: Parameters<OptimizationSlice["updateTaskStatus"]>[2]) {
  let tasks = cycle.tasks.map((task) => task.id === taskId ? {
    ...task,
    status,
    completedAt: status === "completed" ? isoNow() : task.completedAt,
  } : task);
  if (status === "completed") {
    const next = tasks.find((task) => task.status !== "completed" && task.status !== "void");
    if (next?.status === "pending") {
      tasks = tasks.map((task) => task.id === next.id ? { ...task, status: "in_progress" as const } : task);
    }
  }
  const firstOpen = tasks.find((task) => task.status !== "completed" && task.status !== "void");
  const allCompleted = tasks.every((task) => task.status === "completed" || task.status === "void");
  return {
    ...cycle,
    tasks,
    currentDay: firstOpen?.day || 7,
    status: allCompleted ? "completed" as const : cycle.status,
  };
}
