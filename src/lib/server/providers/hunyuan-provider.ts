import "server-only";

import type {
  ClassifiedProviderError,
  ProviderAdapter,
} from "@/lib/server/providers/types";

const HUNYUAN_API_URL = "https://tokenhub.tencentmaas.com/v1/chat/completions";
const DEFAULT_HUNYUAN_MODEL = "hy3";
const DEFAULT_TIMEOUT_MS = 90_000;

type UnknownRecord = Record<string, unknown>;

class HunyuanApiError extends Error {
  readonly status: number;
  readonly providerCode?: string;

  constructor(message: string, status: number, providerCode?: string) {
    super(message);
    this.name = "HunyuanApiError";
    this.status = status;
    this.providerCode = providerCode;
  }
}

export const hunyuanProvider: ProviderAdapter = {
  id: "yuanbao",
  collectionMethod: "model_api",
  supportsWebSearch: false,
  async collect(request) {
    const apiKey = process.env.HUNYUAN_API_KEY?.trim();
    const model = request.model?.trim()
      || process.env.HUNYUAN_MODEL?.trim()
      || DEFAULT_HUNYUAN_MODEL;

    if (!apiKey) {
      throw new HunyuanApiError("服务器尚未配置 HUNYUAN_API_KEY", 503, "missing_api_key");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const startedAt = Date.now();

    try {
      const response = await fetch(HUNYUAN_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: request.question },
          ],
          stream: false,
        }),
        cache: "no-store",
        signal: controller.signal,
      });

      const payload = await readJsonResponse(response);
      if (!response.ok) {
        const providerError = extractProviderError(payload);
        throw new HunyuanApiError(
          providerError.message || `混元接口请求失败（HTTP ${response.status}）`,
          response.status,
          providerError.code,
        );
      }

      const answer = extractAnswer(payload);
      if (!answer) {
        throw new HunyuanApiError("混元已响应，但未返回可识别的回答正文", 502, "empty_answer");
      }

      const usage = asRecord(payload.usage);
      return {
        provider: "yuanbao",
        collectionMethod: "model_api",
        collectedAt: new Date().toISOString(),
        requestId: typeof payload.id === "string" ? payload.id : undefined,
        model: typeof payload.model === "string" ? payload.model : model,
        answer,
        citations: [],
        searchQueries: [],
        webSearchEnabled: false,
        usage: usage ? {
          inputTokens: numberOrUndefined(usage.prompt_tokens),
          outputTokens: numberOrUndefined(usage.completion_tokens),
          totalTokens: numberOrUndefined(usage.total_tokens),
        } : undefined,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (error instanceof HunyuanApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new HunyuanApiError("混元响应超时，请稍后重试", 504, "timeout");
      }
      throw new HunyuanApiError("暂时无法连接腾讯混元，请检查网络后重试", 502, "network_error");
    } finally {
      clearTimeout(timeout);
    }
  },
};

export function classifyHunyuanError(error: unknown): ClassifiedProviderError {
  if (!(error instanceof HunyuanApiError)) {
    return {
      message: "混元（腾讯元宝）采集失败",
      status: 500,
      category: "collection",
      retryable: true,
    };
  }

  const code = error.providerCode;
  if (code === "missing_api_key") {
    return {
      message: error.message,
      status: error.status,
      code,
      category: "configuration",
      retryable: false,
    };
  }
  if (error.status === 401 || error.status === 403) {
    return {
      message: "混元接口鉴权失败，请检查 HUNYUAN_API_KEY",
      status: error.status,
      code,
      category: "authentication",
      retryable: false,
    };
  }
  if (error.status === 429) {
    return {
      message: "混元接口调用过于频繁，请稍后重试",
      status: error.status,
      code,
      category: "rate_limit",
      retryable: true,
    };
  }
  if (code === "timeout" || error.status === 504) {
    return {
      message: error.message,
      status: error.status,
      code,
      category: "timeout",
      retryable: true,
    };
  }
  if (code === "network_error") {
    return {
      message: error.message,
      status: error.status,
      code,
      category: "network",
      retryable: true,
    };
  }
  if (code === "invalid_response" || code === "empty_answer") {
    return {
      message: error.message,
      status: error.status,
      code,
      category: "invalid_response",
      retryable: true,
    };
  }
  return {
    message: error.message,
    status: error.status,
    code,
    category: "collection",
    retryable: error.status >= 500,
  };
}

async function readJsonResponse(response: Response): Promise<UnknownRecord> {
  const text = await response.text();
  if (!text) return {};
  try {
    return asRecord(JSON.parse(text)) || {};
  } catch {
    throw new HunyuanApiError("混元返回了无法解析的数据", 502, "invalid_response");
  }
}

function extractAnswer(payload: UnknownRecord) {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice?.message);
  const content = message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      const part = asRecord(item);
      return typeof part?.text === "string" ? part.text.trim() : "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractProviderError(payload: UnknownRecord) {
  const error = asRecord(payload.error);
  return {
    code: stringOrUndefined(error?.code) || stringOrUndefined(payload.code),
    message: stringOrUndefined(error?.message) || stringOrUndefined(payload.message),
  };
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
