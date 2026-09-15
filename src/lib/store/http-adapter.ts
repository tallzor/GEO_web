import type {
  CognitionInsightRevision,
  CognitionRun,
  ContentItem,
  Detection,
  OptimizationCycle,
} from "@/lib/types";
import type { WorkspaceSaveResult } from "@/lib/workspace";
import type { StoreRemotePort } from "@/lib/store/contracts";

export const httpStoreAdapter: StoreRemotePort = {
  async saveWorkspace(request) {
    const response = await fetch("/api/workspace", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const payload = await readPayload(response);
    if (!response.ok) throw new Error(readPayloadError(payload, "工作空间数据保存失败"));
    if (typeof payload?.workspaceRevision !== "string" || !payload.workspaceRevision) {
      throw new Error("工作空间保存成功，但服务端未返回新版本");
    }
    return { workspaceRevision: payload.workspaceRevision } satisfies WorkspaceSaveResult;
  },

  async retryDetection(detectionId) {
    const response = await fetch(`/api/detections/${encodeURIComponent(detectionId)}/retry`, {
      method: "POST",
    });
    return readEntity<Detection>(response, "detection", "重试检测失败");
  },

  async createOptimizationCycle(detectionId, suggestionId) {
    const response = await fetch("/api/optimization/cycles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ detectionId, suggestionId }),
    });
    return readEntity<OptimizationCycle>(response, "cycle", "优化目标和7天任务保存失败");
  },

  async generateOptimizationContent(input) {
    const response = await fetch("/api/contents/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return readEntity<ContentItem>(response, "content", "优化内容生成失败，请稍后重试");
  },

  async startCognition(brandId) {
    const response = await fetch("/api/cognition-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandId }),
    });
    return readEntity<CognitionRun>(response, "run", "认知分析启动失败");
  },

  async getCognition(input) {
    const params = new URLSearchParams();
    if (input.runId) params.set("runId", input.runId);
    if (input.brandId) params.set("brandId", input.brandId);
    const response = await fetch(`/api/cognition-runs?${params.toString()}`, { cache: "no-store" });
    if (response.status === 404) return undefined;
    return readEntity<CognitionRun>(response, "run", "认知分析读取失败");
  },

  async retryCognition(runId) {
    const response = await fetch(`/api/cognition-runs/${encodeURIComponent(runId)}/retry`, { method: "POST" });
    return readEntity<CognitionRun>(response, "run", "认知分析重试失败");
  },

  async confirmCognition(runId, revisions: CognitionInsightRevision[]) {
    const response = await fetch(`/api/cognition-runs/${encodeURIComponent(runId)}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revisions }),
    });
    return readEntity<CognitionRun>(response, "run", "认知洞察确认失败");
  },

  async addQuestion(input) {
    const response = await fetch("/api/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return readEntity(response, "question", "检测问题添加失败");
  },

  async setQuestionEnabled(questionId, enabled) {
    const response = await fetch("/api/questions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId, enabled }),
    });
    return readEntity(response, "question", "检测问题状态更新失败");
  },

  async deleteQuestion(questionId) {
    const response = await fetch(`/api/questions?questionId=${encodeURIComponent(questionId)}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = await readPayload(response);
      throw new Error(readPayloadError(payload, "检测问题删除失败"));
    }
  },

  async startQuestionSimulation(input) {
    const response = await fetch("/api/questions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return readEntity(response, "run", "模拟问题生成启动失败");
  },

  async getQuestionSimulation(input) {
    const params = new URLSearchParams();
    if (input.runId) params.set("runId", input.runId);
    if (input.brandId) params.set("brandId", input.brandId);
    if (input.subjectType) params.set("subjectType", input.subjectType);
    if (input.subjectId) params.set("subjectId", input.subjectId);
    const response = await fetch(`/api/questions/generate?${params.toString()}`, { cache: "no-store" });
    if (response.status === 404) return undefined;
    return readEntity(response, "run", "模拟生成批次读取失败");
  },

  async retryQuestionSimulation(runId) {
    const response = await fetch(`/api/question-simulations/${encodeURIComponent(runId)}/retry`, { method: "POST" });
    return readEntity(response, "run", "模拟问题生成重试失败");
  },

  async confirmQuestionSimulation(runId, questions) {
    const response = await fetch(`/api/question-simulations/${encodeURIComponent(runId)}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questions }),
    });
    const payload = await readPayload(response);
    if (!response.ok || !payload?.run || !Array.isArray(payload.questions)) {
      throw new Error(readPayloadError(payload, "候选问题确认失败"));
    }
    return payload as unknown as Awaited<ReturnType<StoreRemotePort["confirmQuestionSimulation"]>>;
  },

  async cancelQuestionSimulation(runId) {
    const response = await fetch(`/api/question-simulations/${encodeURIComponent(runId)}`, { method: "DELETE" });
    return readEntity(response, "run", "模拟生成批次放弃失败");
  },
};

async function readEntity<T>(response: Response, field: string, fallback: string): Promise<T> {
  const payload = await readPayload(response);
  const entity = payload?.[field];
  if (!response.ok || !entity || typeof entity !== "object") {
    throw new Error(readPayloadError(payload, fallback));
  }
  return entity as T;
}

async function readPayload(response: Response): Promise<Record<string, unknown> | undefined> {
  const payload: unknown = await response.json().catch(() => undefined);
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : undefined;
}

function readPayloadError(payload: Record<string, unknown> | undefined, fallback: string) {
  return typeof payload?.error === "string" ? payload.error : fallback;
}
