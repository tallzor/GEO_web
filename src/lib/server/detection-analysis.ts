import "server-only";

import { z } from "zod";
import type {
  Diagnosis,
  DiagnosisScores,
  ProviderErrorCategory,
  ProviderId,
  RecommendationType,
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
  dedupeNames,
  findExactNameMentions,
  normalizeName,
  recommendationWeight,
} from "@/lib/server/detection-analysis-rules";

const logger = createLogger("detection-analysis");

const semanticResultSchema = z.object({
  resultId: z.string().min(1),
  conclusion: z.string().trim().min(1).max(500),
  recommendationType: z.enum([
    "top_pick",
    "recommended",
    "conditional",
    "mentioned_only",
    "discouraged",
    "not_mentioned",
  ]),
  rankPosition: z.number().int().positive().nullable().optional(),
  recommendationEvidence: z.string().trim().max(300).optional().default(""),
  sentiment: z.enum(["积极", "中性", "需改善"]).nullable().optional().default(null),
  sentimentEvidence: z.string().trim().max(300).optional().default(""),
  positiveEvaluations: z.array(z.string().trim().min(1).max(300)).max(30).optional().default([]),
  negativeEvaluations: z.array(z.string().trim().min(1).max(300)).max(30).optional().default([]),
  factClaims: z.array(z.string().trim().min(1).max(300)).max(30).optional().default([]),
  rankedBrands: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    rank: z.number().int().positive().max(50).nullable().optional(),
    evidence: z.string().trim().max(300).optional().default(""),
  })).max(80).optional().default([]),
  competitorBrands: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    evidence: z.string().trim().min(1).max(300),
  })).max(50).optional().default([]),
  reputationTopics: z.array(z.object({
    label: z.string().trim().min(1).max(40),
    sentiment: z.enum(["积极", "中性", "需改善"]),
    evidence: z.string().trim().max(300).optional().default(""),
  })).max(30).optional().default([]),
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
export const detectionAnalysisPromptVersion = "detection-analysis-v4-question-batch";
export const detectionAnalysisRuleVersion = "geo-four-dimensions-v3";

export type DetectionAnalysisInput = {
  brand: {
    name: string;
    shortName: string;
    characteristics: string;
    categoryName: string;
    trustProof: string;
    positioningStatement: string;
    industry: string;
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
    citations: { title: string; url: string }[];
  }[];
};

export type ResultAnalysis = {
  resultId: string;
  brandMentioned: boolean;
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
    "你是GEO检测结果分析器。请只依据给出的品牌档案和AI原始回答进行判断，不得补充外部知识，不得猜测。",
    "规则：",
    "1. 只输出合法JSON，不要输出Markdown或解释。",
    "2. evidence字段必须逐字摘自对应原始回答；没有明确原文证据时返回空字符串。",
    "3. 仅以品牌全称和档案中的品牌简称识别本品牌；不得把别名、错别字或相似名称当作本品牌。",
    "4. 品牌未出现时recommendationType必须为not_mentioned；仅出现品牌名称但没有推荐语义时为mentioned_only。",
    "5. recommendationType只能为top_pick、recommended、conditional、mentioned_only、discouraged、not_mentioned。",
    "6. conclusion用一句简短中文概括该回答对品牌的呈现情况。",
    "7. positiveEvaluations与negativeEvaluations逐条输出对本品牌的积极或需改善评价原句；同一句不要重复。没有本品牌或无法判断评价倾向时都返回空数组。",
    "8. sentiment只能为积极、中性、需改善或null；没有本品牌、没有评价语句或无法判断时必须为null。最终情感分值由系统按正负评价数量计算，不要输出分值。",
    "9. factClaims最多30条，只提取回答中关于本品牌的事实陈述原句，不得改写。",
    "10. rankedBrands按回答中的推荐或列举顺序输出品牌名称与名次；整理去重后最多保留50个，名称和evidence必须真实出现在回答中，无法判断顺序时rank为null。",
    "11. competitorBrands输出回答中真实出现、且与本品牌存在同类选择或比较关系的其他品牌；不限于档案已配置竞品。名称与evidence必须逐字出现在回答中，不得把品类、地点或泛称当品牌。",
    "12. reputationTopics只提炼回答中对本品牌的明确评价主题，情感只能为积极、中性、需改善，必须提供原文evidence；没有明确评价时返回空数组。",
    "输出结构：",
    '{"results":[{"resultId":"...","conclusion":"...","recommendationType":"mentioned_only","rankPosition":null,"recommendationEvidence":"","sentiment":null,"sentimentEvidence":"","positiveEvaluations":[],"negativeEvaluations":[],"factClaims":[],"rankedBrands":[],"competitorBrands":[],"reputationTopics":[]}]}',
    "品牌档案与回答数据：",
    JSON.stringify(input),
  ].join("\n");
}

function mergeRuleAndSemanticAnalysis(
  brand: DetectionAnalysisInput["brand"],
  response: DetectionAnalysisInput["responses"][number],
  semantic: z.infer<typeof semanticResultSchema>,
  analysisModel: string,
): ResultAnalysis {
  const ownNames = dedupeNames([brand.name, brand.shortName], 2);
  const ownMatches = findExactNameMentions(response.answer, ownNames);
  const mentionCount = ownMatches.length;
  const firstMentionIndex = ownMatches[0]?.index;
  const brandMentioned = mentionCount > 0;
  const configuredCompetitorNames = dedupeNames(
    brand.competitors.map((competitor) => competitor.name),
    50,
  );
  const excludedNames = new Set([
    ...ownNames,
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
  const recommendationType = brandMentioned
    ? semantic.recommendationType === "not_mentioned"
      ? "mentioned_only"
      : semantic.recommendationType
    : "not_mentioned";
  const recommended = recommendationWeight(recommendationType) > 0;
  const rankPosition = recommended && semantic.rankPosition
    ? semantic.rankPosition
    : undefined;
  const positiveEvaluations = brandMentioned
    ? validatedEvidenceList(response.answer, semantic.positiveEvaluations, 30)
    : [];
  const negativeEvaluations = brandMentioned
    ? validatedEvidenceList(response.answer, semantic.negativeEvaluations, 30)
    : [];
  const sentiment = calculateSentiment(positiveEvaluations.length, negativeEvaluations.length);
  const semanticSentimentEvidence = validateEvidence(response.answer, semantic.sentimentEvidence);
  const sentimentEvidence = semanticSentimentEvidence
    || positiveEvaluations[0]
    || negativeEvaluations[0]
    || "";
  const rankedBrands = dedupeRankedBrands(
    response.answer,
    semantic.rankedBrands,
    configuredCompetitorNames,
  );
  const firstOwnMatch = ownMatches[0]?.name || brand.name;

  return {
    resultId: response.resultId,
    brandMentioned,
    mentionCount,
    firstMentionIndex,
    competitorMentions,
    mentionEvidence: brandMentioned
      ? excerptAround(response.answer, firstOwnMatch)
      : "",
    recommended,
    recommendationType,
    recommendationPosition: recommendationLabel(recommendationType, rankPosition),
    rankPosition,
    recommendationEvidence: validateEvidence(response.answer, semantic.recommendationEvidence),
    sentimentLabel: sentiment.label,
    sentimentScore: sentiment.score,
    sentimentEvidence,
    positiveEvaluationCount: sentiment.positiveEvaluationCount,
    negativeEvaluationCount: sentiment.negativeEvaluationCount,
    accuracy: "待确认",
    accuracyScore: undefined,
    accuracyEvidence: "",
    analysisConclusion: semantic.conclusion,
    factClaims: brandMentioned
      ? validatedEvidenceList(response.answer, semantic.factClaims, 30)
      : [],
    rankedBrands,
    reputationTopics: (brandMentioned ? semantic.reputationTopics : [])
      .filter((entry) => Boolean(validateEvidence(response.answer, entry.evidence)))
      .map((entry) => ({
        label: entry.label,
        sentimentLabel: entry.sentiment,
        evidence: validateEvidence(response.answer, entry.evidence),
      }))
      .slice(0, 30),
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

function recommendationLabel(type: RecommendationType, rankPosition?: number) {
  if (type === "top_pick") return "首选推荐";
  if (type === "recommended") return rankPosition ? `推荐列表第${rankPosition}位` : "明确推荐";
  if (type === "conditional") return "条件推荐";
  if (type === "mentioned_only") return "仅提及品牌";
  if (type === "discouraged") return "不建议";
  return "未提及品牌";
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

function validatedEvidenceList(answer: string, items: string[], limit: number) {
  return dedupeNames(
    items.map((item) => validateEvidence(answer, item)).filter(Boolean),
    limit,
  );
}

function dedupeRankedBrands(
  answer: string,
  entries: z.infer<typeof semanticResultSchema>["rankedBrands"],
  configuredCompetitorNames: string[],
) {
  const configuredKeys = new Set(configuredCompetitorNames.map(normalizeName));
  const seen = new Set<string>();
  const result: ResultAnalysis["rankedBrands"] = [];
  for (const entry of entries) {
    const key = normalizeName(entry.name);
    if (!key || seen.has(key) || !findExactNameMentions(answer, [entry.name]).length) continue;
    seen.add(key);
    result.push({
      name: entry.name.trim(),
      rank: entry.rank || undefined,
      evidence: validateEvidence(answer, entry.evidence) || excerptAround(answer, entry.name),
      configuredCompetitor: configuredKeys.has(key),
    });
    if (result.length >= 50) break;
  }
  return result;
}

function scoreText(score: number, available: boolean) {
  return available ? `${score}分` : "--";
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
