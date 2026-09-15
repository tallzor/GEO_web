import "server-only";

import type {
  FoundationModelAdapter,
  FoundationModelResult,
} from "@/lib/server/foundation-model/types";
import { FoundationModelError } from "@/lib/server/foundation-model/types";

const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
const DEFAULT_MODEL = "deepseek-v4-flash-ga-260731";
const DEFAULT_TIMEOUT_MS = 240_000;
const MIN_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;

type UnknownRecord = Record<string, unknown>;

export const arkFoundationModel: FoundationModelAdapter = {
  id: "ark",
  isReady() {
    const model = readModel();
    return process.env.GEO_FOUNDATION_API_KEY?.trim()
      ? { ready: true, model }
      : {
          ready: false,
          model,
          message: "服务器尚未配置 GEO_FOUNDATION_API_KEY",
        };
  },
  async generate(request) {
    const apiKey = process.env.GEO_FOUNDATION_API_KEY?.trim();
    const model = request.model?.trim() || readModel();
    const baseUrl = readBaseUrl();
    const endpoint = request.enableWebSearch ? readResponsesUrl(baseUrl) : baseUrl;

    if (!apiKey) {
      throw new FoundationModelError(
        "服务器尚未配置 GEO_FOUNDATION_API_KEY",
        503,
        "configuration",
        false,
        "missing_api_key",
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), readTimeoutMs());
    const startedAt = Date.now();

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request.enableWebSearch
          ? {
              model,
              store: false,
              instructions: "你是GEO网站的底座模型助手，请严格按照用户要求输出结果。",
              input: request.prompt,
              tools: [{ type: "web_search" }],
            }
          : {
              model,
              stream: false,
              messages: [
                {
                  role: "system",
                  content: "你是GEO网站的底座模型助手，请严格按照用户要求输出结果。",
                },
                {
                  role: "user",
                  content: request.prompt,
                },
              ],
            }),
        cache: "no-store",
        signal: controller.signal,
      });

      const payload = await readJsonResponse(response);
      if (!response.ok) {
        throw classifyArkFailure(response.status, payload);
      }
      return request.enableWebSearch
        ? normalizeResponsesApiResponse(payload, model, Date.now() - startedAt)
        : normalizeResponse(payload, model, Date.now() - startedAt);
    } catch (error) {
      if (error instanceof FoundationModelError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new FoundationModelError(
          "底座模型响应超时，请稍后重试",
          504,
          "timeout",
          true,
          "timeout",
        );
      }
      throw new FoundationModelError(
        "暂时无法连接底座模型，请检查网络后重试",
        502,
        "network",
        true,
        "network_error",
      );
    } finally {
      clearTimeout(timeout);
    }
  },
};

function readModel() {
  return process.env.GEO_FOUNDATION_MODEL?.trim() || DEFAULT_MODEL;
}

function readBaseUrl() {
  const value = process.env.GEO_FOUNDATION_BASE_URL?.trim() || DEFAULT_BASE_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    return url.toString();
  } catch {
    throw new FoundationModelError(
      "GEO_FOUNDATION_BASE_URL 配置不正确",
      503,
      "configuration",
      false,
      "invalid_base_url",
    );
  }
}

function readResponsesUrl(chatUrl: string) {
  const configured = process.env.GEO_FOUNDATION_RESPONSES_URL?.trim();
  const candidate = configured || chatUrl.replace(/\/chat\/completions\/?$/, "/responses");
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    return url.toString();
  } catch {
    throw new FoundationModelError(
      "GEO_FOUNDATION_RESPONSES_URL 配置不正确",
      503,
      "configuration",
      false,
      "invalid_responses_url",
    );
  }
}

function readTimeoutMs() {
  const value = process.env.GEO_FOUNDATION_TIMEOUT_MS?.trim();
  if (!value) return DEFAULT_TIMEOUT_MS;
  const configured = Number(value);
  if (!Number.isFinite(configured)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, configured));
}

async function readJsonResponse(response: Response): Promise<UnknownRecord> {
  const text = await response.text();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return asRecord(parsed) || {};
  } catch {
    throw new FoundationModelError(
      "底座模型返回了无法解析的数据",
      502,
      "invalid_response",
      true,
      "invalid_response",
    );
  }
}

function classifyArkFailure(status: number, payload: UnknownRecord) {
  const providerError = asRecord(payload.error);
  const code = firstString(providerError?.code, payload.code);
  const detail = firstString(providerError?.message, payload.message);
  const safeDetail = detail ? `：${detail.slice(0, 300)}` : "";

  if (status === 401 || status === 403) {
    return new FoundationModelError(
      `底座模型鉴权失败${safeDetail}`,
      status,
      "authentication",
      false,
      code,
    );
  }
  if (status === 429) {
    return new FoundationModelError(
      `底座模型请求过于频繁${safeDetail}`,
      status,
      "rate_limit",
      true,
      code,
    );
  }
  return new FoundationModelError(
    `火山方舟底座模型请求失败（HTTP ${status}）${safeDetail}`,
    status,
    status >= 500 ? "network" : "configuration",
    status >= 500,
    code,
  );
}

function normalizeResponse(
  payload: UnknownRecord,
  fallbackModel: string,
  latencyMs: number,
): FoundationModelResult {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice?.message);
  const answer = normalizeMessageContent(message?.content);
  if (!answer) {
    throw new FoundationModelError(
      "底座模型已响应，但未返回可识别的正文",
      502,
      "invalid_response",
      true,
      "empty_answer",
    );
  }

  return {
    provider: "ark",
    requestId: typeof payload.id === "string" ? payload.id : undefined,
    model: typeof payload.model === "string" ? payload.model : fallbackModel,
    answer,
    usage: normalizeUsage(payload.usage),
    latencyMs,
  };
}

function normalizeResponsesApiResponse(
  payload: UnknownRecord,
  fallbackModel: string,
  latencyMs: number,
): FoundationModelResult {
  const output = Array.isArray(payload.output) ? payload.output : [];
  const textParts: string[] = [];
  const sourceByUrl = new Map<string, { title: string; url: string }>();
  let webSearchUsed = false;
  for (const rawItem of output) {
    const item = asRecord(rawItem);
    if (!item) continue;
    if (item.type === "web_search_call") webSearchUsed = true;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const rawContent of content) {
      const contentItem = asRecord(rawContent);
      const contentText = firstString(contentItem?.text);
      if (contentText) textParts.push(contentText);
      const annotations = Array.isArray(contentItem?.annotations) ? contentItem.annotations : [];
      for (const rawAnnotation of annotations) {
        const annotation = asRecord(rawAnnotation);
        const nestedCitation = asRecord(annotation?.url_citation);
        const url = firstString(annotation?.url, nestedCitation?.url);
        if (!url) continue;
        const title = firstString(annotation?.title, nestedCitation?.title) || url;
        sourceByUrl.set(url, { title, url });
      }
    }
  }
  const answer = textParts.join("\n\n").trim() || firstString(payload.output_text);
  if (!answer) {
    throw new FoundationModelError(
      "底座模型已响应，但未返回可识别的正文",
      502,
      "invalid_response",
      true,
      "empty_answer",
    );
  }
  return {
    provider: "ark",
    requestId: typeof payload.id === "string" ? payload.id : undefined,
    model: typeof payload.model === "string" ? payload.model : fallbackModel,
    answer,
    usage: normalizeUsage(payload.usage),
    latencyMs,
    sources: [...sourceByUrl.values()],
    webSearchUsed,
  };
}

function normalizeMessageContent(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value
    .map((rawItem) => {
      const item = asRecord(rawItem);
      return firstString(item?.text, item?.content) || "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function normalizeUsage(value: unknown) {
  const usage = asRecord(value);
  if (!usage) return undefined;
  const inputTokens = firstNumber(usage.input_tokens, usage.prompt_tokens);
  const outputTokens = firstNumber(usage.output_tokens, usage.completion_tokens);
  const totalTokens = firstNumber(usage.total_tokens);
  if (
    inputTokens === undefined
    && outputTokens === undefined
    && totalTokens === undefined
  ) {
    return undefined;
  }
  return { inputTokens, outputTokens, totalTokens };
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function firstString(...values: unknown[]) {
  return values.find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  )?.trim();
}

function firstNumber(...values: unknown[]) {
  return values.find(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
}
