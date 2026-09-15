import "server-only";

import { z } from "zod";
import {
  normalizeQuestionText,
  QUESTION_QUALITY_RULE_VERSION,
  QUESTION_SIMULATION_PROMPT_VERSION,
} from "@/lib/question-simulator";
import { executeFoundationTask } from "@/lib/server/foundation-model";
import type {
  CognitionInsightItem,
  CognitionReference,
  QuestionPersona,
} from "@/lib/types";

const personaSchema = z.object({
  name: z.string().trim().min(2).max(60),
  audience: z.string().trim().min(2).max(120),
  knowledgeLevel: z.string().trim().min(2).max(80),
  decisionScenario: z.string().trim().min(2).max(160),
  task: z.string().trim().min(2).max(160),
  concern: z.string().trim().min(2).max(160),
  constraints: z.string().trim().min(2).max(160),
  decisionStage: z.string().trim().min(2).max(60),
});

const resultSchema = z.object({
  personas: z.array(personaSchema).min(4).max(8),
  questions: z.array(z.object({
    text: z.string().trim().min(4).max(300),
    persona: z.string().trim().min(2).max(60),
    decisionScenario: z.string().trim().min(2).max(160),
    category: z.enum(["unbranded", "scenario_comparison", "branded_direct"]),
    quality: z.object({
      authenticity: z.number().int().min(1).max(5),
      naturalness: z.number().int().min(1).max(5),
      neutrality: z.number().int().min(1).max(5),
      detectionValue: z.number().int().min(1).max(5),
      distinctiveness: z.number().int().min(1).max(5),
    }),
  })).min(6).max(36),
  coverageGaps: z.array(z.string().trim().min(2).max(160)).max(8).default([]),
});

export type QuestionSimulationInputSnapshot = {
  brandId: string;
  brandName: string;
  subjectType: "brand" | "product";
  subjectId: string;
  subjectName: string;
  audience: string;
  category: string;
  scenarios: string;
  problems: string;
  limitations: string;
  brandFacts: Record<string, string>;
  subjectFacts: Record<string, string>;
  competitors: Array<{ name: string; description: string }>;
  cognition: CognitionInsightItem[];
  existingQuestions: string[];
};

export type QuestionSimulationAnalysis = {
  personas: QuestionPersona[];
  questions: Array<{ text: string; persona: string; decisionScenario: string }>;
  coverageGaps: string[];
  references: CognitionReference[];
  provider: string;
  model: string;
  promptVersion: string;
};

export async function analyzeQuestionSimulation(
  snapshot: QuestionSimulationInputSnapshot,
): Promise<QuestionSimulationAnalysis> {
  const result = await executeFoundationTask({
    taskType: "question_simulation",
    promptVersion: QUESTION_SIMULATION_PROMPT_VERSION,
    prompt: buildPrompt(snapshot),
    schema: resultSchema,
    enableWebSearch: true,
  });
  const personaNames = new Set(result.data.personas.map((item) => item.name));
  const existing = new Set(snapshot.existingQuestions.map(normalizeQuestionText));
  const seen = new Set<string>();
  const accepted = result.data.questions.filter((item) => {
    const normalized = normalizeQuestionText(item.text);
    if (!normalized || seen.has(normalized) || existing.has(normalized)) return false;
    if (!personaNames.has(item.persona)) return false;
    if (item.category === "unbranded" && mentionsTarget(item.text, snapshot)) return false;
    if (item.category === "branded_direct" && !mentionsSubject(item.text, snapshot)) return false;
    const qualityTotal = Object.values(item.quality).reduce((sum, score) => sum + score, 0);
    if (qualityTotal < 16 || item.quality.authenticity < 4 || item.quality.detectionValue < 4) return false;
    seen.add(normalized);
    return true;
  });
  const selected = selectBalancedQuestions(accepted);
  const counts = categoryCounts(accepted);
  const coverageGaps = [...result.data.coverageGaps];
  for (const [category, label] of [
    ["unbranded", "无品牌问题"],
    ["scenario_comparison", "场景与对比问题"],
    ["branded_direct", "品牌直接问题"],
  ] as const) {
    if (counts[category] < 2) coverageGaps.push(`${label}不足2道`);
  }
  if (selected.length < 12) coverageGaps.push(`当前信息只支撑${selected.length}道有效问题，可补充事实或手动添加`);
  return {
    personas: result.data.personas.map((item, index) => ({ id: `persona_${index + 1}`, ...item })),
    questions: selected.map(({ text, persona, decisionScenario }) => ({ text, persona, decisionScenario })),
    coverageGaps: [...new Set(coverageGaps)],
    references: result.sources.map((item) => ({ title: item.title, url: item.url })),
    provider: result.provider,
    model: result.model,
    promptVersion: result.promptVersion,
  };
}

function buildPrompt(snapshot: QuestionSimulationInputSnapshot) {
  return [
    "你是品牌GEO系统中的用户问题模拟器。你的任务是扮演合成用户视角，生成可用于检测AI认知表现的自然问题。",
    "不得宣传目标，不得虚构品牌、产品、价格、效果、资质、案例或用户数据。联网资料只用于理解公开行业语言、常见场景和选择顾虑，不能变成目标事实。",
    "",
    "请在内部依次完成：构造4—6个差异明显的角色、规划三类问题覆盖、生成24—36道草案、按真实性与检测价值筛选。不要输出推理过程和评分。",
    "角色必须是结构化的合成视角，不使用真实姓名、真实企业名称、虚构预算或人口统计细节。",
    "不同角色至少在身份、知识水平、场景、顾虑或决策阶段中的两项存在差异。",
    "",
    "三类问题要求：",
    "1. unbranded：从需求、困难、场景、限制或选择标准开始，严禁出现目标品牌名、产品名或简称。",
    "2. scenario_comparison：包含具体场景、限制、选择标准或比较对象，不预设目标更好；只有自然需要时才出现目标名称。",
    "3. branded_direct：明确出现当前检测对象名称，用于询问适用人群、场景、能力、依据、限制、口碑或对比。",
    "每类最终至少2道，资料充分时各保留4道、共12道。每道问题只表达一个主要意图，能脱离上下文理解，长度4—300字。",
    "问题要像真实用户向AI助手直接提问，不用营销口号，不把事实结论塞进问题，不使用‘一定、最好、保证’等诱导表达。",
    "避免语义重复；还要避开 existingQuestions 中意图相同的问题。为每道草案从真实性、自然度、中立性、检测价值、差异性五项各评1—5分；只有总分至少16且真实性、检测价值均至少4分的问题可以输出。评分仅供系统筛选。",
    "persona 必须精确引用 personas 中的 name，decisionScenario 必须是该角色会自然遇到的具体情境。",
    "",
    "只返回合法JSON，不要输出Markdown或解释。",
    `质量规则版本：${QUESTION_QUALITY_RULE_VERSION}`,
    '结构：{"personas":[{"name":"角色名","audience":"所属用户","knowledgeLevel":"了解程度","decisionScenario":"决策场景","task":"当前任务","concern":"主要顾虑","constraints":"限制条件","decisionStage":"决策阶段"}],"questions":[{"text":"问题","persona":"角色名","decisionScenario":"决策场景","category":"unbranded|scenario_comparison|branded_direct","quality":{"authenticity":5,"naturalness":5,"neutrality":5,"detectionValue":5,"distinctiveness":5}}],"coverageGaps":[]}',
    "",
    "本批次允许使用的固定输入：",
    JSON.stringify(snapshot),
  ].join("\n");
}

function selectBalancedQuestions(items: z.infer<typeof resultSchema>["questions"]) {
  const categories = ["unbranded", "scenario_comparison", "branded_direct"] as const;
  const selected = categories.flatMap((category) => items.filter((item) => item.category === category).slice(0, 4));
  if (selected.length >= 12) return selected.slice(0, 12);
  const selectedTexts = new Set(selected.map((item) => item.text));
  return [...selected, ...items.filter((item) => !selectedTexts.has(item.text))].slice(0, 12);
}

function categoryCounts(items: z.infer<typeof resultSchema>["questions"]) {
  return {
    unbranded: items.filter((item) => item.category === "unbranded").length,
    scenario_comparison: items.filter((item) => item.category === "scenario_comparison").length,
    branded_direct: items.filter((item) => item.category === "branded_direct").length,
  };
}

function mentionsTarget(text: string, snapshot: QuestionSimulationInputSnapshot) {
  const names = [snapshot.subjectName, snapshot.brandName]
    .map((item) => normalizeQuestionText(item)).filter((item) => item.length >= 2);
  const normalized = normalizeQuestionText(text);
  return names.some((name) => normalized.includes(name));
}

function mentionsSubject(text: string, snapshot: QuestionSimulationInputSnapshot) {
  const normalizedName = normalizeQuestionText(snapshot.subjectName);
  return normalizedName.length >= 2 && normalizeQuestionText(text).includes(normalizedName);
}
