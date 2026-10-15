import type {
  Brand,
  Detection,
  DetectionResult,
  ProviderId,
  RankedBrandMention,
} from "@/lib/types";
import { providerNames } from "@/lib/types";

export type PlatformMetric = {
  provider: ProviderId;
  name: string;
  answers: number;
  brandOccurrences: number;
  mentionedAnswers: number;
  recommendations: number;
};

export type RankingMetric = {
  name: string;
  appearances: number;
  mentionRate: number;
  firstPlaceRate: number;
  top3Rate: number;
  averageRank?: number;
  configuredCompetitor: boolean;
  evidences: EvidenceReference[];
};

export type CompetitorMetric = RankingMetric & {
  cooccurrences: number;
};

export type EvidenceReference = {
  resultId: string;
  provider: ProviderId;
  question: string;
  answer: string;
  evidence: string;
};

export type AnalysisDimensionScores = {
  visibility: number;
  ranking: number;
  reputation: number;
  sentiment: number;
};

export type DetectionAnalysisSummary = {
  scores: AnalysisDimensionScores;
  display: Record<keyof AnalysisDimensionScores, string>;
  availability: Record<keyof AnalysisDimensionScores, boolean>;
};

export function completedDetectionsForBrand(detections: Detection[], brandId: string) {
  return detections
    .filter((item) =>
      item.brandId === brandId
      && item.status === "completed"
      && item.results.length > 0
      && isVerifiedLiveAnalysis(item),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function isVerifiedLiveAnalysis(detection: Detection) {
  if (detection.dataSource !== "live_api" || (!detection.resultSummary && !detection.diagnosis) || !detection.analysisModel) return false;
  if (isTestModel(detection.analysisModel)) return false;
  return detection.results.every((result) =>
    result.dataSource === "live_api"
    && !isTestModel(result.model)
    && !isTestModel(result.analysisModel)
    && !result.requestId?.startsWith("mock-"),
  );
}

export function detectionSummary(detection: Detection, brand: Brand) {
  const results = detection.results;
  const brandOccurrences = results.reduce(
    (sum, item) => sum + (item.mentionCount ?? countOccurrences(item.answer, brand.name)),
    0,
  );
  const firstPlaceAppearances = results.filter((item) => ownBrandRank(item, brand) === 1).length;
  const recommendations = results.filter((item) => item.recommended).length;
  const competitorMentions = results.reduce(
    (sum, item) => sum + readRankedBrands(item, brand)
      .filter((entry) => normalize(entry.name) !== normalize(brand.name))
      .length,
    0,
  );
  const mentioned = results.filter((item) => item.brandMentioned).length;
  const rankedResults = results.flatMap((item) => {
    const rank = ownBrandRank(item, brand);
    return rank ? [rank] : [];
  });

  return {
    answers: results.length,
    failed: detection.failedRuns,
    brandOccurrences,
    rankedAppearances: rankedResults.length,
    firstPlaceAppearances,
    recommendations,
    competitorMentions,
    mentionRate: percentage(mentioned, results.length),
    firstPlaceRate: percentage(firstPlaceAppearances, results.length),
    top3Rate: percentage(rankedResults.filter((rank) => rank <= 3).length, results.length),
    averageRank: rankedResults.length
      ? Number((rankedResults.reduce((sum, rank) => sum + rank, 0) / rankedResults.length).toFixed(1))
      : undefined,
    notMentionedRate: percentage(results.length - mentioned, results.length),
  };
}

export function detectionAnalysisSummary(
  detection: Detection,
  brand: Brand,
): DetectionAnalysisSummary {
  const summary = detectionSummary(detection, brand);
  const storedScores = detection.diagnosis?.scores;
  const hasAlignedScores = Boolean(
    storedScores
    && Number.isFinite(storedScores.visibility)
    && Number.isFinite(storedScores.ranking)
    && Number.isFinite(storedScores.reputation)
    && Number.isFinite(storedScores.sentiment),
  );
  const topics = detection.results.flatMap((item) => item.reputationTopics || []);
  const reputation = hasAlignedScores
    ? storedScores!.reputation
    : topics.length
      ? percentage(topics.filter((item) => item.sentimentLabel === "积极").length, topics.length)
      : 0;
  const sentimentValues = detection.results.map((item) => item.sentimentScore
    ?? (item.sentimentLabel === "积极" ? 80 : item.sentimentLabel === "需改善" ? 20 : 50));
  const sentiment = hasAlignedScores
    ? storedScores!.sentiment
    : sentimentValues.length
      ? Math.round(sentimentValues.reduce((sum, value) => sum + value, 0) / sentimentValues.length)
      : 50;
  const rankingAvailable = summary.averageRank !== undefined;
  const ranking = hasAlignedScores ? storedScores!.ranking : Math.round(
    summary.rankedAppearances / Math.max(detection.results.length, 1) * 40
    + summary.top3Rate * 0.4
    + summary.firstPlaceRate * 0.2,
  );
  const visibility = hasAlignedScores ? storedScores!.visibility : summary.mentionRate;

  return {
    scores: {
      visibility,
      ranking,
      reputation,
      sentiment,
    },
    display: {
      visibility: `${visibility}%`,
      ranking: rankingAvailable ? `第 ${summary.averageRank}` : "—",
      reputation: `${reputation}%`,
      sentiment: `${sentiment}`,
    },
    availability: {
      visibility: detection.results.length > 0,
      ranking: hasAlignedScores || rankingAvailable,
      reputation: detection.results.length > 0,
      sentiment: detection.results.length > 0,
    },
  };
}

export function platformMetrics(detection: Detection): PlatformMetric[] {
  return detection.providers.map((provider) => {
    const results = detection.results.filter((item) => item.provider === provider);
    return {
      provider,
      name: providerNames[provider],
      answers: results.length,
      brandOccurrences: results.reduce((sum, item) => sum + (item.mentionCount ?? (item.brandMentioned ? 1 : 0)), 0),
      mentionedAnswers: results.filter((item) => item.brandMentioned).length,
      recommendations: results.filter((item) => item.recommended).length,
    };
  });
}

export function rankingMetrics(detection: Detection, brand: Brand): RankingMetric[] {
  const map = new Map<string, {
    name: string;
    appearances: number;
    first: number;
    top3: number;
    ranks: number[];
    configured: boolean;
    evidences: EvidenceReference[];
  }>();
  const configured = new Set(brand.competitors.map((item) => normalize(item.name)));

  detection.results.forEach((result) => {
    const seen = new Set<string>();
    readRankedBrands(result, brand).forEach((entry) => {
      const key = normalize(entry.name);
      if (!key || seen.has(key)) return;
      seen.add(key);
      const current = map.get(key) || {
        name: entry.name,
        appearances: 0,
        first: 0,
        top3: 0,
        ranks: [],
        configured: configured.has(key),
        evidences: [],
      };
      current.appearances += 1;
      if (entry.rank) {
        current.ranks.push(entry.rank);
        if (entry.rank === 1) current.first += 1;
        if (entry.rank <= 3) current.top3 += 1;
      }
      current.evidences.push(toEvidence(result, entry.evidence));
      map.set(key, current);
    });
  });

  return Array.from(map.values())
    .map((item) => ({
      name: item.name,
      appearances: item.appearances,
      mentionRate: percentage(item.appearances, detection.results.length),
      firstPlaceRate: percentage(item.first, detection.results.length),
      top3Rate: percentage(item.top3, detection.results.length),
      averageRank: item.ranks.length
        ? Number((item.ranks.reduce((sum, rank) => sum + rank, 0) / item.ranks.length).toFixed(1))
        : undefined,
      configuredCompetitor: item.configured,
      evidences: item.evidences,
    }))
    .sort((a, b) => b.appearances - a.appearances || (a.averageRank || 99) - (b.averageRank || 99));
}

export function competitorMetrics(detection: Detection, brand: Brand): CompetitorMetric[] {
  const ownKey = normalize(brand.name);
  return rankingMetrics(detection, brand)
    .filter((item) => normalize(item.name) !== ownKey)
    .map((item) => {
      const cooccurrences = item.evidences.filter(({ resultId }) => {
        const result = detection.results.find((entry) => entry.id === resultId);
        return Boolean(result?.brandMentioned);
      }).length;
      return { ...item, cooccurrences };
    });
}

export function sentimentMetrics(detection: Detection) {
  const count = (value: NonNullable<DetectionResult["sentimentLabel"]>) =>
    detection.results.filter((item) => item.sentimentLabel === value).length;
  const active = count("积极");
  const neutral = count("中性");
  const needsImprovement = count("需改善");
  const total = active + neutral + needsImprovement;
  return {
    active,
    neutral,
    needsImprovement,
    activeRate: percentage(active, total),
    neutralRate: percentage(neutral, total),
    needsImprovementRate: percentage(needsImprovement, total),
  };
}

export function reputationTopics(detection: Detection) {
  const map = new Map<string, {
    label: string;
    sentimentLabel: NonNullable<DetectionResult["sentimentLabel"]>;
    count: number;
    providers: Set<ProviderId>;
    evidences: EvidenceReference[];
  }>();
  detection.results.forEach((result) => {
    const topics = result.reputationTopics?.length
      ? result.reputationTopics
      : result.brandMentioned
        && result.sentimentLabel ? [{
            label: fallbackTopic(result),
            sentimentLabel: result.sentimentLabel,
            evidence: result.sentimentEvidence || excerpt(result.answer),
          }]
        : [];
    topics.forEach((topic) => {
      if (!topic.sentimentLabel) return;
      const key = `${topic.sentimentLabel}:${normalize(topic.label)}`;
      const current = map.get(key) || {
        label: topic.label,
        sentimentLabel: topic.sentimentLabel,
        count: 0,
        providers: new Set<ProviderId>(),
        evidences: [],
      };
      current.count += 1;
      current.providers.add(result.provider);
      current.evidences.push(toEvidence(result, topic.evidence));
      map.set(key, current);
    });
  });
  return Array.from(map.values())
    .map((item) => ({ ...item, providers: Array.from(item.providers) }))
    .sort((a, b) => b.count - a.count);
}

export function citationMetrics(detection: Detection) {
  const map = new Map<string, {
    source: string;
    url: string;
    count: number;
    providers: Set<ProviderId>;
    answers: EvidenceReference[];
  }>();
  detection.results.forEach((result) => {
    result.citations.forEach((citation) => {
      const source = hostname(citation.url) || citation.title;
      const key = normalize(source);
      const current = map.get(key) || {
        source,
        url: citation.url,
        count: 0,
        providers: new Set<ProviderId>(),
        answers: [],
      };
      current.count += 1;
      current.providers.add(result.provider);
      current.answers.push(toEvidence(result, citation.excerpt || citation.title));
      map.set(key, current);
    });
  });
  return Array.from(map.values())
    .map((item) => ({ ...item, providers: Array.from(item.providers) }))
    .sort((a, b) => b.count - a.count);
}

export function usedQuestionIds(detections: Detection[]) {
  return new Set(detections.flatMap((item) => item.questionIds));
}

function readRankedBrands(result: DetectionResult, brand: Brand): RankedBrandMention[] {
  if (result.rankedBrands?.length) return result.rankedBrands;
  const rows: RankedBrandMention[] = [];
  if (result.brandMentioned) {
    rows.push({
      name: brand.name,
      rank: result.rankPosition || (result.recommendationType === "top_pick" || result.recommendationPosition.includes("首位") ? 1 : undefined),
      evidence: result.recommendationEvidence || excerpt(result.answer),
    });
  }
  result.competitorMentions.forEach((name, index) => rows.push({
    name,
    rank: rows.length ? index + 2 : index + 1,
    evidence: excerptAround(result.answer, name),
    configuredCompetitor: brand.competitors.some((item) => normalize(item.name) === normalize(name)),
  }));
  return rows;
}

function ownBrandRank(result: DetectionResult, brand: Brand) {
  const row = readRankedBrands(result, brand).find((item) => normalize(item.name) === normalize(brand.name));
  return row?.rank;
}

function toEvidence(result: DetectionResult, evidence: string): EvidenceReference {
  return {
    resultId: result.id,
    provider: result.provider,
    question: result.questionSnapshot || "检测问题",
    answer: result.answer,
    evidence: evidence || excerpt(result.answer),
  };
}

function fallbackTopic(result: DetectionResult) {
  if (result.sentimentLabel === "积极") return "积极评价";
  if (result.sentimentLabel === "需改善") return "需改善反馈";
  return "品牌描述";
}

function countOccurrences(text: string, value: string) {
  const target = value.trim();
  if (!target) return 0;
  return text.split(target).length - 1;
}

function excerpt(text: string, max = 100) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function excerptAround(text: string, value: string, radius = 60) {
  const index = text.indexOf(value);
  if (index < 0) return excerpt(text);
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + value.length + radius));
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase();
}

function percentage(value: number, total: number) {
  return total ? Math.round(value / total * 100) : 0;
}

function isTestModel(value?: string) {
  const model = value?.trim().toLocaleLowerCase() || "";
  return model.startsWith("test-") || model.startsWith("mock-");
}

function hostname(url: string) {
  try {
    const value = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(value).hostname
      .trim()
      .toLocaleLowerCase()
      .replace(/\.$/, "")
      .replace(/^(?:(?:www|m|mobile|wap|3g)\.)+/, "");
  } catch {
    return "";
  }
}
