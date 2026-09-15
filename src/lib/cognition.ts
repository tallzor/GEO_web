import type {
  Brand,
  CognitionInputSnapshot,
  CognitionInsight,
  CognitionInsightItem,
  CognitionProductInput,
  CognitionRun,
  CognitionSupportStatus,
  Competitor,
} from "@/lib/types";
import { createId, isoNow } from "@/lib/utils";

export type CognitionPreflightIssue = {
  step: 1 | 2 | 3;
  path: string;
  message: string;
};

export type CognitionPreflightInput = {
  brand: Partial<CognitionInputSnapshot["brand"]>;
  products: Array<Partial<CognitionProductInput>>;
  competitors?: Array<Partial<Competitor>>;
};

const brandElements = [
  ["category_positioning", "类别与定位"],
  ["audience_scenarios", "核心受众与场景"],
  ["value_promise", "品牌价值承诺"],
  ["trust_basis", "品牌信任基础"],
  ["traits_identity", "品牌特质与识别"],
  ["cognition_boundary", "认知边界"],
] as const;

const productDimensions = [
  ["feature", "Feature｜特点"],
  ["advantage", "Advantage｜优势"],
  ["benefit", "Benefit｜利益"],
  ["evidence", "Evidence｜证据"],
  ["weakness", "Weakness｜限制"],
  ["worth", "Worth｜价值"],
] as const;

export const cognitionSupportLabels: Record<CognitionSupportStatus, string> = {
  supported: "依据充分",
  partially_supported: "部分支持",
  insufficient: "信息不足",
  conflicting: "存在冲突",
};

export function buildCognitionInput(brand: Brand): CognitionInputSnapshot {
  return {
    brand: {
      id: brand.id,
      name: brand.name,
      shortName: brand.shortName,
      characteristics: brand.characteristics,
      categoryName: brand.categoryName,
      trustProof: brand.trustProof,
      positioningStatement: brand.positioningStatement,
      industry: brand.industry,
      industryCode: brand.industryCode,
      industryPath: brand.industryPath,
      industryStandard: brand.industryStandard,
      website: brand.website,
      intro: brand.intro,
      serviceArea: brand.serviceArea,
      targetAudience: brand.targetAudience,
      coreScenarios: brand.coreScenarios,
      valuePromise: brand.valuePromise,
      cognitionBoundary: brand.cognitionBoundary,
      otherInfo: brand.otherInfo,
    },
    products: brand.products.map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      description: item.description,
      features: item.features,
      audience: item.audience,
      scenarios: item.scenarios,
      advantages: item.advantages,
      problemsSolved: item.problemsSolved,
      quantitativeFacts: item.quantitativeFacts,
      evidence: item.evidence,
      limitations: item.limitations,
      otherInfo: item.otherInfo,
    })),
    competitors: brand.competitors.map((item) => ({ ...item })),
  };
}

export function cognitionInputChanged(current: CognitionInputSnapshot, previous: CognitionInputSnapshot) {
  return JSON.stringify(stableValue(current)) !== JSON.stringify(stableValue(previous));
}

/** 前端和服务端共用的唯一认知分析门槛；不进行 AI 主观评分。 */
export function preflightCognition(input: CognitionPreflightInput) {
  const issues: CognitionPreflightIssue[] = [];
  const brand = input.brand;
  if (!clean(brand.name)) issues.push(issue(1, "brand.name", "请填写品牌名称"));
  if (!clean(brand.industryCode) || !clean(brand.industry)) {
    issues.push(issue(1, "brand.industryCode", "请选择标准行业"));
  }
  if (!clean(brand.intro)) {
    issues.push(issue(1, "brand.intro", "请填写能够说明品牌是什么、主要提供什么的品牌简介"));
  }
  if (!input.products.length) {
    issues.push(issue(2, "products", "请至少添加一个产品或服务"));
  }

  const names = new Map<string, number>();
  input.products.forEach((product, index) => {
    const prefix = `products.${index}`;
    const name = clean(product.name);
    if (!name) issues.push(issue(2, `${prefix}.name`, `请填写产品 ${index + 1} 的名称`));
    if (!clean(product.type)) issues.push(issue(2, `${prefix}.type`, `请选择产品 ${index + 1} 的类型`));
    if (!clean(product.description)) {
      issues.push(issue(2, `${prefix}.description`, `请填写产品 ${index + 1} 的简介`));
    }
    if (![product.features, product.advantages, product.scenarios, product.problemsSolved].some(clean)) {
      issues.push(issue(2, `${prefix}.base`, `产品 ${index + 1} 至少填写核心特点、优势、应用场景或可解决问题中的一项`));
    }
    if (name) names.set(name.toLocaleLowerCase("zh-CN"), (names.get(name.toLocaleLowerCase("zh-CN")) || 0) + 1);
  });
  input.products.forEach((product, index) => {
    const normalized = clean(product.name).toLocaleLowerCase("zh-CN");
    if (normalized && (names.get(normalized) || 0) > 1) {
      issues.push(issue(2, `products.${index}.name`, `产品名称“${clean(product.name)}”重复`));
    }
  });

  if (brand.website && !validHttpUrl(brand.website)) {
    issues.push(issue(1, "brand.website", "官方网站必须是有效的 HTTP 或 HTTPS 地址"));
  }
  (input.competitors || []).forEach((competitor, index) => {
    if (!clean(competitor.name) && clean(competitor.description)) {
      issues.push(issue(3, `competitors.${index}.name`, `请填写竞品 ${index + 1} 的名称`));
    }
  });
  return { ready: issues.length === 0, issues };
}

export function buildLocalCognitionRun(brand: Brand, existingId?: string): CognitionRun {
  const inputSnapshot = buildCognitionInput(brand);
  const checked = preflightCognition(inputSnapshot);
  if (!checked.ready) throw new CognitionPreflightError(checked.issues);
  const now = isoNow();
  const runId = existingId || createId("cognition");
  const brandInsight = localBrandInsight(runId, inputSnapshot, now);
  const productInsights = inputSnapshot.products.map((product) => localProductInsight(runId, brand, product, now));
  return {
    id: runId,
    brandId: brand.id,
    brandName: brand.name,
    status: "review_required",
    attempt: 1,
    inputSnapshot,
    insights: [brandInsight, ...productInsights],
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: now,
  };
}

export class CognitionPreflightError extends Error {
  constructor(readonly issues: CognitionPreflightIssue[]) {
    super(issues[0]?.message || "品牌与产品信息未通过分析前预检");
    this.name = "CognitionPreflightError";
  }
}

function localBrandInsight(runId: string, input: CognitionInputSnapshot, now: string): CognitionInsight {
  const brand = input.brand;
  const values: Record<string, [string, string[]]> = {
    category_positioning: [joinText(brand.categoryName || brand.industry, brand.positioningStatement), filledFields([brand.categoryName ? [brand.categoryName, "categoryName"] : [brand.industry, "industry"], [brand.positioningStatement, "positioningStatement"]])],
    audience_scenarios: [joinText(brand.targetAudience, brand.coreScenarios), filledFields([[brand.targetAudience, "targetAudience"], [brand.coreScenarios, "coreScenarios"]])],
    value_promise: [brand.valuePromise, filledFields([[brand.valuePromise, "valuePromise"]])],
    trust_basis: [brand.trustProof, filledFields([[brand.trustProof, "trustProof"]])],
    traits_identity: [joinText(brand.shortName, brand.characteristics), filledFields([[brand.shortName, "shortName"], [brand.characteristics, "characteristics"]])],
    cognition_boundary: [brand.cognitionBoundary, filledFields([[brand.cognitionBoundary, "cognitionBoundary"]])],
  };
  return localInsight({ runId, brandId: brand.id, subjectId: brand.id, subjectName: brand.name, subjectType: "brand", modelType: "brand_six_elements", dimensions: brandElements, values, now });
}

function localProductInsight(runId: string, brand: Brand, product: CognitionProductInput, now: string): CognitionInsight {
  const values: Record<string, [string, string[]]> = {
    feature: [product.features, filledFields([[product.features, "features"]])],
    advantage: [product.advantages ? `待验证主张：${product.advantages}` : "", filledFields([[product.advantages, "advantages"]])],
    benefit: [joinText(product.problemsSolved, product.scenarios, product.audience), filledFields([[product.problemsSolved, "problemsSolved"], [product.scenarios, "scenarios"], [product.audience, "audience"]])],
    evidence: [joinText(product.evidence, product.quantitativeFacts), filledFields([[product.evidence, "evidence"], [product.quantitativeFacts, "quantitativeFacts"]])],
    weakness: [product.limitations, filledFields([[product.limitations, "limitations"]])],
    worth: [joinText(product.otherInfo, brand.valuePromise), filledFields([[product.otherInfo, "otherInfo"], [brand.valuePromise, "brand.valuePromise"]])],
  };
  return localInsight({ runId, brandId: brand.id, subjectId: product.id, subjectName: product.name, subjectType: "product", modelType: "bfabeww", dimensions: productDimensions, values, now });
}

function localInsight(input: {
  runId: string;
  brandId: string;
  subjectId: string;
  subjectName: string;
  subjectType: CognitionInsight["subjectType"];
  modelType: CognitionInsight["modelType"];
  dimensions: ReadonlyArray<readonly [string, string]>;
  values: Record<string, [string, string[]]>;
  now: string;
}): CognitionInsight {
  const items: CognitionInsightItem[] = input.dimensions.map(([key, label]) => {
    const [value, inputFields] = input.values[key] || ["", []];
    const unverifiedAdvantage = key === "advantage" && Boolean(clean(value));
    return {
      key,
      label,
      conclusion: clean(value) || "信息不足",
      supportStatus: clean(value) && !unverifiedAdvantage ? "partially_supported" : "insufficient",
      inputFields: clean(value) ? inputFields : [],
      webReferences: [],
      missingOrConflict: unverifiedAdvantage
        ? "客户填写的优势是待验证主张，不能直接确认为产品优势。"
        : clean(value) ? "本地演示结果仅整理用户输入，需由正式底座模型进一步分析。" : `缺少${label}相关事实。`,
    };
  });
  return {
    id: createId("insight"),
    runId: input.runId,
    brandId: input.brandId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    subjectName: input.subjectName,
    modelType: input.modelType,
    items,
    status: "draft",
    version: 0,
    isCurrent: false,
    provider: "local_demo",
    model: "structured-input-preview",
    promptVersion: "local-preview-v1",
    webSearchUsed: false,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function issue(step: 1 | 2 | 3, path: string, message: string): CognitionPreflightIssue {
  return { step, path, message };
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function joinText(...values: Array<string | undefined>) {
  return values.map(clean).filter(Boolean).join("；");
}

function filledFields(values: Array<[string | undefined, string]>) {
  return values.flatMap(([value, field]) => clean(value) ? [field] : []);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stableValue(item)]));
}
