import { NextResponse } from "next/server";
import { z } from "zod";
import { DoubaoApiError, sampleDoubaoAnswer } from "@/lib/server/doubao";
import { isAiApiEnabled } from "@/lib/server/ai-api-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  brandName: z.string().trim().min(1, "请填写品牌名称").max(100),
  description: z.string().trim().max(2_000).optional().default(""),
  industry: z.string().trim().max(100).optional().default(""),
  serviceMarket: z.string().trim().max(200).optional().default(""),
  targetAudience: z.string().trim().max(500).optional().default(""),
  competitors: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional().default(""),
  })).max(20).optional().default([]),
});

const generatedSchema = z.object({
  idea: z.array(z.string().trim().min(4).max(200)).length(3),
  awareness: z.array(z.string().trim().min(4).max(200)).length(3),
  shortlist: z.array(z.string().trim().min(4).max(200)).length(4),
  comparison: z.array(z.string().trim().min(4).max(200)).length(3),
  trust: z.array(z.string().trim().min(4).max(200)).length(2),
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
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "品牌信息不正确" }, { status: 400 });
  }

  try {
    const result = await sampleDoubaoAnswer({
      question: buildQuestionPrompt(parsed.data),
      enableWebSearch: false,
    });
    const questions = parseQuestions(result.answer);
    return NextResponse.json({
      questions,
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
    return NextResponse.json({
      error: error instanceof Error ? error.message : "检测问题生成失败，请重试",
    }, { status: 502 });
  }
}

function buildQuestionPrompt(profile: z.infer<typeof requestSchema>) {
  return `你是GEO真实用户问题设计助手。请根据品牌资料生成15条符合普通用户自然表达习惯的问题，用于检测AI是否会认识、提及或推荐该品牌。

品牌资料：
${JSON.stringify(profile, null, 2)}

必须严格遵守：
1. 按用户决策过程生成：想法萌生3条、了解认识3条、选择初筛4条、对比3条、信任决策2条。
2. idea、awareness、shortlist中的问题原则上不出现品牌名或竞品名；comparison、trust可以使用品牌名或竞品名。
3. 结合已提供的行业、服务市场、目标人群和竞品；没有提供的信息不要猜测或虚构。
4. 每条问题都应像真实用户直接向AI提问，避免营销口号、专业术语和重复表达。
5. 只返回以下JSON对象，不要Markdown代码块、解释或其他文字：
{"idea":["问题1","问题2","问题3"],"awareness":["问题1","问题2","问题3"],"shortlist":["问题1","问题2","问题3","问题4"],"comparison":["问题1","问题2","问题3"],"trust":["问题1","问题2"]}`;
}

function parseQuestions(answer: string) {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("豆包未返回可识别的问题列表，请重新生成");

  let raw: unknown;
  try {
    raw = JSON.parse(answer.slice(start, end + 1));
  } catch {
    throw new Error("豆包返回的问题格式不正确，请重新生成");
  }

  const parsed = generatedSchema.safeParse(raw);
  if (!parsed.success) throw new Error("豆包返回的问题数量或格式不符合要求，请重新生成");
  const questions = [
    ...parsed.data.idea,
    ...parsed.data.awareness,
    ...parsed.data.shortlist,
    ...parsed.data.comparison,
    ...parsed.data.trust,
  ];
  if (new Set(questions).size !== 15) throw new Error("生成的问题存在重复，请重新生成");
  return questions;
}
