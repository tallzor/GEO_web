import { NextResponse } from "next/server";
import { z } from "zod";
import { isAiApiEnabled } from "@/lib/server/ai-api-access";
import {
  classifyProviderError,
  getProviderAdapter,
} from "@/lib/server/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  provider: z.enum(["doubao", "deepseek", "yuanbao"]),
  question: z.string().trim().min(2, "请输入检测问题").max(500, "问题不能超过500字"),
  enableWebSearch: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  if (!isAiApiEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 8_192) {
    return NextResponse.json({ error: "请求内容过大" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "请求参数不正确" },
      { status: 400 },
    );
  }

  const adapter = getProviderAdapter(parsed.data.provider);
  if (!adapter) {
    return NextResponse.json(
      {
        error: "当前AI平台尚未接入",
        category: "configuration",
        retryable: false,
      },
      { status: 501 },
    );
  }

  try {
    const result = await adapter.collect(parsed.data);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const classified = classifyProviderError(parsed.data.provider, error);
    return NextResponse.json(
      {
        error: classified.message,
        code: classified.code,
        category: classified.category,
        retryable: classified.retryable,
      },
      { status: classified.status },
    );
  }
}
