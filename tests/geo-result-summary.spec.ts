import { expect, test } from "@playwright/test";
import { buildGeoDetectionSummary } from "../src/lib/geo-result-summary";
import type { DetectionResult } from "../src/lib/types";

function result(input: Partial<DetectionResult> & Pick<DetectionResult, "id" | "answer">): DetectionResult {
  return {
    provider: "doubao",
    questionId: `question-${input.id}`,
    brandMentioned: false,
    recommended: false,
    recommendationPosition: "未出现",
    competitorMentions: [],
    accuracy: "待确认",
    citations: [],
    ...input,
  };
}

test("GEO汇总使用固定分母并只统计相关回答的独立引用", () => {
  const summary = buildGeoDetectionSummary({
    subjectName: "轻盈饮品",
    requestedCount: 4,
    failedCount: 1,
    results: [
      result({
        id: "1",
        answer: "轻盈饮品可以作为首选。",
        brandMentioned: true,
        targetMentioned: true,
        directQuestion: false,
        mentionCount: 1,
        presentationRole: "top_recommendation",
        riskSignal: "none_detected",
        citations: [{
          id: "citation-1", title: "行业资料", url: "https://association.example/a", type: "网页",
          excerpt: "", relevance: "中", credibility: "中", normalizedUrl: "https://association.example/a",
          sourceCategory: "industry_association",
        }],
      }),
      result({
        id: "2",
        answer: "轻盈饮品适用，但需要注意使用限制。",
        brandMentioned: true,
        targetMentioned: true,
        directQuestion: true,
        mentionCount: 2,
        presentationRole: "alternative",
        riskSignal: "cautious_description",
        citations: [{
          id: "citation-2", title: "重复来源", url: "https://association.example/a", type: "网页",
          excerpt: "", relevance: "中", credibility: "中", normalizedUrl: "https://association.example/a",
          sourceCategory: "industry_association",
        }],
      }),
      result({
        id: "3",
        answer: "可以考虑其他方案。",
        directQuestion: false,
        presentationRole: "not_mentioned",
        citations: [{
          id: "citation-3", title: "无关来源", url: "https://other.example/a", type: "网页",
          excerpt: "", relevance: "中", credibility: "中", normalizedUrl: "https://other.example/a",
          sourceCategory: "other",
        }],
      }),
    ],
  });

  expect(summary).toMatchObject({
    requestedCount: 4,
    validCount: 3,
    failedCount: 1,
    mentionedAnswerCount: 2,
    unmentionedAnswerCount: 1,
    totalMentionCount: 3,
    naturalEligibleCount: 2,
    naturalMentionedCount: 1,
    uniqueCitationCount: 1,
  });
  expect(summary.presentationRoleCounts).toMatchObject({ top_recommendation: 1, alternative: 1, not_mentioned: 1 });
  expect(summary.riskSignalCounts).toMatchObject({ none_detected: 1, cautious_description: 1 });
  expect(summary.sourceCategoryCounts.industry_association).toBe(1);
  expect(summary.sourceCategoryCounts.other).toBe(0);
  expect(summary.findings).toHaveLength(3);
});
