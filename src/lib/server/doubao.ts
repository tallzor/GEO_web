import "server-only";

const ARK_RESPONSES_URL = "https://ark.cn-beijing.volces.com/api/v3/responses";
const DEFAULT_TIMEOUT_MS = 90_000;

type UnknownRecord = Record<string, unknown>;

export type DoubaoCitation = {
  title: string;
  url: string;
  excerpt?: string;
  providerType?: string;
};

export type DoubaoUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type DoubaoSampleResult = {
  requestId?: string;
  model: string;
  answer: string;
  citations: DoubaoCitation[];
  searchQueries: string[];
  usage?: DoubaoUsage;
  latencyMs: number;
};

export class DoubaoApiError extends Error {
  readonly status: number;
  readonly providerCode?: string;

  constructor(
    message: string,
    status: number,
    providerCode?: string,
  ) {
    super(message);
    this.name = "DoubaoApiError";
    this.status = status;
    this.providerCode = providerCode;
  }
}

export async function sampleDoubaoAnswer({
  question,
  enableWebSearch = true,
  model: requestedModel,
}: {
  question: string;
  enableWebSearch?: boolean;
  model?: string;
}): Promise<DoubaoSampleResult> {
  const apiKey = process.env.ARK_API_KEY?.trim();
  const model = requestedModel?.trim() || process.env.ARK_MODEL?.trim() || "doubao-seed-2-0-lite-260428";

  if (!apiKey) {
    throw new DoubaoApiError("服务器尚未配置 ARK_API_KEY", 503, "missing_api_key");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(ARK_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: question }],
          },
        ],
        thinking: { type: "disabled" },
        ...(enableWebSearch
          ? { tools: [{ type: "web_search", max_keyword: 5 }] }
          : {}),
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    const payload = await readJsonResponse(response);
    if (!response.ok) {
      const providerError = extractProviderError(payload);
      if (providerError.code === "ToolNotOpen") {
        throw new DoubaoApiError(
          "豆包模型可用，但火山方舟账号尚未开通联网搜索服务",
          424,
          providerError.code,
        );
      }
      throw new DoubaoApiError(
        providerError.message || `火山方舟请求失败（HTTP ${response.status}）`,
        response.status,
        providerError.code,
      );
    }

    return normalizeDoubaoResponse(payload, model, Date.now() - startedAt);
  } catch (error) {
    if (error instanceof DoubaoApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new DoubaoApiError("豆包响应超时，请稍后重试", 504, "timeout");
    }
    throw new DoubaoApiError("暂时无法连接火山方舟，请检查网络后重试", 502, "network_error");
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonResponse(response: Response): Promise<UnknownRecord> {
  const text = await response.text();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return asRecord(parsed) || {};
  } catch {
    throw new DoubaoApiError("火山方舟返回了无法解析的数据", 502, "invalid_response");
  }
}

function normalizeDoubaoResponse(payload: UnknownRecord, fallbackModel: string, latencyMs: number): DoubaoSampleResult {
  const output = Array.isArray(payload.output) ? payload.output : [];
  const answerParts: string[] = [];
  const citations = new Map<string, DoubaoCitation>();
  const searchQueries = new Set<string>();

  for (const rawItem of output) {
    const item = asRecord(rawItem);
    if (!item) continue;

    const action = asRecord(item.action);
    addString(searchQueries, action?.query);
    if (Array.isArray(action?.queries)) {
      for (const query of action.queries) addString(searchQueries, query);
    }
    collectCitations(action?.sources, citations);

    if (!Array.isArray(item.content)) continue;
    for (const rawContent of item.content) {
      const content = asRecord(rawContent);
      if (!content) continue;
      if (typeof content.text === "string" && content.text.trim()) {
        answerParts.push(content.text.trim());
      }
      collectCitations(content.annotations, citations);
      collectCitations(content.citations, citations);
    }
  }

  const answer = answerParts.join("\n\n").trim();
  if (!answer) {
    throw new DoubaoApiError("豆包已响应，但未返回可识别的回答正文", 502, "empty_answer");
  }

  return {
    requestId: typeof payload.id === "string" ? payload.id : undefined,
    model: typeof payload.model === "string" ? payload.model : fallbackModel,
    answer,
    citations: [...citations.values()],
    searchQueries: [...searchQueries],
    usage: normalizeUsage(payload.usage),
    latencyMs,
  };
}

function collectCitations(value: unknown, citations: Map<string, DoubaoCitation>) {
  if (!Array.isArray(value)) return;
  for (const rawCitation of value) {
    const citation = asRecord(rawCitation);
    if (!citation) continue;
    const url = firstString(citation.url, citation.source_url, citation.link);
    if (!url || !isHttpUrl(url)) continue;
    const title = firstString(citation.title, citation.name, citation.source_name) || new URL(url).hostname;
    const excerpt = firstString(citation.snippet, citation.excerpt, citation.description);
    const providerType = firstString(citation.type);
    citations.set(url, { title, url, excerpt, providerType });
  }
}

function normalizeUsage(value: unknown): DoubaoUsage | undefined {
  const usage = asRecord(value);
  if (!usage) return undefined;
  const inputTokens = firstNumber(usage.input_tokens, usage.prompt_tokens);
  const outputTokens = firstNumber(usage.output_tokens, usage.completion_tokens);
  const totalTokens = firstNumber(usage.total_tokens);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return undefined;
  return { inputTokens, outputTokens, totalTokens };
}

function extractProviderError(payload: UnknownRecord) {
  const error = asRecord(payload.error);
  return {
    code: firstString(error?.code, payload.code),
    message: firstString(error?.message, payload.message)?.slice(0, 500),
  };
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function firstNumber(...values: unknown[]) {
  return values.find((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function addString(target: Set<string>, value: unknown) {
  if (typeof value === "string" && value.trim()) target.add(value.trim());
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
