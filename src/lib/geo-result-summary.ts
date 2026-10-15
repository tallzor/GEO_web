import type {
  CitationSourceCategory,
  DetectionResult,
  GeoDetectionSummary,
  GeoFinding,
  PresentationRole,
  RiskSignal,
} from "@/lib/types";

export const geoResultAnalysisVersion = "v0.3.0-geo-results-v1";

const presentationRoles: PresentationRole[] = [
  "top_recommendation",
  "alternative",
  "general_mention",
  "risk_warning",
  "negative_counterexample",
  "not_mentioned",
];

const riskSignals: RiskSignal[] = [
  "none_detected",
  "cautious_description",
  "negative_counterexample",
];

const sourceCategories: CitationSourceCategory[] = [
  "industry_association",
  "authoritative_media",
  "research_institution",
  "standards_organization",
  "trusted_platform",
  "brand_official",
  "other",
  "unknown",
];

export function buildGeoDetectionSummary(input: {
  results: DetectionResult[];
  requestedCount: number;
  failedCount: number;
  subjectName: string;
}): GeoDetectionSummary {
  const validResults = input.results.filter((result) => result.answer.trim());
  const mentioned = validResults.filter(isTargetMentioned);
  const naturalEligible = validResults.filter((result) => result.directQuestion === false);
  const presentationRoleCounts = zeroCounts(presentationRoles);
  const riskSignalCounts = zeroCounts(riskSignals);
  const sourceCategoryCounts = zeroCounts(sourceCategories);

  validResults.forEach((result) => {
    const role = normalizedPresentationRole(result);
    presentationRoleCounts[role] += 1;
    if (isTargetMentioned(result) && result.riskSignal) {
      riskSignalCounts[result.riskSignal] += 1;
    }
  });

  const uniqueCitations = new Map<string, CitationSourceCategory>();
  mentioned.forEach((result) => result.citations.forEach((citation) => {
    const key = citation.normalizedUrl?.trim() || normalizeUrl(citation.url) || citation.url.trim();
    if (!key || uniqueCitations.has(key)) return;
    uniqueCitations.set(key, citation.sourceCategory || "unknown");
  }));
  uniqueCitations.forEach((category) => { sourceCategoryCounts[category] += 1; });

  const summaryWithoutFindings: Omit<GeoDetectionSummary, "findings"> = {
    requestedCount: Math.max(input.requestedCount, validResults.length + input.failedCount),
    validCount: validResults.length,
    failedCount: Math.max(0, input.failedCount),
    mentionedAnswerCount: mentioned.length,
    unmentionedAnswerCount: validResults.length - mentioned.length,
    totalMentionCount: mentioned.reduce((sum, result) => sum + Math.max(1, result.mentionCount || 0), 0),
    naturalEligibleCount: naturalEligible.length,
    naturalMentionedCount: naturalEligible.filter(isTargetMentioned).length,
    presentationRoleCounts,
    riskSignalCounts,
    sourceCategoryCounts,
    uniqueCitationCount: uniqueCitations.size,
    analysisVersion: geoResultAnalysisVersion,
  };

  return {
    ...summaryWithoutFindings,
    findings: buildFindings(summaryWithoutFindings, input.subjectName),
  };
}

export function isTargetMentioned(result: DetectionResult) {
  return result.targetMentioned ?? result.brandMentioned;
}

export function normalizedPresentationRole(result: DetectionResult): PresentationRole {
  if (result.presentationRole) return result.presentationRole;
  if (!isTargetMentioned(result)) return "not_mentioned";
  if (result.recommendationType === "top_pick") return "top_recommendation";
  if (result.recommendationType === "recommended" || result.recommendationType === "conditional") return "alternative";
  if (result.recommendationType === "discouraged") return "negative_counterexample";
  return "general_mention";
}

function buildFindings(
  summary: Omit<GeoDetectionSummary, "findings">,
  subjectName: string,
): GeoFinding[] {
  if (!summary.validCount) return [];
  const findings: GeoFinding[] = [{
    id: "appearance",
    text: `${summary.validCount}条有效回答中，有${summary.mentionedAnswerCount}条出现“${subjectName}”，出现率为${percentage(summary.mentionedAnswerCount, summary.validCount)}%。`,
    filter: { targetMentioned: true },
  }];

  findings.push(summary.naturalEligibleCount ? {
    id: "natural-appearance",
    text: `在${summary.naturalEligibleCount}条未直接点名检测对象的问题中，“${subjectName}”自然出现${summary.naturalMentionedCount}条。`,
    filter: { targetMentioned: true },
  } : {
    id: "natural-unavailable",
    text: "本次问题均直接点名检测对象，暂无可计算的自然出现率。",
  });

  const riskyCount = summary.riskSignalCounts.cautious_description
    + summary.riskSignalCounts.negative_counterexample;
  findings.push({
    id: "risk-and-source",
    text: riskyCount
      ? `出现检测对象的回答中，有${riskyCount}条包含谨慎或负向风险信号；相关回答包含${summary.uniqueCitationCount}个独立引用来源。`
      : `出现检测对象的回答中未识别到谨慎或负向风险信号；相关回答包含${summary.uniqueCitationCount}个独立引用来源。`,
  });
  return findings;
}

function zeroCounts<T extends string>(keys: T[]) {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

function percentage(value: number, total: number) {
  return total ? Number((value / total * 100).toFixed(1)) : 0;
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    url.hash = "";
    url.hostname = url.hostname.toLocaleLowerCase().replace(/^(?:(?:www|m|mobile|wap)\.)+/, "");
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch {
    return "";
  }
}
