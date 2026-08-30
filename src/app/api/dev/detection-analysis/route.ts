import { NextResponse } from "next/server";
import { z } from "zod";
import {
  analyzeDetection,
  DetectionAnalysisError,
} from "@/lib/server/detection-analysis";
import { isAiApiEnabled } from "@/lib/server/ai-api-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  brand: z.object({
    name: z.string().trim().min(1).max(100),
    shortName: z.string().max(100).optional().default(""),
    characteristics: z.string().max(500).optional().default(""),
    categoryName: z.string().max(100).optional().default(""),
    trustProof: z.string().max(500).optional().default(""),
    positioningStatement: z.string().max(300).optional().default(""),
    industry: z.string().max(100),
    intro: z.string().max(3_000),
    serviceArea: z.string().max(500),
    targetAudience: z.string().max(1_000),
    products: z.array(z.object({
      name: z.string().max(100),
      description: z.string().max(1_000),
      price: z.string().max(300),
      features: z.string().max(1_000),
    })).max(50),
    competitors: z.array(z.object({
      name: z.string().max(100),
      description: z.string().max(1_000),
    })).max(50),
  }),
  responses: z.array(z.object({
    resultId: z.string().min(1).max(100),
    provider: z.enum(["doubao", "deepseek", "yuanbao"]),
    questionId: z.string().min(1).max(100),
    question: z.string().min(1).max(500),
    answer: z.string().min(1).max(30_000),
    citations: z.array(z.object({
      title: z.string().max(500),
      url: z.string().url().max(2_000),
    })).max(50),
  })).min(1).max(30),
});

export async function POST(request: Request) {
  if (!isAiApiEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 512_000) {
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

  try {
    const result = await analyzeDetection(parsed.data);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof DetectionAnalysisError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          category: error.category,
          retryable: error.retryable,
        },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        error: "检测分析失败",
        category: "analysis",
        retryable: true,
      },
      { status: 500 },
    );
  }
}
