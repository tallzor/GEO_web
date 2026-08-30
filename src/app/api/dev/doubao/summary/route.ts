import { NextResponse } from "next/server";
import { z } from "zod";
import { DoubaoApiError, sampleDoubaoAnswer } from "@/lib/server/doubao";
import { isAiApiEnabled } from "@/lib/server/ai-api-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  question: z.string().trim().min(2).max(500),
  answers: z.tuple([
    z.string().trim().min(1).max(20_000),
    z.string().trim().min(1).max(20_000),
  ]),
});

export async function POST(request: Request) {
  if (!isAiApiEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "回答内容不正确" }, { status: 400 });
  }

  try {
    const result = await sampleDoubaoAnswer({
      question: buildSummaryPrompt(parsed.data.question, parsed.data.answers),
      enableWebSearch: false,
    });
    return NextResponse.json({
      summary: result.answer,
      model: result.model,
      latencyMs: result.latencyMs,
      usage: result.usage,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof DoubaoApiError) {
      return NextResponse.json({ error: error.message, code: error.providerCode }, { status: error.status });
    }
    return NextResponse.json({ error: "回答总结生成失败" }, { status: 500 });
  }
}

function buildSummaryPrompt(question: string, answers: [string, string]) {
  return `请汇总同一个问题的两次AI回答，形成一份简短、清晰的中文总结。

原问题：
${question}

第一次回答：
${answers[0]}

第二次回答：
${answers[1]}

要求：
1. 先概括两次回答的共同内容，再说明重要差异。
2. 不补充两次回答中都没有的新事实，不判断事实真假。
3. 不输出准确度、好感度、评分或优化建议。
4. 使用1至2个短段落，直接输出总结正文，不要标题和前言。`;
}
