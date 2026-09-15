import {
  buildLocalQuestionSimulationRun,
  questionCapacityShortfall,
  validateReviewedCandidates,
} from "@/lib/question-simulator";
import type { AppSliceCreator, QuestionSimulationSlice, StoreDependencies } from "@/lib/store/contracts";
import type { DetectionQuestion, QuestionSimulationRun } from "@/lib/types";
import { createId, isoNow } from "@/lib/utils";

export function createQuestionSimulationSlice(
  dependencies: StoreDependencies,
): AppSliceCreator<QuestionSimulationSlice> {
  return (set, get) => ({
    questionSimulationRuns: [],

    startQuestionSimulation: async (input) => {
      const state = get();
      const active = state.questionSimulationRuns.find((item) => item.subjectType === input.subjectType
        && item.subjectId === input.subjectId
        && (item.status === "queued" || item.status === "generating" || item.status === "review_required"));
      if (active) return active.id;
      const brand = state.brands.find((item) => item.id === input.brandId);
      if (!brand) throw new Error("品牌不存在");
      const cognitionRun = state.cognitionRuns.find((item) => item.brandId === input.brandId
        && item.status === "confirmed"
        && item.insights.some((insight) => insight.subjectType === input.subjectType
          && insight.subjectId === input.subjectId && insight.isCurrent));
      const run = state.dataMode === "supabase"
        ? await dependencies.remote.startQuestionSimulation(input)
        : buildLocalQuestionSimulationRun({ brand, cognitionRun, target: input }, input.mode);
      mergeRun(set, run);
      return run.id;
    },

    loadQuestionSimulation: async (input) => {
      const state = get();
      if (state.dataMode === "local") {
        return input.runId
          ? state.questionSimulationRuns.find((item) => item.id === input.runId)
          : state.questionSimulationRuns.find((item) => item.brandId === input.brandId
            && item.subjectType === input.subjectType && item.subjectId === input.subjectId);
      }
      const run = await dependencies.remote.getQuestionSimulation(input);
      if (run) mergeRun(set, run);
      return run;
    },

    retryQuestionSimulation: async (runId) => {
      const state = get();
      const existing = state.questionSimulationRuns.find((item) => item.id === runId);
      if (!existing) throw new Error("模拟生成批次不存在");
      const brand = state.brands.find((item) => item.id === existing.brandId);
      if (!brand) throw new Error("品牌不存在");
      const cognitionRun = state.cognitionRuns.find((item) => item.insights.some((insight) => insight.id === existing.cognitionInsightId));
      const run = state.dataMode === "supabase"
        ? await dependencies.remote.retryQuestionSimulation(runId)
        : buildLocalQuestionSimulationRun({
            brand,
            cognitionRun,
            target: { subjectType: existing.subjectType, subjectId: existing.subjectId },
          }, existing.mode, runId);
      mergeRun(set, run);
    },

    confirmQuestionSimulation: async (runId, questions) => {
      const state = get();
      const run = state.questionSimulationRuns.find((item) => item.id === runId);
      if (!run) throw new Error("模拟生成批次不存在");
      if (run.status !== "review_required") throw new Error("当前模拟生成批次不能确认");
      const reviewed = validateReviewedCandidates(questions);
      const brand = state.brands.find((item) => item.id === run.brandId);
      if (!brand) throw new Error("品牌不存在");
      const shortfall = questionCapacityShortfall(brand.questions.length, reviewed.length);
      if (shortfall) throw new Error(`问题库容量不足，请先删除${shortfall}道旧问题`);
      if (state.dataMode === "supabase") {
        const result = await dependencies.remote.confirmQuestionSimulation(runId, reviewed);
        dependencies.applyPersistedProjection(state.dataMode, () => set((current) => ({
          questionSimulationRuns: mergeRuns(current.questionSimulationRuns, result.run),
          brands: current.brands.map((item) => item.id === run.brandId ? { ...item, questions: result.questions } : item),
        })));
        return;
      }
      const now = isoNow();
      const generatedIds = new Set(run.candidates.map((item) => item.id));
      const existingById = new Map(run.candidates.map((item) => [item.id, item]));
      const additions: DetectionQuestion[] = reviewed.map((item) => ({
        id: createId("question"),
        text: item.text,
        subjectType: run.subjectType,
        subjectId: run.subjectId,
        persona: item.persona,
        decisionScenario: item.decisionScenario,
        source: generatedIds.has(item.id) ? "simulator" : "manual",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      }));
      const matched = reviewed.filter((item) => generatedIds.has(item.id));
      const confirmedRun: QuestionSimulationRun = {
        ...run,
        status: "confirmed",
        candidates: [],
        adoptedCount: additions.length,
        deletedCount: Math.max(0, run.generatedCount - matched.length),
        editedCount: matched.filter((item) => {
          const original = existingById.get(item.id);
          return original && (original.text !== item.text || original.persona !== item.persona
            || original.decisionScenario !== item.decisionScenario);
        }).length,
        updatedAt: now,
        confirmedAt: now,
      };
      set((current) => ({
        questionSimulationRuns: mergeRuns(current.questionSimulationRuns, confirmedRun),
        brands: current.brands.map((item) => item.id === run.brandId
          ? { ...item, questions: [...additions, ...item.questions] }
          : item),
      }));
    },

    cancelQuestionSimulation: async (runId) => {
      const state = get();
      const existing = state.questionSimulationRuns.find((item) => item.id === runId);
      if (!existing) throw new Error("模拟生成批次不存在");
      const run = state.dataMode === "supabase"
        ? await dependencies.remote.cancelQuestionSimulation(runId)
        : { ...existing, status: "cancelled" as const, candidates: [], deletedCount: existing.generatedCount, updatedAt: isoNow(), completedAt: isoNow() };
      mergeRun(set, run);
    },
  });
}

function mergeRun(set: Parameters<AppSliceCreator<QuestionSimulationSlice>>[0], run: QuestionSimulationRun) {
  set((state) => ({ questionSimulationRuns: mergeRuns(state.questionSimulationRuns, run) }));
}

function mergeRuns(runs: QuestionSimulationRun[], run: QuestionSimulationRun) {
  return [run, ...runs.filter((item) => item.id !== run.id)]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
