import "server-only";

import { FoundationModelError } from "@/lib/server/foundation-model";
import { analyzeQuestionSimulation } from "@/lib/server/question-simulation-analysis";
import {
  claimNextQuestionSimulationWork,
  completeQuestionSimulationWork,
  failQuestionSimulationWork,
} from "@/lib/server/question-simulation-repository";

export async function processNextQuestionSimulationWork(workerId: string) {
  const work = await claimNextQuestionSimulationWork(workerId);
  if (!work) return { processed: false };
  try {
    const analysis = await analyzeQuestionSimulation(work.inputSnapshot);
    await completeQuestionSimulationWork(work, analysis);
    return { processed: true, runId: work.run.id, status: analysis.questions.length ? "review_required" : "failed" };
  } catch (error) {
    await failQuestionSimulationWork(
      work,
      error,
      error instanceof FoundationModelError ? error.retryable : true,
      error instanceof FoundationModelError ? error.category : "analysis",
    );
    return {
      processed: true,
      runId: work.run.id,
      status: "failed",
      error: error instanceof Error ? error.message : "模拟问题生成失败",
    };
  }
}
