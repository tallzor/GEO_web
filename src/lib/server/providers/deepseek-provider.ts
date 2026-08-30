import "server-only";

import {
  classifyArkError,
  collectWithWebSearchFallback,
} from "@/lib/server/providers/doubao-provider";
import type {
  ClassifiedProviderError,
  ProviderAdapter,
} from "@/lib/server/providers/types";

const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash-260425";

export const deepseekProvider: ProviderAdapter = {
  id: "deepseek",
  collectionMethod: "model_api",
  supportsWebSearch: true,
  async collect(request) {
    const collection = await collectWithWebSearchFallback({
      ...request,
      model: request.model?.trim()
        || process.env.ARK_DEEPSEEK_MODEL?.trim()
        || DEFAULT_DEEPSEEK_MODEL,
    });
    const result = collection.result;
    return {
      provider: "deepseek",
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

export function classifyDeepSeekError(error: unknown): ClassifiedProviderError {
  return classifyArkError(error, "DeepSeek");
}
