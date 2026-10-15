export type Id = string;

export type ProviderId = "doubao" | "deepseek" | "yuanbao";
export type ChannelId = "wechat" | "zhihu" | "xiaohongshu";
export type CollectionMethod = "model_api" | "browser_ui";
export type ProviderErrorCategory =
  | "configuration"
  | "authentication"
  | "rate_limit"
  | "timeout"
  | "network"
  | "invalid_response"
  | "collection"
  | "analysis";
export type RecommendationType =
  | "top_pick"
  | "recommended"
  | "conditional"
  | "mentioned_only"
  | "discouraged"
  | "not_mentioned";

export type PresentationRole =
  | "top_recommendation"
  | "alternative"
  | "general_mention"
  | "risk_warning"
  | "negative_counterexample"
  | "not_mentioned";

export type RiskSignal =
  | "none_detected"
  | "cautious_description"
  | "negative_counterexample";

export type CitationSourceCategory =
  | "industry_association"
  | "authoritative_media"
  | "research_institution"
  | "standards_organization"
  | "trusted_platform"
  | "brand_official"
  | "other"
  | "unknown";

export type GeoResultFilter = {
  targetMentioned?: boolean;
  presentationRole?: PresentationRole;
  riskSignal?: RiskSignal;
  sourceCategory?: CitationSourceCategory;
};

export type GeoFinding = {
  id: Id;
  text: string;
  filter?: GeoResultFilter;
};

export type GeoDetectionSummary = {
  requestedCount: number;
  validCount: number;
  failedCount: number;
  mentionedAnswerCount: number;
  unmentionedAnswerCount: number;
  totalMentionCount: number;
  naturalEligibleCount: number;
  naturalMentionedCount: number;
  presentationRoleCounts: Record<PresentationRole, number>;
  riskSignalCounts: Record<RiskSignal, number>;
  sourceCategoryCounts: Record<CitationSourceCategory, number>;
  uniqueCitationCount: number;
  findings: GeoFinding[];
  analysisVersion: string;
};

export type SentimentLabel = "积极" | "中性" | "需改善";

export type RankedBrandMention = {
  name: string;
  rank?: number;
  evidence: string;
  configuredCompetitor?: boolean;
};

export type ReputationTopic = {
  label: string;
  sentimentLabel?: SentimentLabel;
  evidence: string;
};

export type StoreLocation = {
  id: Id;
  name: string;
  address: string;
};

export type ProductService = {
  id: Id;
  name: string;
  type: string;
  description: string;
  price: string;
  features: string;
  audience: string;
  scenarios: string;
  advantages: string;
  problemsSolved: string;
  quantitativeFacts: string;
  evidence: string;
  limitations: string;
  otherInfo: string;
  updatedAt: string;
};

export type Competitor = {
  id: Id;
  name: string;
  description: string;
};

export type KnowledgeAttachment = {
  id: Id;
  productId?: Id;
  fileName: string;
  fileType: string;
  sizeLabel: string;
  status: "uploading" | "uploaded" | "failed";
  /** 旧数据兼容；v0.3.0 不解析附件，也不展示事实数量。 */
  factCount?: number;
  uploadedAt: string;
  uploadedBy?: string;
  error?: string;
};

export type DetectionQuestion = {
  id: Id;
  text: string;
  subjectType: "brand" | "product";
  subjectId: Id;
  persona: string;
  decisionScenario: string;
  source: "simulator" | "manual" | "legacy";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Brand = {
  id: Id;
  name: string;
  shortName: string;
  characteristics: string;
  categoryName: string;
  trustProof: string;
  positioningStatement: string;
  industry: string;
  industryCode: string;
  industryPath: string;
  industryStandard: string;
  website: string;
  intro: string;
  city: string;
  stores: StoreLocation[];
  serviceArea: string;
  targetAudience: string;
  coreScenarios: string;
  valuePromise: string;
  cognitionBoundary: string;
  otherInfo: string;
  products: ProductService[];
  competitors: Competitor[];
  knowledge: KnowledgeAttachment[];
  questions: DetectionQuestion[];
  questionContextUpdatedAt?: string;
  questionsGeneratedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CognitionRunStatus =
  | "queued"
  | "analyzing"
  | "review_required"
  | "confirmed"
  | "failed";

export type CognitionSupportStatus =
  | "supported"
  | "partially_supported"
  | "insufficient"
  | "conflicting";

export type CognitionReference = {
  title: string;
  url: string;
};

export type CognitionInsightItem = {
  key: string;
  label: string;
  conclusion: string;
  supportStatus: CognitionSupportStatus;
  inputFields: string[];
  webReferences: CognitionReference[];
  missingOrConflict: string;
};

export type CognitionInsight = {
  id: Id;
  runId: Id;
  brandId: Id;
  subjectType: "brand" | "product";
  subjectId: Id;
  subjectName: string;
  modelType: "brand_six_elements" | "bfabeww";
  items: CognitionInsightItem[];
  status: "draft" | "confirmed";
  version: number;
  isCurrent: boolean;
  provider: string;
  model: string;
  promptVersion: string;
  webSearchUsed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CognitionRun = {
  id: Id;
  brandId: Id;
  brandName: string;
  status: CognitionRunStatus;
  error?: string;
  attempt: number;
  inputSnapshot: CognitionInputSnapshot;
  insights: CognitionInsight[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  confirmedAt?: string;
};

export type CognitionBrandInput = Pick<
  Brand,
  | "id"
  | "name"
  | "shortName"
  | "characteristics"
  | "categoryName"
  | "trustProof"
  | "positioningStatement"
  | "industry"
  | "industryCode"
  | "industryPath"
  | "industryStandard"
  | "website"
  | "intro"
  | "serviceArea"
  | "targetAudience"
  | "coreScenarios"
  | "valuePromise"
  | "cognitionBoundary"
  | "otherInfo"
>;

export type CognitionInputSnapshot = {
  brand: CognitionBrandInput;
  products: CognitionProductInput[];
  competitors: Competitor[];
};

export type CognitionProductInput = Pick<
  ProductService,
  | "id"
  | "name"
  | "type"
  | "description"
  | "features"
  | "audience"
  | "scenarios"
  | "advantages"
  | "problemsSolved"
  | "quantitativeFacts"
  | "evidence"
  | "limitations"
  | "otherInfo"
>;

export type CognitionInsightRevision = {
  insightId: Id;
  items: Array<{ key: string; conclusion: string }>;
};

export type QuestionSimulationMode = "initial" | "supplement" | "new_batch";

export type QuestionSimulationStatus =
  | "queued"
  | "generating"
  | "review_required"
  | "confirmed"
  | "failed"
  | "cancelled";

export type QuestionSimulationStage =
  | "persona"
  | "planning"
  | "questions"
  | "validation";

export type QuestionPersona = {
  id: Id;
  name: string;
  audience: string;
  knowledgeLevel: string;
  decisionScenario: string;
  task: string;
  concern: string;
  constraints: string;
  decisionStage: string;
};

export type QuestionCandidate = {
  id: Id;
  runId: Id;
  text: string;
  persona: string;
  decisionScenario: string;
  createdAt: string;
};

export type QuestionSimulationRun = {
  id: Id;
  brandId: Id;
  subjectType: "brand" | "product";
  subjectId: Id;
  subjectName: string;
  cognitionInsightId: Id;
  cognitionVersion: number;
  mode: QuestionSimulationMode;
  status: QuestionSimulationStatus;
  stage?: QuestionSimulationStage;
  personas: QuestionPersona[];
  candidates: QuestionCandidate[];
  coverageGaps: string[];
  externalReferences: CognitionReference[];
  attempt: number;
  error?: string;
  retryable?: boolean;
  model?: string;
  promptVersion: string;
  generatedCount: number;
  adoptedCount: number;
  deletedCount: number;
  editedCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  confirmedAt?: string;
};

export type QuestionCandidateReview = {
  id: Id;
  text: string;
  persona: string;
  decisionScenario: string;
};

export type Citation = {
  id: Id;
  title: string;
  url: string;
  type: string;
  providerType?: string;
  excerpt: string;
  relevance: "高" | "中" | "低";
  credibility: "高" | "中" | "低";
  normalizedUrl?: string;
  sourceCategory?: CitationSourceCategory;
};

export type DetectionSample = {
  index: number;
  answer: string;
  brandMentioned: boolean;
  competitorMentions: string[];
  citations: Citation[];
  collectedAt?: string;
  collectionMethod?: CollectionMethod;
  mentionCount?: number;
  firstMentionIndex?: number;
  model?: string;
  requestId?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  webSearchEnabled: boolean;
  searchQueries?: string[];
  webSearchUnavailableReason?: string;
};

export type DetectionResult = {
  id: Id;
  provider: ProviderId;
  questionId: Id;
  answer: string;
  brandMentioned: boolean;
  targetMentioned?: boolean;
  directQuestion?: boolean;
  presentationRole?: PresentationRole;
  presentationEvidence?: string;
  riskSignal?: RiskSignal;
  riskEvidence?: string;
  recommended: boolean;
  recommendationPosition: string;
  competitorMentions: string[];
  accuracy: "准确" | "部分准确" | "待确认";
  citations: Citation[];
  dataSource?: "mock" | "live_api";
  model?: string;
  requestId?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  webSearchEnabled?: boolean;
  searchQueries?: string[];
  webSearchUnavailableReason?: string;
  questionSnapshot?: string;
  samples?: DetectionSample[];
  summary?: string;
  mentionCount?: number;
  firstMentionIndex?: number;
  collectedAt?: string;
  collectionMethod?: CollectionMethod;
  analysisModel?: string;
  analysisConclusion?: string;
  recommendationType?: RecommendationType;
  rankPosition?: number;
  recommendationEvidence?: string;
  sentimentLabel?: SentimentLabel;
  sentimentScore?: number;
  sentimentEvidence?: string;
  positiveEvaluationCount?: number;
  negativeEvaluationCount?: number;
  accuracyScore?: number;
  accuracyEvidence?: string;
  factClaims?: string[];
  rankedBrands?: RankedBrandMention[];
  reputationTopics?: ReputationTopic[];
};

export type DetectionRunError = {
  questionId: Id;
  provider: ProviderId;
  message: string;
  runKey?: string;
  category?: ProviderErrorCategory;
  retryable?: boolean;
};

export type DiagnosisScores = {
  visibility: number;
  ranking: number;
  reputation: number;
  sentiment: number;
};

export type DiagnosisIssue = {
  id: Id;
  title: string;
  severity: "high" | "medium" | "low";
  dimension: keyof DiagnosisScores;
  evidence: string;
};

export type OptimizationSuggestion = {
  id: Id;
  title: string;
  description: string;
  reason: string;
  dimension: keyof DiagnosisScores;
  selected?: boolean;
  generatedBy?: "foundation_model" | "rule_fallback";
  generationModel?: string;
  promptVersion?: string;
};

export type Diagnosis = {
  scores: DiagnosisScores;
  summary: string;
  issues: DiagnosisIssue[];
  suggestions: OptimizationSuggestion[];
  scoreAvailability?: Partial<Record<keyof DiagnosisScores, boolean>>;
  analysisModel?: string;
  suggestionStatus?: "not_generated" | "generating" | "generated" | "failed";
  suggestionError?: string;
  suggestionUpdatedAt?: string;
};

export type Detection = {
  id: Id;
  brandId: Id;
  subjectType?: "brand" | "product";
  subjectId?: Id;
  subjectName?: string;
  name: string;
  status: "pending" | "running" | "partial" | "completed" | "failed";
  providers: ProviderId[];
  questionIds: Id[];
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  createdAt: string;
  completedAt?: string;
  sourceDetectionId?: Id;
  results: DetectionResult[];
  resultSummary?: GeoDetectionSummary;
  diagnosis?: Diagnosis;
  dataSource?: "mock" | "live_api";
  collectionMethod?: CollectionMethod;
  analysisModel?: string;
  runErrors?: DetectionRunError[];
  attempt?: number;
  stage?: "queued" | "collecting" | "analyzing" | "aggregating" | "completed" | "failed";
  collectionTotal?: number;
  collectionCompleted?: number;
  analysisTotal?: number;
  analysisCompleted?: number;
  progressMessage?: string;
  workerId?: string;
  heartbeatAt?: string;
  leaseExpiresAt?: string;
  collectionModelVersions?: Record<string, string>;
  analysisPromptVersion?: string;
  analysisRuleVersion?: string;
  serverManaged?: boolean;
  updatedAt?: string;
};

export type TaskType = "profile" | "content" | "review" | "publish" | "retest";
export type TaskStatus = "pending" | "in_progress" | "completed" | "void";
export type TaskDelivery =
  | "material"
  | "copy"
  | "wechat_draft"
  | "zhihu_draft"
  | "xiaohongshu_publish"
  | "multi_platform";

export type OptimizationTask = {
  id: Id;
  cycleId: Id;
  day: number;
  title: string;
  description: string;
  type: TaskType;
  delivery: TaskDelivery;
  channel?: ChannelId;
  contentTitle?: string;
  requiredFields?: string[];
  materialRoute?: string;
  status: TaskStatus;
  contentId?: Id;
  completedAt?: string;
};

export type OptimizationCycle = {
  id: Id;
  brandId: Id;
  detectionId: Id;
  suggestionId: Id;
  dimension: keyof DiagnosisScores;
  target: string;
  description: string;
  status: "active" | "completed" | "terminated";
  currentDay: number;
  startDate: string;
  endDate: string;
  tasks: OptimizationTask[];
  terminatedAt?: string;
};

export type RiskIssue = {
  id: Id;
  type: "prohibited" | "sensitive" | "consistency";
  term: string;
  message: string;
  blocking: boolean;
};

export type ChannelContent = {
  channel: ChannelId;
  title: string;
  body: string;
  usedFacts?: string[];
  missingInformation?: string[];
};

export type ContentItem = {
  id: Id;
  brandId: Id;
  cycleId: Id;
  taskId: Id;
  title: string;
  body: string;
  selectedChannel: ChannelId;
  channels: ChannelContent[];
  version: number;
  status: "draft" | "checking" | "blocked" | "publishable" | "publishing" | "published" | "failed";
  riskStatus: "unchecked" | "blocked" | "warning" | "passed";
  riskIssues: RiskIssue[];
  generationSource?: "foundation_model" | "rule_fallback";
  generationModel?: string;
  promptVersion?: string;
  createdAt: string;
  updatedAt: string;
};

export type PublishRecord = {
  id: Id;
  batchId?: Id;
  brandId: Id;
  cycleId: Id;
  taskId: Id;
  contentId: Id;
  contentVersion: number;
  title: string;
  bodySnapshot: string;
  channel: ChannelId;
  accountName: string;
  status: "queued" | "syncing" | "publishing" | "published" | "draft_saved" | "failed";
  attemptCount?: number;
  externalDraftId?: string;
  externalDraftUrl?: string;
  errorCode?: string;
  startedAt?: string;
  createdAt: string;
  completedAt?: string;
  error?: string;
};

export type PublishBatchStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "partial_succeeded"
  | "failed";

export type PublishBatch = {
  id: Id;
  brandId: Id;
  taskId: Id;
  contentId: Id;
  contentVersion: number;
  idempotencyKey: string;
  status: PublishBatchStatus;
  successCount: number;
  failureCount: number;
  createdAt: string;
  completedAt?: string;
  records: PublishRecord[];
};

export type PlatformConnectionMode = "server_api" | "browser_extension" | "unavailable";

export type PlatformAvailability = "available" | "coming_soon";

export type PublishingPlatform = {
  id?: Id;
  brandId?: Id;
  channel: ChannelId;
  name: string;
  configured: boolean;
  accountName: string;
  verifiedAt: string;
  mode?: "demo" | "real";
  appIdMasked?: string;
  draftEnabled?: boolean;
  connectionStatus?: "connected" | "disconnected" | "error";
  connectionMode?: PlatformConnectionMode;
  availability?: PlatformAvailability;
  defaultCoverObjectPath?: string;
  extensionVersion?: string;
  lastConnectedAt?: string;
  error?: string;
};

export type UserProfile = {
  id: Id;
  name: string;
  phone: string;
  email: string;
};

export const providerNames: Record<ProviderId, string> = {
  doubao: "豆包",
  deepseek: "DeepSeek",
  yuanbao: "混元（腾讯元宝）",
};

export const channelNames: Record<ChannelId, string> = {
  wechat: "公众号",
  zhihu: "知乎",
  xiaohongshu: "小红书",
};
