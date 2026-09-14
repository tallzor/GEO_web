import type { ContentItem, Detection, OptimizationCycle } from "@/lib/types";
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
