import "server-only";

import { z } from "zod";
import type { AccountContext } from "@/lib/auth/types";
import { executeFoundationTask, FoundationModelError } from "@/lib/server/foundation-model";
import { loadWorkspaceSnapshot, saveGeneratedContent } from "@/lib/server/workspace-repository";
import type {
  Brand,
  ChannelId,
  ContentItem,
  Detection,
  OptimizationCycle,
  OptimizationTask,
  ProductService,
} from "@/lib/types";
import { createId, isoNow } from "@/lib/utils";

const contentDraftSchema = z.object({
  title: z.string().trim().min(4).max(80),
  body: z.string().trim().min(120).max(7_000),
  usedFacts: z.array(z.string().trim().min(1).max(160)).max(16).default([]),
  missingInformation: z.array(z.string().trim().min(1).max(100)).max(10).default([]),
});

const qualityReviewSchema = z.object({
  title: z.string().trim().min(4).max(80),
  body: z.string().trim().min(120).max(7_000),
  scores: z.object({
    readability: z.coerce.number().int().min(0).max(100),
    brandFit: z.coerce.number().int().min(0).max(100),
    goalFit: z.coerce.number().int().min(0).max(100),
    factuality: z.coerce.number().int().min(0).max(100),
    channelFit: z.coerce.number().int().min(0).max(100),
  }),
  issues: z.array(z.string().trim().min(1).max(160)).max(10).default([]),
});

type ContentGenerationInput = {
  cycleId: string;
  taskId: string;
  contentId?: string;
};

export async function generateOptimizationContent(
  account: AccountContext,
  input: ContentGenerationInput,
) {
  const snapshot = await loadWorkspaceSnapshot(account);
  const cycle = snapshot.cycles.find((item) => item.id === input.cycleId);
  if (!cycle) throw new Error("优化任务周期不存在或不属于当前组织");
  const task = cycle.tasks.find((item) => item.id === input.taskId);
  if (!task || task.delivery === "material") throw new Error("当前任务不支持生成内容");
  if (task.status === "void") throw new Error("已作废任务不能生成内容");
  const brand = snapshot.brands.find((item) => item.id === cycle.brandId);
  if (!brand) throw new Error("品牌档案不存在或不属于当前组织");
  const detection = snapshot.detections.find((item) => item.id === cycle.detectionId);
  const existing = input.contentId
    ? snapshot.contents.find((item) => item.id === input.contentId)
    : snapshot.contents.find((item) => item.cycleId === cycle.id && item.taskId === task.id);
  if (input.contentId && (!existing || existing.cycleId !== cycle.id || existing.taskId !== task.id)) {
    throw new Error("待重新生成的内容与当前任务不匹配");
  }

  const context = buildContentContext(brand, cycle, task, detection);
  const draft = await executeFoundationTask({
    taskType: "content_generation",
    promptVersion: "optimization-content-v2",
    prompt: buildContentPrompt(context),
    schema: contentDraftSchema,
    enableWebSearch: false,
  });

  let finalTitle = draft.data.title;
  let finalBody = draft.data.body;
  let reviewModel: string | undefined;
  try {
    const review = await executeFoundationTask({
      taskType: "content_review",
      promptVersion: "optimization-content-review-v2",
      prompt: buildReviewPrompt(context, draft.data),
      schema: qualityReviewSchema,
      enableWebSearch: false,
    });
    finalTitle = review.data.title;
    finalBody = review.data.body;
    reviewModel = review.model;
  } catch (error) {
    // Review failure must not discard a structurally valid generated draft.
    if (!(error instanceof FoundationModelError)) throw error;
  }

  if (!`${finalTitle}\n${finalBody}`.includes(brand.name)) {
    finalBody = `以下内容围绕${brand.name}当前已提供的品牌资料整理。\n\n${finalBody}`;
  }

  const now = isoNow();
  const selectedChannel = channelForTask(task);
  const content: ContentItem = {
    id: existing?.id || createId("content"),
    brandId: brand.id,
    cycleId: cycle.id,
    taskId: task.id,
    title: finalTitle,
    body: finalBody,
    selectedChannel,
    channels: [{
      channel: selectedChannel,
      title: finalTitle,
      body: finalBody,
      usedFacts: draft.data.usedFacts,
      missingInformation: uniqueStrings([
        ...context.missingInformation,
        ...draft.data.missingInformation,
      ]),
    }],
    version: existing ? existing.version + 1 : 1,
    status: "draft",
    riskStatus: "unchecked",
    riskIssues: [],
    generationSource: "foundation_model",
    generationModel: reviewModel || draft.model,
    promptVersion: "optimization-content-v2+review-v2",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await saveGeneratedContent(account, content);
  return {
    content,
    model: content.generationModel,
    promptVersion: content.promptVersion,
  };
}

type ContentContext = ReturnType<typeof buildContentContext>;

function buildContentContext(
  brand: Brand,
  cycle: OptimizationCycle,
  task: OptimizationTask,
  detection?: Detection,
) {
  const product = selectRelevantProduct(brand.products, task);
  const selectedQuestions = brand.questions
    .filter((question) => detection?.questionIds.includes(question.id))
    .map((question) => question.text)
    .slice(0, 10);
  const resultSignals = (detection?.results || []).slice(0, 12).map((result) => ({
    platform: result.provider,
    question: compact(result.questionSnapshot || brand.questions.find((item) => item.id === result.questionId)?.text || "", 160),
    brandMentioned: result.brandMentioned,
    recommended: result.recommended,
    insight: compact(result.analysisConclusion || result.summary || "", 220),
    sentiment: result.sentimentLabel || null,
  }));
  const missingInformation = uniqueStrings([
    !brand.intro ? "品牌简介未提供" : "",
    !brand.industry ? "所属行业未提供" : "",
    !(brand.targetAudience || product?.audience) ? "目标人群未提供" : "",
    !(brand.city || brand.serviceArea || brand.stores.length) ? "服务区域未提供" : "",
    !product ? "产品或服务信息未提供" : "",
    product && !product.description ? "匹配产品的服务说明未提供" : "",
    product && !product.features ? "匹配产品的核心特点未提供" : "",
  ]);
  return {
    brand: {
      name: brand.name,
      characteristics: brand.characteristics,
      categoryName: brand.categoryName,
      trustProof: brand.trustProof,
      positioningStatement: brand.positioningStatement,
      industry: brand.industry,
      intro: brand.intro,
      website: brand.website,
      city: brand.city,
      serviceArea: brand.serviceArea,
      targetAudience: brand.targetAudience,
      stores: brand.stores.slice(0, 5).map((store) => ({ name: store.name, address: store.address })),
      relevantProduct: product ? {
        name: product.name,
        type: product.type,
        description: product.description,
        price: product.price,
        features: product.features,
        audience: product.audience,
      } : null,
      otherProductNames: brand.products.filter((item) => item.id !== product?.id).map((item) => item.name).slice(0, 8),
      competitors: brand.competitors.slice(0, 6).map((item) => ({ name: item.name, description: item.description })),
    },
    objective: {
      dimension: dimensionName(cycle.dimension),
      target: cycle.target,
      description: cycle.description,
    },
    task: {
      day: task.day,
      title: task.title,
      description: task.description,
      contentTitle: task.contentTitle || task.title,
      delivery: task.delivery,
      channel: channelForTask(task),
    },
    detection: {
      questions: selectedQuestions,
      summary: detection?.diagnosis?.summary || "",
      issues: (detection?.diagnosis?.issues || []).slice(0, 8).map((item) => ({ title: item.title, evidence: compact(item.evidence, 180) })),
      signals: resultSignals,
    },
    missingInformation,
  };
}

function buildContentPrompt(context: ContentContext) {
  return [
    "# 角色",
    "你是商家客户的品牌内容编辑，负责根据已确认的GEO优化目标，产出一份适配AI收录、可直接编辑和使用的内容。",
    "",
    "# 创作定位",
    "采用中立、可引用的行业观察者口吻，主打信息增量与专业参考价值，让AI更愿意收录和复述品牌事实；避免营销软文感。",
    "",
    "# 核心要求",
    "1. 内容必须围绕当前品牌、目标、任务和检测问题展开，不能写成与品牌无关的行业通稿。",
    "2. 只能把输入中明确提供的信息写成品牌事实；不得编造价格、地址、效果、案例、资质、评价、数据、活动或联系方式。",
    "3. 缺少信息时不得停止生成。请改写为保守的通用说明、选择建议、咨询清单或待核对事项，避免声称品牌已经具备未提供的能力。",
    "4. 自然提及品牌名称，避免机械重复；优先回答检测问题反映的真实用户关注点，开头直接回应核心问题，不绕弯。",
    "5. 避免空泛口号、AI腔、过度营销和无法验证的承诺；禁用“顶级、第一、最强、标杆、首选、独家、最好、领先、唯一”等绝对化或排名性用词。",
    "6. 检测分析只用于识别选题和用户关注点，不能当作品牌事实引用。竞品描述也不能被改写为本品牌事实。",
    "",
    "# GEO收录增强",
    "1. 信息增量：在回答用户问题基础上，补充行业选型标准、常见避坑点或实操细节等可参考知识，占比不低于20%，避免全网重复的口水话。",
    "2. 本地权重：如品牌提供了服务区域或城市，全文自然植入该地域至少2次，强化本地收录。",
    "3. 语义匹配：自然覆盖“靠谱、实力、适配、合作、怎么样、值得选”等决策类语义，不堆砌。",
    "4. 反模板：不使用“第一、第二、第三”数字排比固定结构，行文自然像人工深度评测，降低模板降权。",
    "5. 场景实践：涉及服务落地时，按“场景细分→普遍痛点→对应解决逻辑→落地改善效果”结构组织，绑定真实地域与实操细节。",
    "",
    "# 渠道与结构规范",
    channelRule(context.task.delivery),
    "",
    "# 内部质检",
    "输出前检查可读性、品牌贴合度、目标相关性、事实边界、渠道适配和GEO收录友好度。发现问题请直接修订，不要输出检查过程。",
    "",
    "# 输入上下文",
    JSON.stringify(context),
    "",
    "# 输出格式",
    "只输出合法JSON对象，不要输出Markdown代码围栏或解释：",
    '{"title":"内容标题","body":"完整正文","usedFacts":["实际使用的品牌事实"],"missingInformation":["仍缺少但未阻断生成的信息"]}',
  ].join("\n");
}

function buildReviewPrompt(context: ContentContext, draft: z.infer<typeof contentDraftSchema>) {
  return [
    "# 角色",
    "你是品牌内容终审编辑。请审核并直接修订下面的草稿，使它更自然、更易读、更贴合品牌和当前优化目标，并提升AI收录友好度。",
    "",
    "# 审核规则",
    "- 只能使用上下文中明确提供的品牌事实，不得增加具体价格、地址、效果、案例、资质、评价、数据或联系方式。",
    "- 资料不足不是拒绝理由；使用保守通用表述继续完成内容。",
    "- 内容必须自然提及品牌，并解决当前任务或检测问题中的具体关注点，开头应直接回应核心问题。",
    "- 删除套话、重复表达、堆砌形容词、GEO术语和过度营销语气。",
    "- 禁用“顶级、第一、最强、标杆、首选、独家、最好、领先、唯一”等绝对化或排名性用词；如有则改写为客观差异描述。",
    "- 按指定渠道调整长度、段落和表达形式。",
    "- 检查GEO收录友好度：信息增量是否充足、服务地域是否自然提及、决策类语义是否覆盖、是否存在数字排比模板结构。",
    "- 若草稿已经合格可以保留；若不合格必须在title和body中直接给出修订后的完整版本。",
    "",
    "# 上下文",
    JSON.stringify(context),
    "",
    "# 待审核草稿",
    JSON.stringify({ title: draft.title, body: draft.body }),
    "",
    "# 输出格式",
    "只输出合法JSON对象：",
    '{"title":"终稿标题","body":"终稿正文","scores":{"readability":0,"brandFit":0,"goalFit":0,"factuality":0,"channelFit":0},"issues":["发现并已修复的问题"]}',
  ].join("\n");
}

function channelRule(delivery: OptimizationTask["delivery"]) {
  if (delivery === "wechat_draft") {
    return "公众号文章：建议700至1400字；标题具体；开头直接说明读者能获得什么；正文使用3至5个清晰小节或列表；结尾自然收束，不强行促销。";
  }
  if (delivery === "xiaohongshu_publish") {
    return "小红书内容：建议350至700字；开头快速进入真实场景或问题；短段落、重点清晰；最多使用4个自然表情；结尾附3至5个与品牌、城市、服务相关的真实话题标签。";
  }
  return "可复制内容：生成3至6组紧凑的问答或一份结构化说明；每个回答先给结论再补充要点；建议400至900字，便于直接复制使用。";
}

function selectRelevantProduct(products: ProductService[], task: OptimizationTask) {
  if (!products.length) return undefined;
  const taskText = `${task.title} ${task.description} ${task.contentTitle || ""}`.toLowerCase();
  return [...products].sort((left, right) => productScore(right, taskText) - productScore(left, taskText))[0];
}

function productScore(product: ProductService, taskText: string) {
  const fields = [product.name, product.type, product.description, product.features, product.audience].filter(Boolean);
  return fields.reduce((score, field, index) => {
    const normalized = field.toLowerCase();
    if (taskText.includes(normalized)) return score + (index === 0 ? 20 : 8);
    const fragments = normalized.split(/[，。；、,;\s]/).filter((item) => item.length >= 2);
    return score + fragments.filter((item) => taskText.includes(item)).length;
  }, 0);
}

function channelForTask(task: OptimizationTask): ChannelId {
  if (task.delivery === "xiaohongshu_publish") return "xiaohongshu";
  return "wechat";
}

function dimensionName(dimension: OptimizationCycle["dimension"]) {
  return { visibility: "能见", ranking: "排名", reputation: "口碑", sentiment: "情感" }[dimension];
}

function compact(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))].slice(0, 10);
}
