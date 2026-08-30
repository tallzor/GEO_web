import { buildDefaultQuestions, buildDetectionResults, buildDiagnosis, createSevenDayCycle, generateContent } from "@/lib/engine";
import {
  Brand,
  ContentItem,
  Detection,
  OptimizationCycle,
  PublishBatch,
  PublishRecord,
  PublishingPlatform,
  UserProfile,
} from "@/lib/types";

export type SeedData = {
  user: UserProfile;
  brands: Brand[];
  detections: Detection[];
  cycles: OptimizationCycle[];
  contents: ContentItem[];
  publishBatches: PublishBatch[];
  publishRecords: PublishRecord[];
  platforms: PublishingPlatform[];
};

export function createSeedData(): SeedData {
  const baseBrand: Brand = {
    id: "brand_yuedong",
    name: "跃动健身",
    shortName: "",
    characteristics: "面向健身新手，提供低门槛、有人指导的训练体验",
    categoryName: "本地健身服务",
    trustProof: "专业教练团队与标准化体能评估",
    positioningStatement: "让城市上班族轻松开始科学健身",
    industry: "健身",
    website: "https://example.com/yuedong",
    intro: "跃动健身是一家面向城市上班族和健身新手的本地健身品牌，提供体验课、团课和私教服务。",
    city: "上海",
    serviceArea: "上海浦东新区",
    targetAudience: "城市上班族、健身新手、希望减脂塑形的人群",
    stores: [{ id: "store_lujiazui", name: "陆家嘴店", address: "上海市浦东新区示例路88号" }],
    products: [
      {
        id: "product_trial",
        name: "新手体验课",
        type: "体验课",
        description: "包含体能评估、器械讲解和一节基础训练，适合第一次进入健身房的用户。",
        price: "到店咨询",
        features: "小班体验、动作指导、训练建议",
        audience: "健身新手、希望改善体态的上班族",
        updatedAt: "2026-07-18T09:00:00.000Z",
      },
      {
        id: "product_pt",
        name: "一对一私教课",
        type: "私教",
        description: "根据训练目标制定个人计划，由教练进行动作指导和阶段复盘。",
        price: "按课时计费",
        features: "个人计划、动作纠正、阶段复盘",
        audience: "有明确训练目标的用户",
        updatedAt: "2026-07-17T09:00:00.000Z",
      },
    ],
    competitors: [
      { id: "competitor_1", name: "燃点健身", description: "同商圈综合健身房，公开内容以器械和团课为主。" },
      { id: "competitor_2", name: "自在运动", description: "面向年轻用户的小型团课工作室。" },
    ],
    knowledge: [
      {
        id: "knowledge_1",
        fileName: "跃动健身品牌与课程资料.pdf",
        fileType: "PDF",
        sizeLabel: "1.8 MB",
        status: "active",
        factCount: 18,
        uploadedAt: "2026-07-18T10:00:00.000Z",
      },
    ],
    questions: [],
    questionContextUpdatedAt: "2026-07-20T08:00:00.000Z",
    questionsGeneratedAt: "2026-07-20T08:00:00.000Z",
    createdAt: "2026-07-10T08:00:00.000Z",
    updatedAt: "2026-07-20T08:00:00.000Z",
  };
  baseBrand.questions = buildDefaultQuestions(baseBrand);

  const previous: Detection = {
    id: "detection_previous",
    brandId: baseBrand.id,
    name: "第1次GEO基线检测",
    status: "completed",
    providers: ["doubao", "deepseek", "yuanbao"],
    questionIds: baseBrand.questions.slice(0, 6).map((item) => item.id),
    totalRuns: 18,
    completedRuns: 18,
    failedRuns: 0,
    createdAt: "2026-07-13T02:00:00.000Z",
    completedAt: "2026-07-13T02:04:00.000Z",
    results: [],
  };
  previous.results = buildDetectionResults(baseBrand, previous);
  previous.diagnosis = buildDiagnosis(baseBrand, previous, previous.results);
  previous.diagnosis.scores = { visibility: 54, ranking: 48, reputation: 66, sentiment: 63 };

  const latest: Detection = {
    id: "detection_latest",
    brandId: baseBrand.id,
    name: "第2次GEO检测",
    status: "completed",
    providers: ["doubao", "deepseek", "yuanbao"],
    questionIds: baseBrand.questions.slice(0, 6).map((item) => item.id),
    totalRuns: 18,
    completedRuns: 18,
    failedRuns: 0,
    createdAt: "2026-07-20T02:26:00.000Z",
    completedAt: "2026-07-20T02:30:00.000Z",
    sourceDetectionId: previous.id,
    results: [],
  };
  latest.results = buildDetectionResults(baseBrand, latest);
  latest.diagnosis = buildDiagnosis(baseBrand, latest, latest.results);
  latest.diagnosis.scores = { visibility: 62, ranking: 56, reputation: 71, sentiment: 68 };
  latest.diagnosis.suggestions[0].selected = true;

  const cycle = createSevenDayCycle(baseBrand, latest, latest.diagnosis.suggestions[0]);
  cycle.id = "cycle_active";
  cycle.currentDay = 3;
  cycle.startDate = "2026-07-18T00:00:00.000Z";
  cycle.endDate = "2026-07-24T23:59:59.000Z";
  cycle.tasks = cycle.tasks.map((task, index) => ({
    ...task,
    cycleId: cycle.id,
    status: index < 2 ? "completed" : index === 2 ? "in_progress" : "pending",
    completedAt: index < 2 ? `2026-07-${18 + index}T10:00:00.000Z` : undefined,
  }));

  const currentContent = generateContent(baseBrand, cycle, cycle.tasks[2].id);
  currentContent.id = "content_current";
  cycle.tasks[2].contentId = currentContent.id;

  const publishRecords: PublishRecord[] = [
    {
      id: "publish_1",
      brandId: baseBrand.id,
      cycleId: "cycle_previous",
      taskId: "task_previous_1",
      contentId: "content_previous_1",
      contentVersion: 1,
      title: "新手体验课避坑指南",
      bodySnapshot: "第一次选择体验课，可以先确认课程内容、适合人群、价格和门店信息。",
      channel: "xiaohongshu",
      accountName: "跃动健身官方账号",
      status: "published",
      createdAt: "2026-07-19T08:00:00.000Z",
      completedAt: "2026-07-19T08:00:05.000Z",
    },
    {
      id: "publish_2",
      brandId: baseBrand.id,
      cycleId: "cycle_previous",
      taskId: "task_previous_2",
      contentId: "content_previous_2",
      contentVersion: 1,
      title: "私教体验课适合哪些人",
        bodySnapshot: "私教体验课适合希望获得个人训练建议和动作指导的用户。",
        channel: "wechat",
        accountName: "跃动健身公众号",
        status: "draft_saved",
      createdAt: "2026-07-18T08:00:00.000Z",
      completedAt: "2026-07-18T08:00:05.000Z",
    },
  ];

  const platforms: PublishingPlatform[] = [
    { channel: "wechat", name: "公众号", configured: true, accountName: "跃动健身公众号", verifiedAt: "2026-07-20T03:00:00.000Z", mode: "demo", appIdMasked: "wx********9a2f", draftEnabled: true, connectionStatus: "connected" },
    { channel: "xiaohongshu", name: "小红书", configured: true, accountName: "跃动健身官方账号", verifiedAt: "2026-07-20T03:00:00.000Z" },
  ];

  for (const platform of platforms) {
    platform.brandId = baseBrand.id;
    platform.connectionMode = platform.channel === "wechat" ? "server_api" : "unavailable";
    platform.availability = platform.channel === "xiaohongshu" ? "coming_soon" : "available";
  }
  platforms.push({
    brandId: baseBrand.id,
    channel: "zhihu",
    name: "知乎",
    configured: false,
    accountName: "",
    verifiedAt: "",
    mode: "real",
    draftEnabled: true,
    connectionStatus: "disconnected",
    connectionMode: "browser_extension",
    availability: "available",
  });

  const publishBatches: PublishBatch[] = [];

  return {
    user: { id: "user_demo", name: "王店长", phone: "138****6808", email: "owner@example.com" },
    brands: [baseBrand],
    detections: [previous, latest],
    cycles: [cycle],
    contents: [currentContent],
    publishBatches,
    publishRecords,
    platforms,
  };
}
