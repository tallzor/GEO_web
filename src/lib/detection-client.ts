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
  const subjectType = detection.subjectType || "brand";
  const subjectId = detection.subjectId || brand.id;
  const product = subjectType === "product" ? brand.products.find((item) => item.id === subjectId) : undefined;
  if (subjectType === "product" && !product) throw new Error("检测产品或服务不存在");
  const questions = detection.questionIds.flatMap((questionId) => {
    const question = brand.questions.find((item) => item.id === questionId);
    return question && question.enabled && question.subjectType === subjectType && question.subjectId === subjectId
      ? [{ id: question.id, text: question.text }]
      : [];
  });
  if (questions.length !== detection.questionIds.length) throw new Error("部分检测问题已停用、不存在或不属于当前检测对象");

  const response = await fetch("/api/detections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      id: detection.id,
      sourceDetectionId: detection.sourceDetectionId,
      providers: detection.providers,
      subjectType,
      subjectId,
      subjectName: detection.subjectName || (subjectType === "product" ? product?.name : brand.name),
      brand: {
        id: brand.id,
        name: subjectType === "product" ? product?.name || "" : brand.name,
        shortName: subjectType === "product" ? "" : brand.shortName ?? "",
        characteristics: subjectType === "product" ? product?.features || "" : brand.characteristics ?? "",
        categoryName: subjectType === "product" ? product?.type || brand.categoryName : brand.categoryName ?? "",
        trustProof: subjectType === "product" ? product?.evidence || "" : brand.trustProof ?? "",
        positioningStatement: subjectType === "product" ? product?.advantages || "" : brand.positioningStatement ?? "",
        industry: brand.industry ?? "",
        intro: subjectType === "product" ? product?.description || "" : brand.intro ?? "",
        serviceArea: brand.serviceArea ?? "",
        targetAudience: subjectType === "product" ? product?.audience || brand.targetAudience : brand.targetAudience ?? "",
        products: (subjectType === "product" && product ? [product] : []).map((item) => ({
          id: item.id,
          name: item.name,
          type: item.type ?? "",
          description: item.description ?? "",
          price: item.price ?? "",
          features: item.features ?? "",
          audience: item.audience ?? "",
          scenarios: item.scenarios ?? "",
          advantages: item.advantages ?? "",
          problemsSolved: item.problemsSolved ?? "",
          quantitativeFacts: item.quantitativeFacts ?? "",
          evidence: item.evidence ?? "",
          limitations: item.limitations ?? "",
          otherInfo: item.otherInfo ?? "",
          updatedAt: item.updatedAt ?? "",
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
