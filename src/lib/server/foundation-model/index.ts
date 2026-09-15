import "server-only";

import { z } from "zod";
import { arkFoundationModel } from "@/lib/server/foundation-model/ark-adapter";
import type {
  FoundationModelAdapter,
  FoundationTaskType,
} from "@/lib/server/foundation-model/types";
import { FoundationModelError } from "@/lib/server/foundation-model/types";

const adapters: Record<string, FoundationModelAdapter> = {
  ark: arkFoundationModel,
};

export type FoundationTaskResult<T> = {
  data: T;
  provider: string;
  model: string;
  taskType: FoundationTaskType;
  promptVersion: string;
  requestId?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  latencyMs: number;
  attempts: number;
  sources: Array<{ title: string; url: string }>;
  webSearchUsed: boolean;
};

export async function executeFoundationTask<TSchema extends z.ZodType>(
  options: {
    taskType: FoundationTaskType;
    promptVersion: string;
    prompt: string;
    schema: TSchema;
    model?: string;
    enableWebSearch?: boolean;
    /** 仅供服务端自动化测试注入，生产调用不传。 */
    adapter?: FoundationModelAdapter;
  },
): Promise<FoundationTaskResult<z.infer<TSchema>>> {
  const adapter = options.adapter || getFoundationModelAdapter();
  const first = await adapter.generate({
    prompt: options.prompt,
    model: options.model,
    enableWebSearch: options.enableWebSearch ?? false,
  });
  const firstParsed = parseStructuredAnswer(first.answer, options.schema);
  if (firstParsed.success) {
    return buildTaskResult(options, first, firstParsed.data, 1);
  }

  const repair = await adapter.generate({
    prompt: buildRepairPrompt(
      first.answer,
      firstParsed.error,
    ),
    model: options.model,
    enableWebSearch: false,
  });
  const repaired = parseStructuredAnswer(repair.answer, options.schema);
  if (!repaired.success) {
    throw new FoundationModelError(
      `底座模型连续两次返回了不符合要求的数据结构：${repaired.error}`,
      502,
      "invalid_response",
      true,
      "schema_validation_failed",
    );
  }

  return buildTaskResult(options, {
    ...repair,
    sources: first.sources,
    webSearchUsed: first.webSearchUsed,
  }, repaired.data, 2);
}

export function getFoundationModelReadiness() {
  const adapter = getFoundationModelAdapter();
  const readiness = adapter.isReady();
  return {
    provider: adapter.id,
    ...readiness,
  };
}

function getFoundationModelAdapter() {
  const provider = process.env.GEO_FOUNDATION_PROVIDER?.trim() || "ark";
  const adapter = adapters[provider];
  if (!adapter) {
    throw new FoundationModelError(
      `尚未接入底座模型平台：${provider}`,
      503,
      "configuration",
      false,
      "unsupported_provider",
    );
  }
  return adapter;
}

function parseStructuredAnswer<TSchema extends z.ZodType>(
  answer: string,
  schema: TSchema,
):
  | { success: true; data: z.infer<TSchema> }
  | { success: false; error: string } {
  const jsonText = extractJson(answer);
  if (!jsonText) {
    return { success: false, error: "没有找到JSON对象或数组" };
  }
  try {
    const parsed: unknown = JSON.parse(jsonText);
    const validated = schema.safeParse(parsed);
    if (!validated.success) {
      return {
        success: false,
        error: validated.error.issues
          .slice(0, 8)
          .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
          .join("; "),
      };
    }
    return { success: true, data: validated.data };
  } catch {
    return { success: false, error: "JSON语法不正确" };
  }
}

function extractJson(answer: string) {
  const objectStart = answer.indexOf("{");
  const arrayStart = answer.indexOf("[");
  const starts = [objectStart, arrayStart].filter((value) => value >= 0);
  if (!starts.length) return undefined;
  const start = Math.min(...starts);
  const isObject = answer[start] === "{";
  const end = isObject ? answer.lastIndexOf("}") : answer.lastIndexOf("]");
  return end > start ? answer.slice(start, end + 1) : undefined;
}

function buildRepairPrompt(
  invalidAnswer: string,
  validationError: string,
) {
  return [
    "你上一次的输出未通过数据结构校验。请只修复下面输出的JSON结构和字段。",
    "只输出修复后的合法JSON，不要输出Markdown、解释或代码围栏。",
    `校验错误：${validationError}`,
    "待修复输出：",
    invalidAnswer.slice(0, 16_000),
  ].join("\n");
}

function buildTaskResult<TSchema extends z.ZodType>(
  options: {
    taskType: FoundationTaskType;
    promptVersion: string;
  },
  response: Awaited<ReturnType<FoundationModelAdapter["generate"]>>,
  data: z.infer<TSchema>,
  attempts: number,
): FoundationTaskResult<z.infer<TSchema>> {
  return {
    data,
    provider: response.provider,
    model: response.model,
    taskType: options.taskType,
    promptVersion: options.promptVersion,
    requestId: response.requestId,
    usage: response.usage,
    latencyMs: response.latencyMs,
    attempts,
    sources: response.sources || [],
    webSearchUsed: response.webSearchUsed === true,
  };
}

export { FoundationModelError };
export type { FoundationTaskType };
