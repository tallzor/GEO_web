import type {
  CitationSourceCategory,
  RecommendationType,
  SentimentLabel,
} from "@/lib/types";

const recommendationWeights: Record<RecommendationType, number> = {
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

export function normalizeCitationUrl(value: string) {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    url.hash = "";
    url.hostname = normalizedHostname(url.hostname);
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch {
    return "";
  }
}

export function classifyCitationSource(input: {
  title: string;
  url: string;
  providerType?: string;
  officialWebsite?: string;
}): CitationSourceCategory {
  const normalizedUrl = normalizeCitationUrl(input.url);
  if (!normalizedUrl) return "unknown";
  const hostname = new URL(normalizedUrl).hostname;
  const title = `${input.title} ${input.providerType || ""}`.toLocaleLowerCase();
  const officialHostname = hostnameFromUrl(input.officialWebsite || "");

  if (officialHostname && sameDomain(hostname, officialHostname)) return "brand_official";
  if (matchesDomain(hostname, ["sac.gov.cn", "std.samr.gov.cn", "iso.org", "iec.ch", "w3.org", "ietf.org"])) {
    return "standards_organization";
  }
  if (/标准化|标准委员会|标准组织|国家标准|行业标准/.test(title)) return "standards_organization";
  if (/协会|商会|学会|联合会|行业组织/.test(title)) return "industry_association";
  if (matchesDomain(hostname, ["people.com.cn", "xinhuanet.com", "cctv.com", "chinanews.com.cn", "gmw.cn", "ce.cn"])) {
    return "authoritative_media";
  }
  if (/人民日报|新华社|中央广播电视总台|中国新闻网|光明日报|经济日报/.test(title)) {
    return "authoritative_media";
  }
  if (hostname.endsWith(".edu.cn") || matchesDomain(hostname, ["cas.cn", "cass.cn"]) || /大学|研究院|研究所|实验室/.test(title)) {
    return "research_institution";
  }
  if (hostname.endsWith(".gov.cn") || /政府|监管|国家市场监督管理/.test(title)) return "trusted_platform";
  return "other";
}

function hostnameFromUrl(value: string) {
  const normalized = normalizeCitationUrl(value);
  return normalized ? new URL(normalized).hostname : "";
}

function normalizedHostname(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\.$/, "").replace(/^(?:(?:www|m|mobile|wap)\.)+/, "");
}

function matchesDomain(hostname: string, domains: string[]) {
  return domains.some((domain) => sameDomain(hostname, domain));
}

function sameDomain(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}
