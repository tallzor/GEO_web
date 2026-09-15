import type {
  Brand,
  CognitionInsight,
  CognitionRun,
  QuestionCandidate,
  QuestionPersona,
  QuestionSimulationMode,
  QuestionSimulationRun,
} from "@/lib/types";
import { createId, isoNow } from "@/lib/utils";

export const QUESTION_LIBRARY_LIMIT = 240;
export const QUESTION_DETECTION_MIN = 1;
export const QUESTION_DETECTION_MAX = 10;
export const QUESTION_REVIEW_MAX = 24;
export const QUESTION_TEXT_MIN = 4;
export const QUESTION_TEXT_MAX = 300;
export const QUESTION_SIMULATION_PROMPT_VERSION = "question-simulation-v1";
export const QUESTION_QUALITY_RULE_VERSION = "question-quality-v1";

export type QuestionSimulationTarget = {
  subjectType: "brand" | "product";
  subjectId: string;
};

export type QuestionSimulationPreflightIssue = {
  path: string;
  message: string;
};

export type QuestionSimulationContext = {
  brand: Brand;
  cognitionRun?: CognitionRun;
  target: QuestionSimulationTarget;
};

export function preflightQuestionSimulation(context: QuestionSimulationContext) {
  const issues: QuestionSimulationPreflightIssue[] = [];
  const { brand, target } = context;
  const snapshot = context.cognitionRun?.inputSnapshot;
  const product = target.subjectType === "product"
    ? snapshot?.products.find((item) => item.id === target.subjectId)
    : undefined;
  const insight = currentConfirmedInsight(context.cognitionRun, target);

  if (target.subjectType === "brand" && target.subjectId !== brand.id) {
    issues.push({ path: "subject", message: "品牌检测对象不存在" });
  }
  if (target.subjectType === "product" && !product) {
    issues.push({ path: "subject", message: "产品或服务检测对象不存在" });
  }
  if (!insight) {
    issues.push({ path: "cognition", message: "请先完成并确认该对象的认知洞察" });
  }

  const audience = target.subjectType === "brand"
    ? snapshot?.brand.targetAudience || ""
    : product?.audience || snapshot?.brand.targetAudience || "";
  if (!audience.trim() || insightSaysInsufficient(insight, ["audience_scenarios", "audience"])) {
    issues.push({ path: "audience", message: "请补充明确的目标用户，并按需更新认知洞察" });
  }

  const decisionInputs = target.subjectType === "brand"
    ? [snapshot?.brand.coreScenarios, snapshot?.brand.valuePromise, snapshot?.brand.cognitionBoundary]
    : [product?.scenarios, product?.problemsSolved, product?.limitations];
  const hasDecisionInput = decisionInputs.some((value) => Boolean(value?.trim()));
  const hasUsableInsight = insight?.items.some((item) => (
    item.supportStatus !== "insufficient"
    && item.conclusion.trim()
    && !isInsufficientText(item.conclusion)
  ));
  if (!hasDecisionInput && !hasUsableInsight) {
    issues.push({ path: "scenario", message: "请补充场景、待解决问题或决策任务，并按需更新认知洞察" });
  }

  return { ready: issues.length === 0, issues, insight, product };
}

export function buildLocalQuestionSimulationRun(
  context: QuestionSimulationContext,
  mode: QuestionSimulationMode,
  existingRunId?: string,
): QuestionSimulationRun {
  const checked = preflightQuestionSimulation(context);
  if (!checked.ready || !checked.insight) {
    throw new Error(checked.issues[0]?.message || "当前信息不足，无法生成模拟问题");
  }
  const now = isoNow();
  const runId = existingRunId || createId("question_simulation");
  const subjectName = context.target.subjectType === "brand"
    ? context.cognitionRun?.inputSnapshot.brand.name || context.brand.name
    : checked.product?.name || "产品或服务";
  const audience = context.target.subjectType === "brand"
    ? context.cognitionRun?.inputSnapshot.brand.targetAudience || ""
    : checked.product?.audience || context.cognitionRun?.inputSnapshot.brand.targetAudience || "";
  const scenarios = splitInputs(context.target.subjectType === "brand"
    ? [context.cognitionRun?.inputSnapshot.brand.coreScenarios, context.cognitionRun?.inputSnapshot.brand.valuePromise]
    : [checked.product?.scenarios, checked.product?.problemsSolved, checked.product?.limitations]);
  const personas = buildLocalPersonas(audience, scenarios);
  const candidates = buildLocalCandidates({
    runId,
    brandName: context.cognitionRun?.inputSnapshot.brand.name || context.brand.name,
    subjectName,
    subjectType: context.target.subjectType,
    categoryName: context.target.subjectType === "brand"
      ? context.cognitionRun?.inputSnapshot.brand.categoryName || context.cognitionRun?.inputSnapshot.brand.industry || ""
      : checked.product?.type || context.cognitionRun?.inputSnapshot.brand.categoryName || context.cognitionRun?.inputSnapshot.brand.industry || "",
    personas,
    scenarios,
    existingQuestions: context.brand.questions.map((item) => item.text),
    now,
  });
  return {
    id: runId,
    brandId: context.brand.id,
    subjectType: context.target.subjectType,
    subjectId: context.target.subjectId,
    subjectName,
    cognitionInsightId: checked.insight.id,
    cognitionVersion: checked.insight.version,
    mode,
    status: "review_required",
    stage: "validation",
    personas,
    candidates,
    coverageGaps: candidates.length < 12 ? ["当前事实可支撑的问题不足12道，可手动补充"] : [],
    externalReferences: [],
    attempt: 1,
    promptVersion: QUESTION_SIMULATION_PROMPT_VERSION,
    generatedCount: candidates.length,
    adoptedCount: 0,
    deletedCount: 0,
    editedCount: 0,
    createdAt: now,
    updatedAt: now,
    completedAt: now,
  };
}

export function validateReviewedCandidates<T extends {
  text: string;
  persona: string;
  decisionScenario: string;
}>(items: T[]): Array<T & { text: string; persona: string; decisionScenario: string }> {
  if (!items.length) throw new Error("请至少选择1道问题加入问题库");
  if (items.length > QUESTION_REVIEW_MAX) throw new Error(`一次最多确认${QUESTION_REVIEW_MAX}道问题`);
  return items.map((item) => {
    const text = item.text.trim();
    const persona = item.persona.trim();
    const decisionScenario = item.decisionScenario.trim();
    if (text.length < QUESTION_TEXT_MIN || text.length > QUESTION_TEXT_MAX) {
      throw new Error(`问题需为${QUESTION_TEXT_MIN}—${QUESTION_TEXT_MAX}个字符`);
    }
    if (!persona) throw new Error("每道问题都需要对应模拟用户角色");
    if (!decisionScenario) throw new Error("每道问题都需要决策场景");
    return { ...item, text, persona, decisionScenario };
  });
}

export function questionCapacityShortfall(currentCount: number, additions: number) {
  return Math.max(0, currentCount + additions - QUESTION_LIBRARY_LIMIT);
}

export function currentConfirmedInsight(
  run: CognitionRun | undefined,
  target: QuestionSimulationTarget,
): CognitionInsight | undefined {
  if (!run || run.status !== "confirmed") return undefined;
  return run.insights.find((item) => item.status === "confirmed"
    && item.isCurrent
    && item.subjectType === target.subjectType
    && item.subjectId === target.subjectId);
}

function insightSaysInsufficient(insight: CognitionInsight | undefined, keys: string[]) {
  const matched = insight?.items.filter((item) => keys.includes(item.key)) || [];
  return matched.length > 0 && matched.every((item) => (
    item.supportStatus === "insufficient" || isInsufficientText(item.conclusion)
  ));
}

function isInsufficientText(value: string) {
  return /^(信息不足|暂无|未知|未提供)[。.!！]?$/u.test(value.trim());
}

function splitInputs(values: Array<string | undefined>) {
  const items = values.flatMap((value) => (value || "").split(/[，、；;。\n]/u))
    .map((value) => value.trim()).filter(Boolean);
  return [...new Set(items)].slice(0, 6);
}

function buildLocalPersonas(audienceText: string, scenarios: string[]): QuestionPersona[] {
  const audiences = splitInputs([audienceText]);
  const roles = audiences.length ? audiences : ["潜在用户"];
  return Array.from({ length: 4 }, (_, index) => {
    const audience = roles[index % roles.length];
    const scenario = scenarios[index % Math.max(scenarios.length, 1)] || "了解并选择合适方案";
    const names = ["首次了解者", "谨慎比较者", "实际使用者", "决策把关者"];
    return {
      id: createId("persona"),
      name: `${audience}·${names[index]}`,
      audience,
      knowledgeLevel: index === 0 ? "刚意识到需求" : index === 1 ? "正在比较方案" : "已有基础了解",
      decisionScenario: scenario,
      task: index < 2 ? "找到适合自己的解决方案" : "判断是否值得进一步了解或采用",
      concern: index % 2 ? "适用条件与选择差异" : "实际效果与可信依据",
      constraints: "不预设品牌一定适合",
      decisionStage: index === 0 ? "需求萌生" : index === 1 ? "比较选择" : "信任决策",
    };
  });
}

function buildLocalCandidates(input: {
  runId: string;
  brandName: string;
  subjectName: string;
  subjectType: "brand" | "product";
  categoryName: string;
  personas: QuestionPersona[];
  scenarios: string[];
  existingQuestions: string[];
  now: string;
}): QuestionCandidate[] {
  const category = input.categoryName || "这类产品或服务";
  const scenarios = input.scenarios.length ? input.scenarios : ["实际使用", "比较选择"];
  const directName = input.subjectName;
  const texts = [
    `遇到${scenarios[0]}需求时，应该先了解哪些${category}方案？`,
    `${category}通常适合哪些人，选择前要确认什么？`,
    `第一次了解${category}时，哪些信息最值得优先核实？`,
    `怎样判断一种${category}方案是否适合自己的实际需求？`,
    `在${scenarios[0]}场景下，不同${category}方案应该比较哪些方面？`,
    `${scenarios[1] || scenarios[0]}时，常见方案之间有什么关键差异？`,
    `选择${category}时，有哪些适用限制或风险需要提前了解？`,
    `如果更看重可信依据，应该怎样比较不同${category}选择？`,
    `${directName}主要面向哪些用户和使用场景？`,
    `${directName}能解决什么问题，有哪些适用限制？`,
    `${directName}与常见替代方案相比有什么差异？`,
    `判断${directName}是否值得选择，可以核实哪些公开信息？`,
  ];
  const seen = new Set(input.existingQuestions.map(normalizeQuestionText));
  return texts.flatMap((text, index) => {
    const normalized = normalizeQuestionText(text);
    if (seen.has(normalized)) return [];
    seen.add(normalized);
    const persona = input.personas[index % input.personas.length];
    return [{
      id: createId("candidate"),
      runId: input.runId,
      text,
      persona: persona.name,
      decisionScenario: persona.decisionScenario,
      createdAt: input.now,
    }];
  });
}

export function normalizeQuestionText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\p{P}\p{S}\s]+/gu, "");
}
