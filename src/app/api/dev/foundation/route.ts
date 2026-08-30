import { NextResponse } from "next/server";
import { z } from "zod";
import {
  executeFoundationTask,
  FoundationModelError,
  getFoundationModelReadiness,
} from "@/lib/server/foundation-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const smokeSchema = z.object({
  status: z.literal("ok"),
  capability: z.literal("structured_output"),
});

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(getFoundationModelReadiness(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const result = await executeFoundationTask({
      taskType: "connectivity_test",
      promptVersion: "connectivity-test-v1",
      prompt: [
        "这是底座模型连通性测试。",
        "只输出以下JSON，不要输出其他内容：",
        '{"status":"ok","capability":"structured_output"}',
      ].join("\n"),
      schema: smokeSchema,
      enableWebSearch: false,
    });
    return NextResponse.json({
      ok: true,
      provider: result.provider,
      model: result.model,
      promptVersion: result.promptVersion,
      latencyMs: result.latencyMs,
      attempts: result.attempts,
      usage: result.usage,
      data: result.data,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof FoundationModelError) {
      return NextResponse.json({
        ok: false,
        error: error.message,
        code: error.code,
        category: error.category,
        retryable: error.retryable,
      }, { status: error.status });
    }
    return NextResponse.json({
      ok: false,
      error: "底座模型连通性测试失败",
      category: "analysis",
      retryable: true,
    }, { status: 500 });
  }
}
