import {
  Brand,
  ChannelContent,
  ChannelId,
  ContentItem,
  Detection,
  DetectionQuestion,
  DetectionResult,
  Diagnosis,
  DiagnosisScores,
  OptimizationCycle,
  OptimizationSuggestion,
  ProviderId,
  RiskIssue,
  providerNames,
} from "@/lib/types";
import { addDays, clamp, createId, isoNow } from "@/lib/utils";

const riskRules = [
  { term: "保证", message: "承诺性表达可能误导用户", blocking: true },
  { term: "100%", message: "绝对化概率表达不可发布", blocking: true },
  { term: "最好", message: "绝对化比较表达需要修改", blocking: true },
  { term: "唯一", message: "绝对化表达需要提供依据", blocking: true },
  { term: "立刻见效", message: "效果承诺不可发布", blocking: true },
  { term: "销量领先", message: "缺少可核验的销量依据", blocking: true },
  { term: "权威认证", message: "需要补充可核验认证信息", blocking: false },
];

export const providerOptions: { id: ProviderId; name: string }[] = [
  { id: "doubao", name: "豆包" },
  { id: "deepseek", name: "DeepSeek" },
  { id: "yuanbao", name: "混元（腾讯元宝）" },
];

export const channelOptions: { id: ChannelId; name: string }[] = [
  { id: "wechat", name: "公众号" },
  { id: "zhihu", name: "知乎" },
  { id: "xiaohongshu", name: "小红书" },
];

export function buildDefaultQuestions(brand: Pick<Brand, "name" | "industry" | "city" | "serviceArea">): DetectionQuestion[] {
  const now = isoNow();
  const area = brand.serviceArea || brand.city || "本地";
  const industry = brand.industry || "相关服务";
  return [
    ["品牌认知", `${brand.name}怎么样？`, "品牌认知"],
    ["服务特点", `${brand.name}主要提供哪些${industry}服务？`, "品牌认知"],
    ["适用人群", `${brand.name}适合哪些人？`, "用户决策"],
    ["本地推荐", `${area}适合新手的${industry}品牌有哪些？`, "品牌推荐"],
    ["体验选择", `第一次体验${industry}应该怎么选？`, "用户决策"],
    ["预算选择", `预算有限时，${area}的${industry}服务怎么选？`, "用户决策"],
    ["竞品对比", `${brand.name}和其他${industry}品牌有什么区别？`, "竞品对比"],
    ["可信信息", `在哪里可以查到${brand.name}的可靠信息？`, "信源"],
  ].map(([, text, category], index) => ({
    id: createId(`q${index + 1}`),
    text,
    category,
    source: "industry",
    enabled: true,
    updatedAt: now,
  }));
}

export function brandCompleteness(brand: Brand) {
  const checks = [
    Boolean(brand.name),
    Boolean(brand.characteristics),
    Boolean(brand.categoryName),
    Boolean(brand.trustProof),
    Boolean(brand.positioningStatement),
    Boolean(brand.industry),
    Boolean(brand.intro),
    Boolean(brand.city),
    Boolean(brand.website),
    brand.products.length > 0,
    brand.competitors.length > 0,
    brand.knowledge.some((item) => item.status === "uploaded"),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export function missingBrandFields(brand: Brand) {
  const fields: string[] = [];
  if (!brand.characteristics) fields.push("特性");
  if (!brand.categoryName) fields.push("品类名");
  if (!brand.trustProof) fields.push("信任状");
  if (!brand.positioningStatement) fields.push("定位语");
  if (!brand.intro) fields.push("品牌简介");
  if (!brand.city) fields.push("所在城市");
  if (!brand.website) fields.push("官方网站");
  if (!brand.products.length) fields.push("产品与服务");
  if (!brand.competitors.length) fields.push("竞品信息");
  if (!brand.knowledge.some((item) => item.status === "uploaded")) fields.push("知识附件");
  return fields;
}

export function buildDetectionResults(brand: Brand, detection: Detection): DetectionResult[] {
  const questions = brand.questions.filter((item) => detection.questionIds.includes(item.id));
  const isRetest = Boolean(detection.sourceDetectionId);
  return detection.providers.flatMap((provider, providerIndex) =>
    questions.map((question, questionIndex) => {
      const brandMentioned = isRetest || (questionIndex + providerIndex) % 4 !== 1;
      const recommended = brandMentioned && (isRetest || question.category === "品牌认知" || providerIndex === 0);
      const firstCompetitor = brand.competitors[0]?.name;
      const answer = buildAnswer({ brand, provider, question, brandMentioned, recommended, firstCompetitor });
      const hasCitation = questionIndex % 3 === 0 || (isRetest && questionIndex % 2 === 0);
      const rankPosition = recommended ? (providerIndex === 0 ? 1 : 2) : undefined;
      const competitorMentioned = firstCompetitor && question.category === "竞品对比";
      return {
        id: createId("result"),
        provider,
        questionId: question.id,
        answer,
        brandMentioned,
        recommended,
        recommendationPosition: recommended ? (providerIndex === 0 ? "首位推荐" : "推荐列表中") : brandMentioned ? "提及但未推荐" : "未提及",
        competitorMentions: competitorMentioned ? [firstCompetitor] : [],
        accuracy: questionIndex % 5 === 1 ? "部分准确" : "准确",
        sentimentLabel: recommended ? "积极" as const : "中性" as const,
        mentionCount: brandMentioned ? 1 : 0,
        recommendationType: recommended ? (rankPosition === 1 ? "top_pick" as const : "recommended" as const) : brandMentioned ? "mentioned_only" as const : "not_mentioned" as const,
        rankPosition,
        recommendationEvidence: brandMentioned ? `${recommended ? "可以优先了解" : "可以作为备选之一"}${brand.name}` : "",
        rankedBrands: [
          ...(brandMentioned ? [{
            name: brand.name,
            rank: rankPosition,
            evidence: `${recommended ? "可以优先了解" : "可以作为备选之一"}${brand.name}`,
          }] : []),
          ...(competitorMentioned ? [{
            name: firstCompetitor,
            rank: brandMentioned ? 2 : 1,
            evidence: `可以先了解${firstCompetitor}等本地品牌`,
            configuredCompetitor: true,
          }] : []),
        ],
        reputationTopics: brandMentioned ? [{
          label: recommended ? "服务推荐" : "品牌备选",
          sentimentLabel: recommended ? "积极" as const : "中性" as const,
          evidence: `${recommended ? "可以优先了解" : "可以作为备选之一"}${brand.name}`,
        }] : [],
        citations: hasCitation
          ? [
              {
                id: createId("source"),
                title: questionIndex % 2 ? `${brand.name}官方介绍` : `${brand.city}${brand.industry}服务指南`,
                url: brand.website || "https://example.com/source",
                type: questionIndex % 2 ? "品牌官方" : "行业内容",
                excerpt: `${brand.name}提供${brand.products[0]?.name || brand.industry}等服务，具体信息以官方资料为准。`,
                relevance: "高",
                credibility: questionIndex % 2 ? "高" : "中",
              },
            ]
          : [],
      };
    }),
  );
}

function buildAnswer({
  brand,
  provider,
  question,
  brandMentioned,
  recommended,
  firstCompetitor,
}: {
  brand: Brand;
  provider: ProviderId;
  question: DetectionQuestion;
  brandMentioned: boolean;
  recommended: boolean;
  firstCompetitor?: string;
}) {
  if (!brandMentioned) {
    return `${providerNames[provider]}建议从位置、课程内容、价格透明度和真实评价等方面选择${brand.industry}服务。${firstCompetitor ? `可以先了解${firstCompetitor}等本地品牌。` : "建议优先核实官方资料。"}`;
  }
  const recommendation = recommended ? `可以优先了解${brand.name}` : `${brand.name}可以作为备选之一`;
  return `${question.text} ${recommendation}。该品牌位于${brand.city || "本地"}，${brand.products[0]?.description || brand.intro}。选择前建议通过官方渠道确认课程、价格和门店信息。`;
}

export function buildDiagnosis(brand: Brand, _detection: Detection, results: DetectionResult[]): Diagnosis {
  const total = Math.max(results.length, 1);
  const mentioned = results.filter((item) => item.brandMentioned).length;
  const ranks = results.flatMap((item) => item.rankPosition === undefined ? [] : [item.rankPosition]);
  const top3 = ranks.filter((rank) => rank <= 3).length;
  const first = ranks.filter((rank) => rank === 1).length;
  const topics = results.flatMap((item) => item.reputationTopics || []);
  const positiveTopics = topics.filter((item) => item.sentimentLabel === "积极").length;
  const sentimentValues = results.map((item) => item.sentimentScore
    ?? (item.sentimentLabel === "积极" ? 80 : item.sentimentLabel === "需改善" ? 20 : 50));
  const scores: DiagnosisScores = {
    visibility: clamp(Math.round(mentioned / total * 100)),
    ranking: clamp(Math.round(ranks.length / total * 40 + top3 / total * 40 + first / total * 20)),
    reputation: topics.length ? clamp(Math.round(positiveTopics / topics.length * 100)) : 0,
    sentiment: sentimentValues.length
      ? clamp(Math.round(sentimentValues.reduce((sum, value) => sum + value, 0) / sentimentValues.length))
      : 50,
  };

  const issues = [
    {
      id: createId("issue"),
      title: "体验课相关问题中品牌能见不足",
      severity: "high" as const,
      dimension: "visibility" as const,
      evidence: "多个新手选择和本地推荐问题只提及品牌，未形成明确推荐。",
    },
    {
      id: createId("issue"),
      title: "部分问题中品牌推荐排名偏后",
      severity: "medium" as const,
      dimension: "ranking" as const,
      evidence: "部分AI回答未将品牌列入推荐前列。",
    },
    {
      id: createId("issue"),
      title: "品牌口碑主题覆盖较少",
      severity: "medium" as const,
      dimension: "reputation" as const,
      evidence: "现有回答对品牌服务体验的具体评价较少。",
    },
  ];

  const suggestions: OptimizationSuggestion[] = [
    {
      id: createId("suggestion"),
      title: `提升${brand.name}在本地服务问题中的能见`,
      description: "围绕体验课和私教场景增强品牌内容覆盖。",
      reason: issues[0].evidence,
      dimension: "visibility",
    },
    {
      id: createId("suggestion"),
      title: `提升${brand.name}在本地推荐中的排名`,
      description: "强化服务差异和优先选择理由。",
      reason: issues[1].evidence,
      dimension: "ranking",
    },
    {
      id: createId("suggestion"),
      title: `完善${brand.name}的服务口碑表达`,
      description: "补充真实服务特点、体验反馈和可核验案例。",
      reason: issues[2].evidence,
      dimension: "reputation",
    },
  ];
  return {
    scores,
    summary: "品牌已获得一定能见，推荐排名和具体口碑表达仍需提升。",
    issues,
    suggestions,
  };
}

export function createSevenDayCycle(brand: Brand, detection: Detection, suggestion: OptimizationSuggestion): OptimizationCycle {
  const cycleId = createId("cycle");
  const startDate = isoNow();
  const plan = buildTaskPlaybook(brand, suggestion.dimension);
  const taskTemplates = [
    { day: 1, title: plan.materialTitle, description: plan.materialDescription, type: "profile", delivery: "material", requiredFields: plan.requiredFields, materialRoute: plan.materialRoute },
    { day: 2, title: plan.titles[0], description: "公众号内容已准备好，确认后可直接存入草稿箱。", type: "content", delivery: "wechat_draft", channel: "wechat", contentTitle: plan.titles[0] },
    { day: 3, title: plan.titles[1], description: "小红书内容已准备好，确认后可直接发布。", type: "content", delivery: "xiaohongshu_publish", channel: "xiaohongshu", contentTitle: plan.titles[1] },
    { day: 4, title: plan.titles[2], description: "常见问答素材已准备好，可一键复制使用。", type: "content", delivery: "copy", contentTitle: plan.titles[2] },
    { day: 5, title: plan.titles[3], description: "第二篇公众号内容已准备好，确认后可存入草稿箱。", type: "content", delivery: "wechat_draft", channel: "wechat", contentTitle: plan.titles[3] },
    { day: 6, title: plan.titles[4], description: "场景化小红书内容已准备好，确认后可直接发布。", type: "content", delivery: "xiaohongshu_publish", channel: "xiaohongshu", contentTitle: plan.titles[4] },
    { day: 7, title: plan.titles[5], description: "品牌事实与服务问答已整理完成，可一键复制使用。", type: "content", delivery: "copy", contentTitle: plan.titles[5] },
  ] as const;
  return {
    id: cycleId,
    brandId: brand.id,
    detectionId: detection.id,
    suggestionId: suggestion.id,
    dimension: suggestion.dimension,
    target: suggestion.title,
    description: suggestion.description,
    status: "active",
    currentDay: 1,
    startDate,
    endDate: addDays(startDate, 6),
      tasks: taskTemplates.map((task) => ({
        id: createId("task"),
        cycleId,
        ...task,
        status: task.day === 1 ? "in_progress" : "pending",
      })),
    };
  }

function buildTaskPlaybook(brand: Brand, dimension: keyof DiagnosisScores) {
  const city = brand.city || "本地";
  const service = brand.products[0]?.name || `${brand.industry || "本地生活"}服务`;
  const audience = brand.products[0]?.audience || "首次体验用户";
  const playbooks = {
    visibility: {
      materialTitle: "确认门店、服务和适用人群信息",
      materialDescription: "准备后续内容需要的门店位置、服务范围和适用人群资料。",
      requiredFields: ["门店与服务范围", "核心服务项目", "适用人群"],
      materialRoute: "/brand/basic",
      titles: [`${city}${brand.industry}新手${service}选择指南`, `${city}${brand.industry}新手怎么选择合适的服务`, `${brand.name}适合哪些人？常见问题解答`, `${service}包含什么：服务流程与注意事项`, `${audience}的${brand.industry}入门方案`, `${brand.name}品牌事实与服务问答包`],
    },
    ranking: {
      materialTitle: "确认服务优势和优先选择理由",
      materialDescription: "准备核心服务、差异化特点和适用场景，支撑推荐排名内容。",
      requiredFields: ["核心服务", "差异化特点", "适用场景"],
      materialRoute: "/brand/products",
      titles: [`${city}${service}怎么选：${brand.name}的核心优势`, `${brand.name}适合优先了解的服务场景`, `${brand.name}与同类服务的选择要点`, `${service}推荐清单应重点比较什么`, `${audience}选择${service}的关键标准`, `${brand.name}服务优势问答包`],
    },
    reputation: {
      materialTitle: "准备服务特点和真实体验素材",
      materialDescription: "准备可核验的服务特点、体验反馈和案例信息。",
      requiredFields: ["服务特点", "体验反馈", "案例信息"],
      materialRoute: "/brand/products",
      titles: [`${brand.name}${service}真实体验要点`, `${service}用户最关心的服务细节`, `${brand.name}如何服务${audience}`, `从预约到完成：${service}体验说明`, `${city}${audience}的${service}体验参考`, `${brand.name}服务口碑问答包`],
    },
    sentiment: {
      materialTitle: "确认用户关切和体验保障信息",
      materialDescription: "准备服务流程、用户关切和体验保障，支撑正向情感内容。",
      requiredFields: ["服务流程", "用户关切", "体验保障"],
      materialRoute: "/brand/products",
      titles: [`第一次到${brand.name}体验的完整流程`, `${service}体验前需要准备什么`, `${brand.name}如何回应${audience}的常见顾虑`, `从预约到完成：${service}体验保障`, `${city}${audience}的轻松入门方案`, `${brand.name}服务流程与用户关怀问答包`],
    },
  } satisfies Record<keyof DiagnosisScores, { materialTitle: string; materialDescription: string; requiredFields: string[]; materialRoute: string; titles: string[] }>;
  return playbooks[dimension];
}

export function generateContent(brand: Brand, cycle: OptimizationCycle, taskId: string): ContentItem {
  const now = isoNow();
  const task = cycle.tasks.find((item) => item.id === taskId);
  const product = brand.products[0];
  const baseTitle = task?.contentTitle || task?.title || `${brand.name}服务介绍`;
  const service = product?.name || `${brand.industry}服务`;
  const facts = `${brand.name}${brand.city ? `位于${brand.city}` : ""}，${product ? `提供${service}。${product.description}` : `提供${brand.industry}相关服务。`}`;
  const coreBody = task?.delivery === "copy"
    ? [
        `问题：${baseTitle.replace(/问答包|常见问答|常见问题解答/, "的主要信息是什么")}`,
        `回答：${facts}`,
        `问题：${service}适合哪些人？`,
        `回答：${product?.audience || "可根据个人需求向门店咨询适合的服务安排"}。`,
        `问题：如何了解价格和门店信息？`,
        `回答：${product?.price ? `${service}价格说明为“${product.price}”` : "具体价格请向门店确认"}，服务范围为${brand.serviceArea || brand.city || "门店周边区域"}。具体信息请以${brand.name}官方资料为准。`,
      ].join("\n\n")
    : [
        `选择${brand.industry}服务时，可以先了解服务内容、适用人群、门店位置和价格说明。`,
        facts,
        product?.features ? `${service}的主要特点包括：${product.features}。` : `${brand.name}会根据用户需求介绍具体服务安排。`,
        `如果你是${product?.audience || "首次体验用户"}，建议提前确认预约方式、服务流程和注意事项。`,
        `具体服务和价格请以${brand.name}官方资料为准。`,
      ].join("\n\n");
  const channels = buildChannelVersions(baseTitle, coreBody, brand);
  const selectedChannel = task?.channel || "wechat";
  const selectedVersion = channels.find((item) => item.channel === selectedChannel);
  return {
    id: createId("content"),
    brandId: brand.id,
    cycleId: cycle.id,
    taskId,
      title: selectedVersion?.title || baseTitle,
      body: selectedVersion?.body || coreBody,
      selectedChannel,
    channels,
    version: 1,
    status: "draft",
    riskStatus: "unchecked",
    riskIssues: [],
    createdAt: now,
    updatedAt: now,
  };
}

function buildChannelVersions(title: string, body: string, brand: Brand): ChannelContent[] {
  return [
    { channel: "wechat", title: `${brand.name}新手体验课选择指南`, body: `# ${title}\n\n${body}` },
    { channel: "zhihu", title, body },
    { channel: "xiaohongshu", title, body: `${body}\n\n#健身新手 #体验课 #${brand.city || "本地健身"}` },
  ];
}

export function reviewContent(content: ContentItem, brand: Brand) {
  const channel = content.channels.find((item) => item.channel === content.selectedChannel);
  const text = `${channel?.title || content.title}\n${channel?.body || content.body}`;
  const riskIssues: RiskIssue[] = riskRules
    .filter((rule) => text.includes(rule.term))
    .map((rule) => ({
      id: createId("risk"),
      type: rule.blocking ? "prohibited" : "sensitive",
      term: rule.term,
      message: rule.message,
      blocking: rule.blocking,
    }));
  if (!text.includes(brand.name)) {
    riskIssues.push({
      id: createId("risk"),
      type: "consistency",
      term: brand.name,
      message: "内容未明确提及当前品牌，请核对内容归属。",
      blocking: true,
    });
  }
  const blocked = riskIssues.some((item) => item.blocking);
  return {
    issues: riskIssues,
    status: blocked ? ("blocked" as const) : riskIssues.length ? ("warning" as const) : ("passed" as const),
  };
}
