import { expect, test } from "@playwright/test";
import {
  preflightQuestionSimulation,
  questionCapacityShortfall,
  validateReviewedCandidates,
} from "../src/lib/question-simulator";
import { buildLocalCognitionRun } from "../src/lib/cognition";
import { createSeedData } from "../src/lib/seed";

test("模拟器必须使用已确认且属于当前对象的认知基准", () => {
  const brand = createSeedData().brands[0];
  const draft = buildLocalCognitionRun(brand);
  const missing = preflightQuestionSimulation({
    brand,
    cognitionRun: draft,
    target: { subjectType: "brand", subjectId: brand.id },
  });
  expect(missing.ready).toBe(false);
  expect(missing.issues.map((item) => item.path)).toContain("cognition");

  const confirmed = {
    ...draft,
    status: "confirmed" as const,
    insights: draft.insights.map((item) => ({ ...item, status: "confirmed" as const, isCurrent: true, version: 1 })),
  };
  const ready = preflightQuestionSimulation({
    brand,
    cognitionRun: confirmed,
    target: { subjectType: "product", subjectId: brand.products[0].id },
  });
  expect(ready.ready).toBe(true);
});

test("审核后的重复问题不做硬性拦截，但仍校验最小字段", () => {
  const reviewed = validateReviewedCandidates([
    { id: "one", text: "这个产品适合哪些人？", persona: "首次了解者", decisionScenario: "了解适用人群" },
    { id: "two", text: "这个产品适合哪些人？", persona: "首次了解者", decisionScenario: "了解适用人群" },
  ]);
  expect(reviewed).toHaveLength(2);
  expect(() => validateReviewedCandidates([
    { id: "invalid", text: "问", persona: "", decisionScenario: "" },
  ])).toThrow("问题需为4—300个字符");
});

test("问题库容量按品牌工作空间的启用和停用问题共同计算", () => {
  expect(questionCapacityShortfall(239, 1)).toBe(0);
  expect(questionCapacityShortfall(239, 3)).toBe(2);
  expect(questionCapacityShortfall(240, 1)).toBe(1);
});
