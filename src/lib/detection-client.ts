"use client";

import { useAppStore } from "@/lib/store";
import type { Detection } from "@/lib/types";

export type DetectionStatusSnapshot = Pick<
  Detection,
  "id" | "status" | "stage" | "totalRuns" | "completedRuns" | "failedRuns" | "attempt" | "updatedAt"
  | "collectionTotal" | "collectionCompleted" | "analysisTotal" | "analysisCompleted" | "progressMessage"
>;

export async function ensureServerDetectionTask(detectionId: string) {
  const state = useAppStore.getState();
  const detection = state.detections.find((item) => item.id === detectionId);
  const brand = state.brands.find((item) => item.id === detection?.brandId);
  if (!detection || !brand) throw new Error("检测任务或品牌档案不存在");
  const questions = detection.questionIds.flatMap((questionId) => {
    const question = brand.questions.find((item) => item.id === questionId);
    return question ? [{ id: question.id, text: question.text }] : [];
  });
  if (questions.length !== detection.questionIds.length) throw new Error("部分检测问题已不存在");

  const response = await fetch("/api/detections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      id: detection.id,
      sourceDetectionId: detection.sourceDetectionId,
      providers: detection.providers,
      brand: {
        id: brand.id,
        name: brand.name,
        characteristics: brand.characteristics ?? "",
        categoryName: brand.categoryName ?? "",
        trustProof: brand.trustProof ?? "",
        positioningStatement: brand.positioningStatement ?? "",
        industry: brand.industry ?? "",
        intro: brand.intro ?? "",
        serviceArea: brand.serviceArea ?? "",
        targetAudience: brand.targetAudience ?? "",
        products: (Array.isArray(brand.products) ? brand.products : []).map((product) => ({
          id: product.id,
          name: product.name,
          type: product.type ?? "",
          description: product.description ?? "",
          price: product.price ?? "",
          features: product.features ?? "",
          audience: product.audience ?? "",
          updatedAt: product.updatedAt ?? "",
        })),
        competitors: (Array.isArray(brand.competitors) ? brand.competitors : []).map((competitor) => ({
          id: competitor.id,
          name: competitor.name,
          description: competitor.description ?? "",
        })),
      },
      questions,
    }),
  });
  const serverDetection = await readDetectionResponse(response);
  useAppStore.getState().syncServerDetection(serverDetection);
  return serverDetection;
}

export async function readDetectionResponse(response: Response): Promise<Detection> {
  const payload = await response.json().catch(() => undefined) as
    | { detection?: Detection; error?: string }
    | undefined;
  if (!response.ok || !payload?.detection) {
    throw new Error(payload?.error || "检测任务接口调用失败");
  }
  return payload.detection;
}

export async function readDetectionStatusResponse(response: Response): Promise<DetectionStatusSnapshot> {
  const payload = await response.json().catch(() => undefined) as
    | { status?: DetectionStatusSnapshot; error?: string }
    | undefined;
  if (!response.ok || !payload?.status) {
    throw new Error(payload?.error || "检测状态查询失败");
  }
  return payload.status;
}
