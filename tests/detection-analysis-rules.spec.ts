import { expect, test } from "@playwright/test";
import {
  calculateSentiment,
  dedupeNames,
  findExactNameMentions,
  recommendationWeight,
} from "../src/lib/server/detection-analysis-rules";

test.describe("检测分析规则", () => {
  test("仅提及计入推荐但权重最低", () => {
    expect(recommendationWeight("top_pick")).toBe(1);
    expect(recommendationWeight("recommended")).toBe(0.8);
    expect(recommendationWeight("conditional")).toBe(0.6);
    expect(recommendationWeight("mentioned_only")).toBe(0.2);
    expect(recommendationWeight("discouraged")).toBe(0);
  });

  test("品牌全称和简称按原文精确匹配且不重复计数", () => {
    const matches = findExactNameMentions(
      "跃动健身适合新手，跃动还提供体验课。跃劢不是配置名称。",
      ["跃动健身", "跃动"],
    );
    expect(matches.map((item) => item.name)).toEqual(["跃动健身", "跃动"]);
  });

  test("没有评价时情感为空", () => {
    expect(calculateSentiment(0, 0)).toEqual({
      positiveEvaluationCount: 0,
      negativeEvaluationCount: 0,
    });
  });

  test("情感按评价数量和相近度计算", () => {
    expect(calculateSentiment(3, 2)).toMatchObject({ label: "积极", score: 60 });
    expect(calculateSentiment(2, 3)).toMatchObject({ label: "需改善", score: 40 });
    expect(calculateSentiment(100, 99)).toMatchObject({ label: "中性", score: 50 });
    expect(calculateSentiment(1, 0)).toMatchObject({ label: "积极", score: 99 });
  });

  test("品牌列表忽略大小写与空格后去重并限制数量", () => {
    expect(dedupeNames(["Alpha", " alpha ", "A l p h a", "Beta"], 2)).toEqual([
      "Alpha",
      "Beta",
    ]);
  });
});
