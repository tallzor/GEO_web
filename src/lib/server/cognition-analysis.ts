import "server-only";

import { z } from "zod";
import { executeFoundationTask } from "@/lib/server/foundation-model";
import type {
  CognitionInputSnapshot,
  CognitionInsightItem,
  CognitionProductInput,
  CognitionReference,
} from "@/lib/types";

export const BRAND_COGNITION_PROMPT_VERSION = "brand-six-elements-v1";
export const PRODUCT_COGNITION_PROMPT_VERSION = "bfabeww-v1";

const supportStatusSchema = z.enum([
  "supported",
  "partially_supported",
  "insufficient",
  "conflicting",
]);

const rawItemSchema = z.object({
  key: z.string().min(1),
  conclusion: z.string().min(1).max(2_000),
  supportStatus: supportStatusSchema,
  inputFields: z.array(z.string().min(1).max(80)).max(20).default([]),
  referenceUrls: z.array(z.url()).max(10).default([]),
  missingOrConflict: z.string().max(1_000).default(""),
});

const brandKeys = [
  ["category_positioning", "类别与定位"],
  ["audience_scenarios", "核心受众与场景"],
  ["value_promise", "品牌价值承诺"],
  ["trust_basis", "品牌信任基础"],
  ["traits_identity", "品牌特质与识别"],
  ["cognition_boundary", "认知边界"],
] as const;

const productKeys = [
  ["feature", "Feature｜特点"],
  ["advantage", "Advantage｜优势"],
  ["benefit", "Benefit｜利益"],
  ["evidence", "Evidence｜证据"],
  ["weakness", "Weakness｜限制"],
  ["worth", "Worth｜价值"],
] as const;

const brandFieldNames = new Set([
  "name", "shortName", "characteristics", "categoryName", "trustProof",
  "positioningStatement", "industry", "industryCode", "industryPath",
  "industryStandard", "website", "intro", "serviceArea", "targetAudience",
  "coreScenarios", "valuePromise", "cognitionBoundary", "otherInfo",
]);

const productFieldNames = new Set([
  "name", "type", "description", "features", "audience", "scenarios",
  "advantages", "problemsSolved", "quantitativeFacts", "evidence",
  "limitations", "otherInfo", "brand.name", "brand.industry",
  "brand.positioningStatement", "brand.valuePromise", "brand.trustProof",
  "brand.characteristics", "brand.cognitionBoundary", "competitors",
]);

const brandDimensionFields: Record<string, Set<string>> = {
  category_positioning: new Set(["categoryName", "industry", "industryCode", "industryPath", "positioningStatement", "intro"]),
  audience_scenarios: new Set(["targetAudience", "coreScenarios", "intro", "serviceArea"]),
  value_promise: new Set(["valuePromise", "positioningStatement", "intro"]),
  trust_basis: new Set(["trustProof"]),
  traits_identity: new Set(["shortName", "characteristics"]),
  cognition_boundary: new Set(["cognitionBoundary", "otherInfo"]),
};

const productDimensionFields: Record<string, Set<string>> = {
  feature: new Set(["description", "features", "otherInfo"]),
  advantage: new Set(["advantages", "features", "evidence", "quantitativeFacts", "competitors"]),
  benefit: new Set(["problemsSolved", "scenarios", "audience", "description"]),
  evidence: new Set(["evidence", "quantitativeFacts"]),
  weakness: new Set(["limitations"]),
  worth: new Set(["problemsSolved", "scenarios", "audience", "advantages", "brand.valuePromise"]),
};

export type CognitionAnalysisResult = {
  items: CognitionInsightItem[];
  provider: string;
  model: string;
  promptVersion: string;
  webSearchUsed: boolean;
};

export async function analyzeBrandCognition(
  snapshot: CognitionInputSnapshot,
): Promise<CognitionAnalysisResult> {
  const result = await executeFoundationTask({
    taskType: "brand_cognition",
    promptVersion: BRAND_COGNITION_PROMPT_VERSION,
    prompt: buildBrandPrompt(snapshot),
    schema: z.object({ items: z.array(rawItemSchema).length(6) }),
    enableWebSearch: cognitionWebSearchEnabled(),
  });
  return {
    items: normalizeItems(
      result.data.items,
      brandKeys,
      populatedFields(snapshot.brand, brandFieldNames),
      brandDimensionFields,
      result.sources,
    ),
    provider: result.provider,
    model: result.model,
    promptVersion: result.promptVersion,
    webSearchUsed: result.webSearchUsed,
  };
}

export async function analyzeProductCognition(
  snapshot: CognitionInputSnapshot,
  product: CognitionProductInput,
): Promise<CognitionAnalysisResult> {
  const result = await executeFoundationTask({
    taskType: "product_cognition",
    promptVersion: PRODUCT_COGNITION_PROMPT_VERSION,
    prompt: buildProductPrompt(snapshot, product),
    schema: z.object({ items: z.array(rawItemSchema).length(6) }),
    enableWebSearch: cognitionWebSearchEnabled(),
  });
  const populated = populatedProductFields(snapshot, product);
  const items = normalizeItems(
    result.data.items,
    productKeys,
    populated,
    productDimensionFields,
    result.sources,
  );
  const advantage = items.find((item) => item.key === "advantage");
  const advantageCorroborated = Boolean(
    product.evidence.trim()
    || product.quantitativeFacts.trim()
    || snapshot.competitors.length
    || advantage?.webReferences.length,
  );
  if (advantage && !advantageCorroborated) {
    advantage.conclusion = product.advantages.trim()
      ? `待验证主张：${product.advantages.trim()}`
      : "信息不足";
    advantage.supportStatus = "insufficient";
    advantage.missingOrConflict = "缺少证据、定量信息或比较依据，不能将客户填写的优势直接确认为产品优势。";
  }
  return {
    items,
    provider: result.provider,
    model: result.model,
    promptVersion: result.promptVersion,
    webSearchUsed: result.webSearchUsed,
  };
}

function buildBrandPrompt(snapshot: CognitionInputSnapshot) {
  return [
    "任务：仅根据客户填写的品牌事实，形成品牌认知六要素洞察。",
    "硬性规则：",
    "1. 不得使用产品、服务或竞品信息；这些信息没有提供给你。",
    "2. 不得补写客户未提供的品牌事实。联网信息只能作为分析背景，不能表述为客户已确认事实。",
    "3. 没有足够依据时 conclusion 必须写“信息不足”，supportStatus 写 insufficient。",
    "4. 有冲突时不得自行选择，supportStatus 写 conflicting，并在 missingOrConflict 说明。",
    "5. inputFields 只能填写实际使用的输入字段名；referenceUrls 只能填写本次联网结果中的 URL。",
    "6. 必须输出以下六个且各一次：category_positioning、audience_scenarios、value_promise、trust_basis、traits_identity、cognition_boundary。",
    "只输出合法 JSON：{\"items\":[{\"key\":\"...\",\"conclusion\":\"...\",\"supportStatus\":\"supported|partially_supported|insufficient|conflicting\",\"inputFields\":[],\"referenceUrls\":[],\"missingOrConflict\":\"\"}]}。",
    "客户填写的品牌事实：",
    JSON.stringify(snapshot.brand),
  ].join("\n");
}

function buildProductPrompt(snapshot: CognitionInputSnapshot, product: CognitionProductInput) {
  const brand = snapshot.brand;
  const inheritedBrandFacts = {
    name: brand.name,
    industry: brand.industry,
    positioningStatement: brand.positioningStatement,
    valuePromise: brand.valuePromise,
    trustProof: brand.trustProof,
    characteristics: brand.characteristics,
    cognitionBoundary: brand.cognitionBoundary,
  };
  return [
    "任务：分析一个产品或服务的 BFABEWW。Base 已通过预检，不输出 Base 结论。",
    "硬性规则：",
    "1. 只能使用当前产品输入、列出的可继承品牌事实和竞品比较背景，不得使用兄弟产品。",
    "2. 客户填写的 advantages 是待验证主张，必须结合特点、证据和比较依据判断，不能原样确认为 Advantage。",
    "3. 联网信息只能作为带来源的比较或背景参考，不能改写事实字段。",
    "4. 没有足够依据时 conclusion 必须写“信息不足”，supportStatus 写 insufficient；有冲突时写 conflicting。",
    "5. inputFields 只能填写实际使用的字段名；referenceUrls 只能填写本次联网结果中的 URL。",
    "6. 必须输出以下六个且各一次：feature、advantage、benefit、evidence、weakness、worth。",
    "只输出合法 JSON：{\"items\":[{\"key\":\"...\",\"conclusion\":\"...\",\"supportStatus\":\"supported|partially_supported|insufficient|conflicting\",\"inputFields\":[],\"referenceUrls\":[],\"missingOrConflict\":\"\"}]}。",
    "当前产品输入：",
    JSON.stringify(product),
    "可继承品牌事实：",
    JSON.stringify(inheritedBrandFacts),
    "竞品比较背景（选填，不是品牌事实）：",
    JSON.stringify(snapshot.competitors),
  ].join("\n");
}

function normalizeItems(
  rawItems: z.infer<typeof rawItemSchema>[],
  dimensions: ReadonlyArray<readonly [string, string]>,
  populatedFieldNames: Set<string>,
  dimensionFields: Record<string, Set<string>>,
  sources: CognitionReference[],
) {
  const sourceByUrl = new Map(sources.map((source) => [source.url, source]));
  const itemByKey = new Map(rawItems.map((item) => [item.key, item]));
  if (itemByKey.size !== dimensions.length || dimensions.some(([key]) => !itemByKey.has(key))) {
    throw new Error("底座模型没有返回完整且唯一的认知维度");
  }
  return dimensions.map(([key, label]): CognitionInsightItem => {
    const item = itemByKey.get(key)!;
    const relevantFields = dimensionFields[key] || new Set<string>();
    const inputFields = [...new Set(item.inputFields.filter((field) => populatedFieldNames.has(field) && relevantFields.has(field)))];
    const webReferences = item.referenceUrls.flatMap((url) => {
      const source = sourceByUrl.get(url);
      return source ? [source] : [];
    });
    if (!inputFields.length) {
      return {
        key,
        label,
        conclusion: "信息不足",
        supportStatus: "insufficient",
        inputFields: [],
        webReferences,
        missingOrConflict: item.missingOrConflict.trim() || `缺少${label}相关的客户事实。`,
      };
    }
    return {
      key,
      label,
      conclusion: item.conclusion.trim(),
      supportStatus: item.supportStatus,
      inputFields,
      webReferences,
      missingOrConflict: item.missingOrConflict.trim(),
    };
  });
}

function populatedFields(record: object, allowed: Set<string>, prefix = "") {
  return new Set(Object.entries(record).flatMap(([key, value]) => {
    const field = prefix ? `${prefix}.${key}` : key;
    return allowed.has(field) && typeof value === "string" && value.trim() ? [field] : [];
  }));
}

function populatedProductFields(snapshot: CognitionInputSnapshot, product: CognitionProductInput) {
  const fields = populatedFields(product, productFieldNames);
  const inherited = {
    valuePromise: snapshot.brand.valuePromise,
  };
  for (const field of populatedFields(inherited, productFieldNames, "brand")) fields.add(field);
  if (snapshot.competitors.some((competitor) => competitor.name.trim() || competitor.description.trim())) fields.add("competitors");
  return fields;
}

function cognitionWebSearchEnabled() {
  return process.env.GEO_COGNITION_WEB_SEARCH?.trim().toLowerCase() === "true";
}
