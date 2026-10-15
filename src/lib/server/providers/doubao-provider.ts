import "server-only";

import { DoubaoApiError, sampleDoubaoAnswer } from "@/lib/server/doubao";
import type {
  ClassifiedProviderError,
  ProviderAdapter,
  ProviderCollectionRequest,
} from "@/lib/server/providers/types";

const WEB_SEARCH_UNAVAILABLE_TTL_MS = 10 * 60 * 1_000;
const WEB_SEARCH_UNAVAILABLE_REASON = "火山方舟账号尚未开通联网搜索服务";
let webSearchUnavailableUntil = 0;

export const doubaoProvider: ProviderAdapter = {
  id: "doubao",
  collectionMethod: "model_api",
  supportsWebSearch: true,
  async collect(request) {
    const collection = await collectWithWebSearchFallback(request);
    const result = collection.result;
    return {
      provider: "doubao",
      collectionMethod: "model_api",
      collectedAt: new Date().toISOString(),
      requestId: result.requestId,
      model: result.model,
      answer: result.answer,
      citations: result.citations,
      searchQueries: result.searchQueries,
      webSearchEnabled: collection.webSearchEnabled,
      webSearchUnavailableReason: collection.webSearchUnavailableReason,
      usage: result.usage,
      latencyMs: result.latencyMs,
    };
  },
};

export async function collectWithWebSearchFallback(request: ProviderCollectionRequest) {
  const shouldUseWebSearch = request.enableWebSearch === true && Date.now() >= webSearchUnavailableUntil;
  if (request.enableWebSearch === true && !shouldUseWebSearch) {
    return {
      result: await sampleDoubaoAnswer({ ...request, enableWebSearch: false }),
      webSearchEnabled: false,
      webSearchUnavailableReason: WEB_SEARCH_UNAVAILABLE_REASON,
    };
  }
  try {
    return {
      result: await sampleDoubaoAnswer({ ...request, enableWebSearch: shouldUseWebSearch }),
      webSearchEnabled: shouldUseWebSearch,
    };
  } catch (error) {
    if (
      request.enableWebSearch === true
      && error instanceof DoubaoApiError
      && error.providerCode === "ToolNotOpen"
    ) {
      webSearchUnavailableUntil = Date.now() + WEB_SEARCH_UNAVAILABLE_TTL_MS;
      return {
        result: await sampleDoubaoAnswer({ ...request, enableWebSearch: false }),
        webSearchEnabled: false,
        webSearchUnavailableReason: WEB_SEARCH_UNAVAILABLE_REASON,
      };
    }
    throw error;
  }
}

export function classifyDoubaoError(error: unknown): ClassifiedProviderError {
  return classifyArkError(error, "豆包");
}

export function classifyArkError(
  error: unknown,
  providerName: string,
): ClassifiedProviderError {
  if (!(error instanceof DoubaoApiError)) {
    return {
      message: `${providerName}采集失败`,
      status: 500,
      category: "collection",
      retryable: true,
    };
  }

  const code = error.providerCode;
  const message = error.message.replaceAll("豆包", providerName);
  if (code === "missing_api_key") {
    return {
      message,
      status: error.status,
      code,
      category: "configuration",
      retryable: false,
    };
  }
  if (error.status === 401 || error.status === 403) {
    return {
      message,
      status: error.status,
      code,
      category: "authentication",
      retryable: false,
    };
  }
  if (error.status === 429) {
    return {
      message,
      status: error.status,
      code,
      category: "rate_limit",
      retryable: true,
    };
  }
  if (code === "timeout" || error.status === 504) {
    return {
      message,
      status: error.status,
      code,
      category: "timeout",
      retryable: true,
    };
  }
  if (code === "network_error") {
    return {
      message,
      status: error.status,
      code,
      category: "network",
      retryable: true,
    };
  }
  if (code === "invalid_response" || code === "empty_answer") {
    return {
      message,
      status: error.status,
      code,
      category: "invalid_response",
      retryable: true,
    };
  }
  return {
    message,
    status: error.status,
    code,
    category: "collection",
    retryable: error.status >= 500,
  };
}
