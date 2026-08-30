import "server-only";

import type { ProviderId } from "@/lib/types";
import {
  classifyDoubaoError,
  doubaoProvider,
} from "@/lib/server/providers/doubao-provider";
import {
  classifyDeepSeekError,
  deepseekProvider,
} from "@/lib/server/providers/deepseek-provider";
import {
  classifyHunyuanError,
  hunyuanProvider,
} from "@/lib/server/providers/hunyuan-provider";
import type {
  ClassifiedProviderError,
  ProviderAdapter,
} from "@/lib/server/providers/types";

const providers: Partial<Record<ProviderId, ProviderAdapter>> = {
  doubao: doubaoProvider,
  deepseek: deepseekProvider,
  yuanbao: hunyuanProvider,
};

export function getProviderAdapter(provider: ProviderId) {
  return providers[provider];
}

export function classifyProviderError(
  provider: ProviderId,
  error: unknown,
): ClassifiedProviderError {
  if (provider === "doubao") return classifyDoubaoError(error);
  if (provider === "deepseek") return classifyDeepSeekError(error);
  if (provider === "yuanbao") return classifyHunyuanError(error);
  return {
    message: "当前AI平台暂不可用",
    status: 501,
    category: "configuration",
    retryable: false,
  };
}
