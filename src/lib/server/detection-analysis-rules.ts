import type { RecommendationType, SentimentLabel } from "@/lib/types";

export const recommendationWeights: Record<RecommendationType, number> = {
  top_pick: 1,
  recommended: 0.8,
  conditional: 0.6,
  mentioned_only: 0.2,
  discouraged: 0,
  not_mentioned: 0,
};

export function recommendationWeight(type: RecommendationType) {
  return recommendationWeights[type];
}

export function findExactNameMentions(text: string, names: string[]) {
  const targets = [...new Set(names.map((name) => name.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  const occupied: Array<{ start: number; end: number }> = [];
  const matches: Array<{ name: string; index: number }> = [];

  for (const name of targets) {
    let offset = 0;
    while (offset < text.length) {
      const index = text.indexOf(name, offset);
      if (index < 0) break;
      const end = index + name.length;
      if (!occupied.some((range) => index < range.end && end > range.start)) {
        occupied.push({ start: index, end });
        matches.push({ name, index });
      }
      offset = end;
    }
  }

  return matches.sort((a, b) => a.index - b.index);
}

export function calculateSentiment(
  positiveEvaluationCount: number,
  negativeEvaluationCount: number,
): {
  label?: SentimentLabel;
  score?: number;
  positiveEvaluationCount: number;
  negativeEvaluationCount: number;
} {
  const positive = Math.max(0, Math.floor(positiveEvaluationCount));
  const negative = Math.max(0, Math.floor(negativeEvaluationCount));
  const total = positive + negative;
  if (!total) {
    return {
      positiveEvaluationCount: 0,
      negativeEvaluationCount: 0,
    };
  }

  const score = Math.min(99, Math.round(positive / total * 100));
  const larger = Math.max(positive, negative);
  const smaller = Math.min(positive, negative);
  const similarRatio = larger ? smaller / larger : 0;
  const positiveShare = positive / total;
  const negativeShare = negative / total;
  const label: SentimentLabel = similarRatio > 0.97
    ? "中性"
    : positiveShare > 0.59
      ? "积极"
      : negativeShare > 0.5
        ? "需改善"
        : "中性";

  return {
    label,
    score,
    positiveEvaluationCount: positive,
    negativeEvaluationCount: negative,
  };
}

export function dedupeNames(names: string[], limit: number) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const value = name.trim();
    const key = normalizeName(value);
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

export function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, "");
}
