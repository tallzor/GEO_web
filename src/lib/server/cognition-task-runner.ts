import "server-only";

import {
  analyzeBrandCognition,
  analyzeProductCognition,
} from "@/lib/server/cognition-analysis";
import {
  claimNextCognitionWork,
  completeCognitionWork,
  failCognitionWork,
} from "@/lib/server/cognition-repository";
import { FoundationModelError } from "@/lib/server/foundation-model";

export async function processNextCognitionWork(workerId: string) {
  const work = await claimNextCognitionWork(workerId);
  if (!work) return { processed: false };
  try {
    const snapshot = work.run.inputSnapshot;
    const brandAnalysis = await analyzeBrandCognition(snapshot);
    const results: Parameters<typeof completeCognitionWork>[1] = [{
      subjectType: "brand",
      subjectId: snapshot.brand.id,
      subjectName: snapshot.brand.name,
      modelType: "brand_six_elements",
      analysis: brandAnalysis,
    }];
    for (const product of snapshot.products) {
      results.push({
        subjectType: "product",
        subjectId: product.id,
        subjectName: product.name,
        modelType: "bfabeww",
        analysis: await analyzeProductCognition(snapshot, product),
      });
    }
    await completeCognitionWork(work, results);
    return { processed: true, runId: work.run.id, status: "review_required" };
  } catch (error) {
    await failCognitionWork(
      work,
      error,
      error instanceof FoundationModelError ? error.retryable : true,
    );
    return {
      processed: true,
      runId: work.run.id,
      status: "failed",
      error: error instanceof Error ? error.message : "认知分析失败",
    };
  }
}
