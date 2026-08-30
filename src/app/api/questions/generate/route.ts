import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  executeFoundationTask,
  FoundationModelError,
} from "@/lib/server/foundation-model";
import { requireWorkspaceAccount, WorkspaceAccessError } from "@/lib/server/workspace-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseDataBackendEnabled } from "@/lib/supabase/env";
import type { DetectionQuestion } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  brandId: z.string().trim().min(1).max(120),
  brandName: z.string().trim().min(1, "请填写品牌名称").max(100),
  characteristics: z.string().trim().max(500).optional().default(""),
  categoryName: z.string().trim().max(100).optional().default(""),
  trustProof: z.string().trim().max(500).optional().default(""),
  positioningStatement: z.string().trim().max(300).optional().default(""),
  industry: z.string().trim().max(100).optional().default(""),
  serviceMarket: z.string().trim().max(200).optional().default(""),
  targetAudience: z.string().trim().max(500).optional().default(""),
  products: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(2_000).optional().default(""),
  })).max(50).optional().default([]),
});

const insightSchema = z.object({
  painPoint: z.string().trim().min(2).max(500),
  realProblems: z.array(z.string().trim().min(2).max(300)).min(1).max(8),
  alternatives: z.array(z.string().trim().min(2).max(300)).min(1).max(8),
});

const generatedSchema = z.object({
  insights: z.array(insightSchema).min(3).max(8),
  questions: z.array(z.string().trim().min(4).max(200)).min(1).max(15),
}).superRefine((value, context) => {
  const normalizedQuestions = value.questions.map(normalizeQuestionText);
  if (new Set(normalizedQuestions).size !== normalizedQuestions.length) {
    context.addIssue({ code: "custom", message: "生成的问题不能重复" });
  }
});

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 128_000) return NextResponse.json({ error: "请求内容过大" }, { status: 413 });

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
    let account: Awaited<ReturnType<typeof requireWorkspaceAccount>> | undefined;
    if (isSupabaseDataBackendEnabled()) {
      account = await requireWorkspaceAccount({ write: true });
      const { data, error } = await createSupabaseAdminClient().from("brands")
        .select("id")
        .eq("organization_id", account.organizationId!)
        .eq("id", parsed.data.brandId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new WorkspaceAccessError("品牌不属于当前组织", 403);
    }

    const result = await executeFoundationTask({
      taskType: "question_generation",
      promptVersion: "question-generation-v2",
      prompt: buildQuestionPrompt(parsed.data),
      schema: generatedSchema,
      enableWebSearch: true,
    });
    const generatedAt = new Date().toISOString();
    const generatedTexts = result.data.questions;
    let questions: DetectionQuestion[] = generatedTexts.map((text) => ({
      id: randomUUID(),
      text,
      source: "generated" as const,
      category: "",
      enabled: true,
      updatedAt: generatedAt,
    }));

    if (account?.organizationId) {
      const supabase = createSupabaseAdminClient();
      const existingResult = await supabase.from("detection_questions")
        .select("id,text,source,category,enabled,updated_at")
        .eq("organization_id", account.organizationId)
        .eq("brand_id", parsed.data.brandId);
      if (existingResult.error) throw new Error(existingResult.error.message);
      const existingByText = new Map((existingResult.data || []).map((row) => [row.text.trim(), row]));
      questions = generatedTexts.map((text) => {
        const existing = existingByText.get(text.trim());
        return existing ? {
          id: existing.id,
          text,
          source: normalizeQuestionSource(existing.source),
          category: existing.category || "",
          enabled: true,
          updatedAt: generatedAt,
        } : {
          id: randomUUID(),
          text,
          source: "generated" as const,
          category: "",
          enabled: true,
          updatedAt: generatedAt,
        };
      });
      const saveQuestions = await supabase.from("detection_questions").upsert(questions.map((question) => ({
        id: question.id,
        organization_id: account!.organizationId!,
        brand_id: parsed.data.brandId,
        text: question.text,
        source: question.source,
        category: question.category || null,
        enabled: true,
        prompt_version: result.promptVersion,
        updated_at: generatedAt,
      })), { onConflict: "id" });
      if (saveQuestions.error) throw new Error(saveQuestions.error.message);
      const saveBrand = await supabase.from("brands").update({
        questions_generated_at: generatedAt,
        updated_at: generatedAt,
        updated_by: account.userId,
      }).eq("organization_id", account.organizationId).eq("id", parsed.data.brandId).is("deleted_at", null);
      if (saveBrand.error) throw new Error(saveBrand.error.message);
    }

    return NextResponse.json({
      questions,
      generatedAt,
      model: result.model,
      promptVersion: result.promptVersion,
      latencyMs: result.latencyMs,
      usage: result.usage,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof FoundationModelError) {
      return NextResponse.json({
        error: error.message,
        code: error.code,
        category: error.category,
        retryable: error.retryable,
      }, { status: error.status });
    }
    return NextResponse.json({
      error: error instanceof Error ? error.message : "检测问题生成失败，请重试",
    }, { status: 500 });
  }
}

function normalizeQuestionSource(value: unknown): "industry" | "generated" | "custom" {
  return value === "industry" || value === "custom" ? value : "generated";
}

function buildQuestionPrompt(profile: z.infer<typeof requestSchema>) {
  return [
    "你是一名资深的消费者洞察专家、品牌战略顾问和GEO检测问题设计师。",
    "你的任务不是宣传品牌，也不是替品牌编写营销文案，而是站在真实潜在用户的角度，分析用户在产生需求、了解方案、比较选择和做出决策时会遇到的问题，并将这些问题转化为适合向AI平台提问的自然问题。",
    "",
    "请按以下步骤完成任务：",
    "",
    "第一步：理解品牌与业务边界",
    "1. 根据品牌资料判断品牌所属品类、主要产品或服务、目标用户、服务区域及可能解决的核心需求。",
    "2. 品牌资料中的空字段直接忽略，不得自行补全。",
    "3. 品牌自身事实只能依据输入资料；不得把行业常识、搜索结果或其他品牌的信息当成当前品牌事实。",
    "",
    "第二步：形成真实用户洞察",
    "1. 结合品牌资料、产品资料、目标用户和服务市场，整理3—8组用户洞察，优先输出5组质量最高、差异最明显的洞察。",
    "2. 联网搜索主要用于了解该品类中的真实使用场景、常见困难、购买顾虑、选择标准和替代方案，不用于虚构当前品牌信息。",
    "3. 每组洞察必须包含：",
    "   - painPoint：用户在具体场景中遇到的阻碍，以及该阻碍带来的后果。",
    "   - realProblems：用户实际需要解决的1—3个具体问题。",
    "   - alternatives：用户在没有选择专业产品或服务前，通常采用的1—3种替代办法。",
    "4. 洞察必须具体到真实场景，避免使用‘选择困难’‘不了解产品’‘担心效果’等没有场景和原因的空泛表达。",
    "5. 不同洞察应分别反映不同的场景、障碍或决策顾虑，不得只是更换少量词语。",
    "",
    "第三步：生成GEO检测问题",
    "1. 基于前面形成的用户洞察，一次生成最多15条问题；资料足够时应生成15条。",
    "2. 问题应自然覆盖以下用户意图，但不得在结果中标注分类：",
    "   - 需求萌生：用户刚意识到问题，还不知道应该选择什么方案。",
    "   - 了解认识：用户开始了解相关品类、解决办法或选择标准。",
    "   - 初步筛选：用户寻找值得考虑的产品、品牌或服务商。",
    "   - 比较选择：用户比较不同方案、品牌、价格、效果或适用场景。",
    "   - 信任决策：用户确认真实性、口碑、资质、风险或联系方式。",
    "3. 默认从不知道当前品牌的普通用户视角提问，尽量不主动出现当前品牌名称。",
    "4. 只有在评价、对比、验证口碑或信任决策等场景确实需要时，才允许出现当前品牌名称；品牌相关问题通常不超过3条。",
    "5. 每条问题只能表达一个主要意图，必须能够脱离上下文独立理解。",
    "6. 服务区域、目标人群、预算、使用场景等信息，只在符合真实用户表达时自然加入，不得机械拼接到每条问题中。",
    "7. 问题要像普通用户直接向AI助手提问，可以使用口语化表达，但不要故意加入错别字、网络黑话或营销语言。",
    "8. 避免连续生成‘有哪些推荐’‘哪个比较好’‘怎么选择’等结构相同的问题。",
    "9. 所有问题必须进行语义去重：即使句式不同，只要用户意图和预期答案基本相同，也视为重复。",
    "10. 问题不得预设当前品牌一定优秀、一定知名或一定适合用户，也不得暗示不存在的效果、案例、资质或价格。",
    "",
    "输出前请自行检查：",
    "1. insights数量是否为3—8组。",
    "2. questions是否不超过15条。",
    "3. 是否存在语义重复的问题。",
    "4. 是否包含缺乏依据的品牌事实。",
    "5. 是否过度出现当前品牌名称。",
    "6. 是否覆盖了从需求产生到信任决策的不同用户意图。",
    "",
    "只返回一个合法JSON对象，不要输出Markdown、代码围栏、解释、分类标签、推理过程、引用来源或其他文字。",
    '输出结构：{"insights":[{"painPoint":"具体场景、用户阻碍及其后果","realProblems":["具体问题1","具体问题2"],"alternatives":["替代方案1","替代方案2"]}],"questions":["检测问题1","检测问题2"]}',
    "",
    "品牌资料：",
    JSON.stringify({
      brandName: profile.brandName,
      characteristics: profile.characteristics,
      categoryName: profile.categoryName,
      trustProof: profile.trustProof,
      positioningStatement: profile.positioningStatement,
      industry: profile.industry,
      serviceMarket: profile.serviceMarket,
      targetAudience: profile.targetAudience,
      products: profile.products,
    }),
  ].join("\n");
}

function normalizeQuestionText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\p{P}\p{S}\s]+/gu, "");
}
