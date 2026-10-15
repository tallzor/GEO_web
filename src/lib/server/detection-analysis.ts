import "server-only";

import { z } from "zod";
import type {
  Citation,
  Diagnosis,
  DiagnosisScores,
  PresentationRole,
  ProviderErrorCategory,
  ProviderId,
  RecommendationType,
  RiskSignal,
  SentimentLabel,
} from "@/lib/types";
import {
  executeFoundationTask,
  FoundationModelError,
} from "@/lib/server/foundation-model";
import { createLogger } from "@/lib/server/logger";
import { createId } from "@/lib/utils";
import {
  calculateSentiment,
  classifyCitationSource,
  dedupeNames,
  findExactNameMentions,
  normalizeCitationUrl,
  normalizeName,
  recommendationWeight,
} from "@/lib/server/detection-analysis-rules";

const logger = createLogger("detection-analysis");

const semanticResultSchema = z.object({
  resultId: z.string().min(1),
  conclusion: z.string().trim().min(1).max(500),
  presentationRole: z.enum([
    "top_recommendation",
    "alternative",
    "general_mention",
    "risk_warning",
    "negative_counterexample",
    "not_mentioned",
  ]),
  presentationEvidence: z.string().trim().max(300).optional().default(""),
  riskSignal: z.enum([
    "none_detected",
    "cautious_description",
    "negative_counterexample",
  ]).nullable().optional().default(null),
  riskEvidence: z.string().trim().max(300).optional().default(""),
  competitorBrands: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    evidence: z.string().trim().min(1).max(300),
  })).max(50).optional().default([]),
});

const semanticPayloadSchema = z.object({
  results: z.array(semanticResultSchema).min(1).max(30),
});

const optimizationGoalPayloadSchema = z.object({
  goals: z.array(z.object({
    dimension: z.enum(["visibility", "ranking", "reputation", "sentiment"]),
    cognition: z.string().trim().min(4).max(60),
    title: z.string().trim().min(4).max(36),
    reason: z.string().trim().min(8).max(160),
    direction: z.string().trim().min(8).max(180),
  })).min(1).max(3),
});

const optimizationGoalPromptVersion = "optimization-goal-v3-positioning-light";
const detectionAnalysisPromptVersion = "detection-analysis-v5-geo-result";
// 已停用：旧规则版本常量没有进入持久化或分析输出，避免形成无效版本标识。
// export const detectionAnalysisRuleVersion = "geo-four-dimensions-v3";

export type DetectionAnalysisInput = {
  subject: {
    type: "brand" | "product";
    name: string;
    aliases: string[];
  };
  brand: {
    name: string;
    shortName: string;
    characteristics: string;
    categoryName: string;
    trustProof: string;
    positioningStatement: string;
    industry: string;
    website: string;
    intro: string;
    serviceArea: string;
    targetAudience: string;
    products: { name: string; description: string; price: string; features: string }[];
    competitors: { name: string; description: string }[];
  };
  responses: {
    resultId: string;
    provider: ProviderId;
    questionId: string;
    question: string;
    answer: string;
    citations: Array<Partial<Citation> & Pick<Citation, "title" | "url">>;
  }[];
};

export type ResultAnalysis = {
  resultId: string;
  brandMentioned: boolean;
  targetMentioned: boolean;
  directQuestion: boolean;
  presentationRole: PresentationRole;
  presentationEvidence: string;
  riskSignal?: RiskSignal;
  riskEvidence: string;
  mentionCount: number;
  firstMentionIndex?: number;
  competitorMentions: string[];
  mentionEvidence: string;
  recommended: boolean;
  recommendationType: RecommendationType;
  recommendationPosition: string;
  rankPosition?: number;
  recommendationEvidence: string;
  sentimentLabel?: SentimentLabel;
  sentimentScore?: number;
  sentimentEvidence: string;
  positiveEvaluationCount: number;
  negativeEvaluationCount: number;
  accuracy: "准确" | "部分准确" | "待确认";
  accuracyScore?: number;
  accuracyEvidence: string;
  analysisConclusion: string;
  factClaims: string[];
  rankedBrands: {
    name: string;
    rank?: number;
    evidence: string;
    configuredCompetitor?: boolean;
  }[];
  reputationTopics: {
    label: string;
    sentimentLabel: SentimentLabel;
    evidence: string;
  }[];
  citations: Citation[];
  analysisModel: string;
};

type ObjectiveCandidate = {
  dimension: keyof DiagnosisScores;
  score: number;
  available: boolean;
  title: string;
  evidence: string;
  description: string;
};

export class DetectionAnalysisError extends Error {
  readonly status: number;
  readonly category: ProviderErrorCategory;
  readonly retryable: boolean;
  readonly code?: string;

  constructor(
    message: string,
    status: number,
    category: ProviderErrorCategory,
    retryable: boolean,
    code?: string,
  ) {
    super(message);
    this.name = "DetectionAnalysisError";
    this.status = status;
    this.category = category;
    this.retryable = retryable;
    this.code = code;
  }
}

export async function analyzeDetection(input: DetectionAnalysisInput) {
  logger.info("开始检测分析", {
    brandName: input.brand.name,
    responseCount: input.responses.length,
    providers: input.responses.map((item) => item.provider),
  });

  const responseGroups = new Map<string, DetectionAnalysisInput["responses"]>();
  input.responses.forEach((item) => {
    responseGroups.set(item.questionId, [...(responseGroups.get(item.questionId) || []), item]);
  });
  const grouped = Array.from(responseGroups.values());
  const batches = [] as Awaited<ReturnType<typeof analyzeDetectionBatch>>[];
  for (const responses of grouped) {
    batches.push(await analyzeDetectionBatch({ ...input, responses }));
  }
  const analyses = batches.flatMap((item) => item.analyses);
  const analysisModel = [...new Set(batches.map((item) => item.analysisModel))].join(", ");

  logger.info("全部回答分析合并完成，开始生成诊断", {
    analysisCount: analyses.length,
    model: analysisModel,
  });

  return {
    analyses,
    diagnosis: buildDetectionDiagnosis(input, analyses, analysisModel),
    analysisModel,
  };
}

export async function analyzeDetectionBatch(input: DetectionAnalysisInput) {
  if (!input.responses.length) {
    throw new DetectionAnalysisError("分析批次没有可处理的回答", 400, "invalid_response", false);
  }
  const rawAnalysis = await requestSemanticAnalysis(input, detectionAnalysisPromptVersion);
  const byId = new Map(rawAnalysis.data.results.map((item) => [item.resultId, item]));
  const missing = input.responses.filter((response) => !byId.has(response.resultId));
  if (missing.length) {
    throw new DetectionAnalysisError(
      `分析模型缺少${missing.length}条回答的结构化结果`,
      502,
      "invalid_response",
      true,
      "incomplete_batch",
    );
  }
  return {
    analyses: input.responses.map((response) => mergeRuleAndSemanticAnalysis(
      input.subject,
      input.brand,
      response,
      byId.get(response.resultId)!,
      rawAnalysis.model,
    )),
    analysisModel: rawAnalysis.model,
  };
}

async function requestSemanticAnalysis(
  input: DetectionAnalysisInput,
  promptVersion: string,
) {
  try {
    return await executeFoundationTask({
      taskType: "detection_analysis",
      promptVersion,
      prompt: buildAnalysisPrompt(input),
      schema: semanticPayloadSchema,
      enableWebSearch: false,
    });
  } catch (error) {
    if (error instanceof FoundationModelError) {
      logger.error("语义分析底座模型调用失败", {
        promptVersion,
        message: error.message,
        status: error.status,
        category: error.category,
        retryable: error.retryable,
        code: error.code,
      });
      throw new DetectionAnalysisError(
        error.message,
        error.status,
        error.category,
        error.retryable,
        error.code,
      );
    }
    logger.error("语义分析发生未知错误", {
      promptVersion,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function buildAnalysisPrompt(input: DetectionAnalysisInput) {
  return [
    "你是GEO检测结果分析器。请只依据给出的检测对象、品牌背景和AI原始回答进行判断，不得补充外部知识，不得猜测。",
    "规则：",
    "1. 只输出合法JSON，不要输出Markdown或解释。",
    "2. evidence字段必须逐字摘自对应原始回答；没有明确原文证据时返回空字符串。",
    "3. 仅以subject.name和subject.aliases识别检测对象；不得把母品牌、其他产品、错别字或相似名称当成检测对象。",
    "4. 检测对象未出现时presentationRole必须为not_mentioned，riskSignal必须为null。",
    "5. presentationRole只能为top_recommendation、alternative、general_mention、risk_warning、negative_counterexample、not_mentioned。",
    "6. top_recommendation表示首位或唯一优先推荐；alternative表示备选或并列推荐；general_mention表示仅提及；risk_warning表示主要作为风险提醒；negative_counterexample表示作为不推荐或负面反例。",
    "7. riskSignal只能为none_detected、cautious_description、negative_counterexample或null。限制条件、中性警示或谨慎措辞属于cautious_description；明确负面评价、不推荐或反例属于negative_counterexample。",
    "8. 呈现位置和风险信号相互独立，分别提供presentationEvidence和riskEvidence。none_detected不需要riskEvidence。",
    "9. conclusion用一句简短中文概括该回答如何呈现检测对象，不得推断回答之外的结论。",
    "10. competitorBrands只输出回答中真实出现、且与检测对象存在同类选择或比较关系的其他品牌；名称和evidence必须逐字出现在回答中。",
    "输出结构：",
    '{"results":[{"resultId":"...","conclusion":"...","presentationRole":"general_mention","presentationEvidence":"原文","riskSignal":"none_detected","riskEvidence":"","competitorBrands":[]}]}',
    "检测对象、品牌背景与回答数据：",
    JSON.stringify(input),
  ].join("\n");
}

function mergeRuleAndSemanticAnalysis(
  subject: DetectionAnalysisInput["subject"],
  brand: DetectionAnalysisInput["brand"],
  response: DetectionAnalysisInput["responses"][number],
  semantic: z.infer<typeof semanticResultSchema>,
  analysisModel: string,
): ResultAnalysis {
  const ownNames = dedupeNames([subject.name, ...subject.aliases], 20);
  const ownMatches = findExactNameMentions(response.answer, ownNames);
  const mentionCount = ownMatches.length;
  const firstMentionIndex = ownMatches[0]?.index;
  const targetMentioned = mentionCount > 0;
  const directQuestion = findExactNameMentions(response.question, ownNames).length > 0;
  const configuredCompetitorNames = dedupeNames(
    brand.competitors.map((competitor) => competitor.name),
    50,
  );
  const excludedNames = new Set([
    ...ownNames,
    brand.name,
    brand.shortName,
    brand.industry,
    brand.categoryName,
    ...brand.products.map((product) => product.name),
  ].map(normalizeName).filter(Boolean));
  const configuredMentions = configuredCompetitorNames.filter(
    (name) => findExactNameMentions(response.answer, [name]).length > 0,
  );
  const discoveredMentions = semantic.competitorBrands
    .filter((entry) => {
      const nameKey = normalizeName(entry.name);
      return !excludedNames.has(nameKey)
        && findExactNameMentions(response.answer, [entry.name]).length > 0
        && Boolean(validateEvidence(response.answer, entry.evidence));
    })
    .map((entry) => entry.name);
  const competitorMentions = dedupeNames(
    [...configuredMentions, ...discoveredMentions],
    50,
  );
  const roleEvidence = validateEvidence(response.answer, semantic.presentationEvidence);
  const requestedRole = targetMentioned && semantic.presentationRole !== "not_mentioned"
    ? semantic.presentationRole
    : targetMentioned ? "general_mention" : "not_mentioned";
  const presentationRole: PresentationRole = requestedRole !== "general_mention"
    && requestedRole !== "not_mentioned"
    && !roleEvidence
      ? "general_mention"
      : requestedRole;
  const riskEvidence = validateEvidence(response.answer, semantic.riskEvidence);
  const requestedRisk = targetMentioned ? semantic.riskSignal || "none_detected" : undefined;
  const riskSignal: RiskSignal | undefined = requestedRisk && requestedRisk !== "none_detected" && !riskEvidence
    ? "none_detected"
    : requestedRisk || undefined;
  const recommendationType = legacyRecommendationType(presentationRole);
  const recommended = presentationRole === "top_recommendation" || presentationRole === "alternative";
  const rankPosition = presentationRole === "top_recommendation" ? 1 : undefined;
  const firstOwnMatch = ownMatches[0]?.name || subject.name;
  const citations = response.citations.map((citation) => ({
    id: citation.id || createId("citation"),
    title: citation.title,
    url: citation.url,
    type: citation.type || "网页",
    providerType: citation.providerType,
    excerpt: citation.excerpt || "",
    relevance: citation.relevance || "中",
    credibility: citation.credibility || "中",
    normalizedUrl: normalizeCitationUrl(citation.url) || undefined,
    sourceCategory: classifyCitationSource({
      title: citation.title,
      url: citation.url,
      providerType: citation.providerType,
      officialWebsite: brand.website,
    }),
  }));

  return {
    resultId: response.resultId,
    brandMentioned: targetMentioned,
    targetMentioned,
    directQuestion,
    presentationRole,
    presentationEvidence: roleEvidence || (targetMentioned ? excerptAround(response.answer, firstOwnMatch) : ""),
    riskSignal,
    riskEvidence: riskSignal === "none_detected" ? "" : riskEvidence,
    mentionCount,
    firstMentionIndex,
    competitorMentions,
    mentionEvidence: targetMentioned
      ? excerptAround(response.answer, firstOwnMatch)
      : "",
    recommended,
    recommendationType,
    recommendationPosition: presentationLabel(presentationRole),
    rankPosition,
    recommendationEvidence: roleEvidence,
    sentimentLabel: undefined,
    sentimentScore: undefined,
    sentimentEvidence: riskEvidence,
    positiveEvaluationCount: 0,
    negativeEvaluationCount: 0,
    accuracy: "待确认",
    accuracyScore: undefined,
    accuracyEvidence: "",
    analysisConclusion: semantic.conclusion,
    factClaims: [],
    rankedBrands: [],
    reputationTopics: [],
    citations,
    analysisModel,
  };
}

export function buildDetectionDiagnosis(
  input: DetectionAnalysisInput,
  analyses: ResultAnalysis[],
  analysisModel: string,
): Diagnosis {
  const total = analyses.length || 1;
  const mentioned = analyses.filter((item) => item.brandMentioned);
  const recommended = analyses.filter((item) => item.recommended);
  const rankedResults = analyses.flatMap((item) => {
    const rank = ownBrandRank(item, input.brand.name, input.brand.shortName);
    return rank === undefined ? [] : [rank];
  });
  const top3Count = rankedResults.filter((rank) => rank <= 3).length;
  const firstPlaceCount = rankedResults.filter((rank) => rank === 1).length;
  const weightedRecommendations = analyses.reduce(
    (sum, item) => sum + recommendationWeight(item.recommendationType),
    0,
  );
  const reputationItems = analyses.flatMap((item) => item.reputationTopics);
  const positiveReputationItems = reputationItems.filter((item) => item.sentimentLabel === "积极");
  const positiveEvaluationCount = analyses.reduce((sum, item) => sum + item.positiveEvaluationCount, 0);
  const negativeEvaluationCount = analyses.reduce((sum, item) => sum + item.negativeEvaluationCount, 0);
  const aggregateSentiment = calculateSentiment(positiveEvaluationCount, negativeEvaluationCount);
  const sentimentLabelCounts = {
    positive: analyses.filter((item) => item.sentimentLabel === "积极").length,
    neutral: analyses.filter((item) => item.sentimentLabel === "中性").length,
    improve: analyses.filter((item) => item.sentimentLabel === "需改善").length,
  };

  const scores: DiagnosisScores = {
    visibility: clampScore(mentioned.length / total * 100),
    ranking: clampScore(
      weightedRecommendations / total * 40
      + top3Count / total * 40
      + firstPlaceCount / total * 20,
    ),
    reputation: reputationItems.length
      ? clampScore(positiveReputationItems.length / reputationItems.length * 100)
      : 0,
    sentiment: aggregateSentiment.score ?? 0,
  };
  const scoreAvailability: Diagnosis["scoreAvailability"] = {
    visibility: true,
    ranking: true,
    reputation: reputationItems.length > 0,
    sentiment: aggregateSentiment.score !== undefined,
  };
  const issueCandidates: ObjectiveCandidate[] = [
    {
      dimension: "visibility" as const,
      score: scores.visibility,
      available: true,
      title: scores.visibility < 60 ? "品牌在AI回答中的出现不足" : "品牌能见仍有提升空间",
       evidence: `${mentioned.length}/${total}条回答提及${input.brand.name}，其中${recommended.length}/${total}条计入推荐口径（含仅提及）。`,
      description: "围绕用户真实问题补充更容易被AI识别和复述的品牌、服务与适用场景信息。",
    },
    {
      dimension: "ranking" as const,
      score: scores.ranking,
      available: true,
      title: scores.ranking < 60 ? "品牌推荐排名偏后或未进入榜单" : "品牌推荐排名仍可提升",
      evidence: `${rankedResults.length}/${total}条回答形成可识别排名，Top3共${top3Count}条，首位推荐${firstPlaceCount}条。`,
      description: "围绕高意向选择问题强化差异化优势和首选理由，提高品牌进入推荐前列的机会。",
    },
    {
      dimension: "reputation" as const,
      score: scores.reputation,
      available: reputationItems.length > 0,
      title: reputationItems.length ? "品牌正向口碑主题覆盖不足" : "AI回答中缺少明确品牌口碑",
      evidence: reputationItems.length
        ? `${reputationItems.length}条可核验口碑主题中，${positiveReputationItems.length}条为正向评价。`
        : "本次回答未提取到带有原文依据的品牌评价主题。",
      description: "补充真实服务特点、体验反馈和可核验案例，让AI形成具体而稳定的品牌评价。",
    },
    {
      dimension: "sentiment" as const,
      score: scores.sentiment,
      available: aggregateSentiment.score !== undefined,
      title: scores.sentiment < 60 ? "品牌情感表达需要改善" : "品牌积极情感表达仍可加强",
      evidence: aggregateSentiment.score === undefined
        ? "本次回答没有可核验的品牌评价词句，暂不计算情感得分。"
        : `${sentimentLabelCounts.positive}条回答为积极、${sentimentLabelCounts.neutral}条为中性、${sentimentLabelCounts.improve}条需改善；积极评价${positiveEvaluationCount}条、需改善评价${negativeEvaluationCount}条，情感得分${scores.sentiment}分。`,
      description: "围绕真实服务优势、用户关切和体验保障，增强AI回答中的积极品牌感受。",
    },
  ].sort((a, b) => Number(b.available) - Number(a.available) || a.score - b.score);
  const selected = issueCandidates.filter((item) => item.available && item.score < 75).slice(0, 3);
  const priorities = selected.length ? selected : issueCandidates.slice(0, 1);
  const summary = [
    `本次共分析${total}条AI回答，${mentioned.length}条提及${input.brand.name}，${recommended.length}条形成推荐。`,
    `四维得分为：能见${scores.visibility}分、排名${scores.ranking}分、口碑${scoreText(scores.reputation, Boolean(scoreAvailability.reputation))}、情感${scoreText(scores.sentiment, Boolean(scoreAvailability.sentiment))}。`,
  ].join("");
  logger.info("诊断评分计算完成", {
    brandName: input.brand.name,
    total,
    mentioned: mentioned.length,
    recommended: recommended.length,
    top3Count,
    firstPlaceCount,
    scores,
    priorityDimensions: priorities.map((item) => item.dimension),
  });

  logger.info("诊断生成完成", {
    brandName: input.brand.name,
    issueCount: priorities.length,
    suggestionCount: 0,
  });

  return {
    scores,
    scoreAvailability,
    analysisModel,
    summary,
    issues: priorities.map((item) => ({
      id: createId("issue"),
      title: item.title,
      severity: item.score < 40 ? "high" : item.score < 70 ? "medium" : "low",
      dimension: item.dimension,
      evidence: item.evidence,
    })),
    suggestions: [],
    suggestionStatus: "not_generated",
  };
}

export async function generateOptimizationSuggestions(
  input: DetectionAnalysisInput,
  analyses: ResultAnalysis[],
  diagnosis: Diagnosis,
) {
  const issuePriorities: ObjectiveCandidate[] = diagnosis.issues.slice(0, 3).map((issue) => ({
    dimension: issue.dimension,
    score: diagnosis.scores[issue.dimension],
    available: diagnosis.scoreAvailability?.[issue.dimension] !== false,
    title: issue.title,
    evidence: issue.evidence,
    description: suggestionDirection(issue.dimension),
  }));
  const priorities = issuePriorities.length ? issuePriorities : [fallbackObjectiveCandidate(diagnosis)];
  try {
    const result = await executeFoundationTask({
      taskType: "optimization_goal",
      promptVersion: optimizationGoalPromptVersion,
      prompt: buildOptimizationGoalPrompt(input, analyses, priorities),
      schema: optimizationGoalPayloadSchema,
      enableWebSearch: false,
    });
    const byDimension = new Map(result.data.goals.map((goal) => [goal.dimension, goal]));
    logger.info("优化目标底座模型生成完成", {
      model: result.model,
      attempts: result.attempts,
      latencyMs: result.latencyMs,
      generatedDimensions: result.data.goals.map((goal) => goal.dimension),
    });
    const usedTitles = new Set<string>();
    return priorities.map((item, index) => {
      const generated = byDimension.get(item.dimension);
      const fallback = fallbackOptimizationSuggestion(input, item, index);
      if (!generated || !isUsableOptimizationGoal(generated, usedTitles)) {
        logger.warn("优化目标结果不完整或不适合前台展示，已使用规则兜底", {
          dimension: item.dimension,
          reason: generated ? "invalid_or_duplicate_goal" : "missing_goal_dimension",
        });
        usedTitles.add(normalizeGoalText(fallback.title));
        return fallback;
      }
      usedTitles.add(normalizeGoalText(generated.title));
      return {
        id: createId("suggestion"),
        dimension: item.dimension,
        title: generated.title,
        reason: generated.reason,
        description: generated.direction,
        generatedBy: "foundation_model" as const,
        generationModel: result.model,
        promptVersion: optimizationGoalPromptVersion,
      };
    });
  } catch (error) {
    if (error instanceof FoundationModelError) {
      logger.warn("优化目标底座模型生成失败", {
        message: error.message,
        status: error.status,
        category: error.category,
        code: error.code,
        dimensions: priorities.map((item) => item.dimension),
      });
    } else {
      logger.error("优化目标生成发生未知错误", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return priorities.map((item, index) => fallbackOptimizationSuggestion(input, item, index));
  }
}

function buildOptimizationGoalPrompt(
  input: DetectionAnalysisInput,
  analyses: ResultAnalysis[],
  priorities: ObjectiveCandidate[],
) {
  const positioning = input.brand.positioningStatement.trim();
  return [
    "你是资深品牌定位与GEO内容策略顾问。请依据品牌定位、品牌事实和本次检测证据，生成1—3个有依据、可执行且互不重复的优化目标。",
    "要求：",
    "1. 只输出合法JSON，不要输出Markdown或解释。",
    "2. goals必须与候选维度逐一对应，不得增加、遗漏或重复维度。",
    "3. 先确定该目标要帮助用户建立的品牌认知cognition。品牌定位不为空时，认知和标题必须与定位保持一致，不得改写成冲突的定位。",
    "4. 品牌定位为空时，根据品类、品牌特性、信任状、目标人群和产品信息推导一个保守的认知方向；不得把推导结果冒充为品牌已确认的官方定位。",
    "5. title必须体现要建立的认知或具体选择理由，长度4—36个汉字；不要写‘提升能见、提升排名、改善口碑、改善情感、持续优化’等诊断术语或空话。",
    "6. reason用一句话简要说明目标依据，必须同时关联品牌定位或品牌资料，以及本次检测中真实存在的内容缺口。",
    "7. direction用一句话说明7天内应补充什么内容、回应什么用户问题或场景；必须具体可执行，不能只写‘加强内容建设’。",
    "8. 不得出现分数、提升比例、验证指标、保证性表达，或无法核验的排名、流量、获客承诺。",
    "9. 不得补造品牌资质、产品能力、案例、评价或竞品事实；不同目标的认知角度和内容方向不得重复。",
    '输出结构：{"goals":[{"dimension":"visibility","cognition":"希望用户形成的品牌认知","title":"目标名称","reason":"目标依据","direction":"优化方向"}]}',
    "输入数据：",
    JSON.stringify({
      brand: {
        name: input.brand.name,
        shortName: input.brand.shortName,
        characteristics: input.brand.characteristics,
        categoryName: input.brand.categoryName,
        trustProof: input.brand.trustProof,
        positioningStatement: input.brand.positioningStatement,
        industry: input.brand.industry,
        serviceArea: input.brand.serviceArea,
        targetAudience: input.brand.targetAudience,
        products: input.brand.products.slice(0, 8).map(({ name, description, features }) => ({ name, description, features })),
      },
      positioningPolicy: positioning
        ? { mode: "use_profile_positioning", value: positioning }
        : {
            mode: "infer_conservative_cognition",
            note: "品牌定位未填写，只能依据现有品牌资料推导，不得扩写为未经确认的品牌事实。",
          },
      questions: [...new Set(input.responses.map((item) => item.question))],
      candidates: priorities.map(({ dimension, evidence, description }, index) => ({
        priority: index + 1,
        dimension,
        evidence,
        suggestedDirection: description,
      })),
      answerSignals: analyses.slice(0, 8).map((item) => ({
        conclusion: item.analysisConclusion,
        mentioned: item.brandMentioned,
        recommended: item.recommended,
        rank: ownBrandRank(item, input.brand.name, input.brand.shortName),
        reputationTopics: item.reputationTopics.map((topic) => ({
          label: topic.label,
          sentiment: topic.sentimentLabel,
        })),
      })),
    }),
  ].join("\n");
}

const unsafeGoalPattern = /(保证|确保|一定|必然|百分百|100%|获客翻倍|流量翻倍|稳居|第一名|提升至|提高至|达到\s*\d|\d+\s*%)/i;
const exposedDimensionPattern = /(能见|排名|口碑|情感)(度|分|指标|维度)?/;

function isUsableOptimizationGoal(
  goal: z.infer<typeof optimizationGoalPayloadSchema>["goals"][number],
  usedTitles: Set<string>,
) {
  const text = `${goal.title} ${goal.reason} ${goal.direction}`;
  const titleKey = normalizeGoalText(goal.title);
  return Boolean(titleKey)
    && !usedTitles.has(titleKey)
    && !unsafeGoalPattern.test(text)
    && !exposedDimensionPattern.test(text);
}

function normalizeGoalText(value: string) {
  return value.toLowerCase().replace(/[\s，。、“”‘’：:；;！!？?（）()【】\[\]]/g, "");
}

function fallbackObjectiveCandidate(diagnosis: Diagnosis): ObjectiveCandidate {
  const dimension = (Object.keys(diagnosis.scores) as (keyof DiagnosisScores)[])
    .filter((key) => diagnosis.scoreAvailability?.[key] !== false)
    .sort((left, right) => diagnosis.scores[left] - diagnosis.scores[right])[0] || "visibility";
  return {
    dimension,
    score: diagnosis.scores[dimension],
    available: diagnosis.scoreAvailability?.[dimension] !== false,
    title: "品牌认知仍有补充空间",
    evidence: diagnosis.summary,
    description: suggestionDirection(dimension),
  };
}

function fallbackOptimizationSuggestion(
  input: DetectionAnalysisInput,
  candidate: ObjectiveCandidate,
  index: number,
) {
  const positioning = input.brand.positioningStatement.trim();
  const cognition = compactGoalPhrase(
    positioning
      || input.brand.categoryName
      || input.brand.products[0]?.name
      || input.brand.characteristics
      || input.brand.industry
      || `${input.brand.name}的可信服务`,
    14,
  );
  const titles: Record<keyof DiagnosisScores, string> = {
    visibility: `围绕“${cognition}”建立清晰认知`,
    ranking: `说清“${cognition}”的选择理由`,
    reputation: `用真实服务支撑“${cognition}”`,
    sentiment: `回应顾虑，强化“${cognition}”认知`,
  };
  const reasonPrefix = positioning
    ? `品牌定位聚焦“${compactGoalPhrase(positioning, 18)}”`
    : `品牌定位尚未填写，结合${compactGoalPhrase(input.brand.categoryName || input.brand.industry || "现有品牌资料", 12)}形成保守认知方向`;
  const reasons: Record<keyof DiagnosisScores, string> = {
    visibility: "本次回答中能够清晰识别品牌与服务场景的信息仍不充分。",
    ranking: "本次回答中的具体选择理由和推荐顺序仍不够稳定。",
    reputation: "本次回答可核验的服务特点与评价依据仍不充分。",
    sentiment: "本次回答对用户顾虑和体验感受的回应仍不充分。",
  };
  const audience = compactGoalPhrase(input.brand.targetAudience || "目标用户", 12);
  const directions: Record<keyof DiagnosisScores, string> = {
    visibility: `围绕${audience}常问的服务场景，补充品牌、产品、适用人群和服务区域的清晰说明。`,
    ranking: `围绕${audience}的选择问题，整理适用场景、真实差异、服务边界和可核验选择依据。`,
    reputation: "补充真实服务流程、服务保障、产品特点和已有信任状，形成可核验的问答与说明内容。",
    sentiment: "针对用户常见顾虑，客观说明价格、流程、服务边界和体验保障，避免夸大承诺。",
  };
  return {
    id: createId("suggestion"),
    title: compactGoalPhrase(titles[candidate.dimension], 36) || `建立清晰品牌认知${index + 1}`,
    description: directions[candidate.dimension],
    reason: `${reasonPrefix}；${reasons[candidate.dimension]}`,
    dimension: candidate.dimension,
    generatedBy: "rule_fallback" as const,
    generationModel: "rule-fallback",
    promptVersion: optimizationGoalPromptVersion,
  };
}

function compactGoalPhrase(value: string, maxLength: number) {
  const text = value.trim().replace(/\s+/g, " ").replace(/[。；;]+$/g, "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function suggestionDirection(dimension: keyof DiagnosisScores) {
  if (dimension === "ranking") return "强化差异化优势和具体首选理由，提升推荐顺序。";
  if (dimension === "reputation") return "补充真实服务特点、体验反馈和可核验案例。";
  if (dimension === "sentiment") return "围绕真实优势、用户关切和体验保障增强积极表达。";
  return "围绕用户真实问题补充可识别、可复述的品牌与服务信息。";
}

function ownBrandRank(item: ResultAnalysis, brandName: string, shortName?: string) {
  if (item.rankPosition !== undefined) return item.rankPosition;
  const brandKeys = new Set([brandName, shortName || ""].map(normalizeName).filter(Boolean));
  return item.rankedBrands.find((entry) => brandKeys.has(normalizeName(entry.name)))?.rank;
}

function legacyRecommendationType(role: PresentationRole): RecommendationType {
  if (role === "top_recommendation") return "top_pick";
  if (role === "alternative") return "recommended";
  if (role === "negative_counterexample") return "discouraged";
  if (role === "not_mentioned") return "not_mentioned";
  return "mentioned_only";
}

function presentationLabel(role: PresentationRole) {
  if (role === "top_recommendation") return "首位推荐";
  if (role === "alternative") return "备选方案";
  if (role === "general_mention") return "一般提及";
  if (role === "risk_warning") return "风险提醒";
  if (role === "negative_counterexample") return "负向反例";
  return "未出现";
}

function excerptAround(text: string, value: string) {
  const index = text.indexOf(value);
  if (index < 0) return "";
  const start = Math.max(0, index - 45);
  const end = Math.min(text.length, index + value.length + 75);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

function validateEvidence(answer: string, evidence: string) {
  const value = evidence.trim().replace(/^["“”']+|["“”']+$/g, "");
  return value && answer.includes(value) ? value : "";
}

function scoreText(score: number, available: boolean) {
  return available ? `${score}分` : "--";
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
