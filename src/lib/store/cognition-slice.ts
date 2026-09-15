import { buildCognitionInput, buildLocalCognitionRun, cognitionInputChanged } from "@/lib/cognition";
import type { AppSliceCreator, CognitionSlice, StoreDependencies } from "@/lib/store/contracts";
import type { CognitionRun } from "@/lib/types";
import { isoNow } from "@/lib/utils";

export function createCognitionSlice(
  dependencies: StoreDependencies,
): AppSliceCreator<CognitionSlice> {
  return (set, get) => ({
    cognitionRuns: [],

    startCognition: async (brandId) => {
      const state = get();
      const brand = state.brands.find((item) => item.id === brandId);
      if (!brand) throw new Error("品牌不存在");
      const existing = state.dataMode === "local"
        ? state.cognitionRuns.find((item) => item.brandId === brandId
            && !cognitionInputChanged(buildCognitionInput(brand), item.inputSnapshot))
        : undefined;
      if (existing) return existing.id;
      const run = state.dataMode === "supabase"
        ? await dependencies.remote.startCognition(brandId)
        : buildLocalCognitionRun(brand);
      mergeRun(set, run);
      return run.id;
    },

    loadCognition: async (input) => {
      const state = get();
      if (state.dataMode === "local") {
        return input.runId
          ? state.cognitionRuns.find((item) => item.id === input.runId)
          : state.cognitionRuns.find((item) => item.brandId === input.brandId);
      }
      const run = await dependencies.remote.getCognition(input);
      if (run) mergeRun(set, run);
      return run;
    },

    retryCognition: async (runId) => {
      const state = get();
      const existing = state.cognitionRuns.find((item) => item.id === runId);
      if (!existing) throw new Error("认知分析批次不存在");
      const run = state.dataMode === "supabase"
        ? await dependencies.remote.retryCognition(runId)
        : buildLocalCognitionRun(
            state.brands.find((item) => item.id === existing.brandId) || (() => { throw new Error("品牌不存在"); })(),
            runId,
          );
      mergeRun(set, run);
    },

    confirmCognition: async (runId, revisions) => {
      const state = get();
      const run = state.dataMode === "supabase"
        ? await dependencies.remote.confirmCognition(runId, revisions)
        : confirmLocalRun(state.cognitionRuns, runId, revisions);
      mergeRun(set, run);
    },
  });
}

function mergeRun(
  set: Parameters<AppSliceCreator<CognitionSlice>>[0],
  run: CognitionRun,
) {
  set((state) => {
    const confirmedSubjects = run.status === "confirmed"
      ? new Set(run.insights.map((insight) => `${insight.subjectType}:${insight.subjectId}`))
      : undefined;
    const previousRuns = state.cognitionRuns
      .filter((item) => item.id !== run.id)
      .map((item) => !confirmedSubjects || item.brandId !== run.brandId ? item : ({
        ...item,
        insights: item.insights.map((insight) => confirmedSubjects.has(`${insight.subjectType}:${insight.subjectId}`)
          ? { ...insight, isCurrent: false }
          : insight),
      }));
    return {
      cognitionRuns: [run, ...previousRuns]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    };
  });
}

function confirmLocalRun(
  runs: CognitionRun[],
  runId: string,
  revisions: Array<{ insightId: string; items: Array<{ key: string; conclusion: string }> }>,
) {
  const run = runs.find((item) => item.id === runId);
  if (!run) throw new Error("认知分析批次不存在");
  if (run.status === "confirmed") return run;
  if (run.status !== "review_required") throw new Error("当前认知分析批次不能确认");
  const revisionByInsight = new Map(revisions.map((item) => [item.insightId, item.items]));
  if (revisionByInsight.size !== run.insights.length) throw new Error("必须一次确认本批次的全部洞察");
  const now = isoNow();
  return {
    ...run,
    status: "confirmed" as const,
    confirmedAt: now,
    updatedAt: now,
    insights: run.insights.map((insight) => {
      const revisionsForInsight = revisionByInsight.get(insight.id);
      if (!revisionsForInsight) throw new Error("洞察修订不完整");
      const conclusionByKey = new Map(revisionsForInsight.map((item) => [item.key, item.conclusion.trim()]));
      if (conclusionByKey.size !== insight.items.length) throw new Error("洞察修订不完整");
      return {
        ...insight,
        status: "confirmed" as const,
        version: Math.max(1, insight.version + 1),
        isCurrent: true,
        updatedAt: now,
        items: insight.items.map((item) => ({
          ...item,
          conclusion: conclusionByKey.get(item.key) || "信息不足",
        })),
      };
    }),
  };
}
