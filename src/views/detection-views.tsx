"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDot,
  FileSearch,
  History,
  Info,
  LoaderCircle,
  Plus,
  RefreshCw,
  SearchCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ModuleNav } from "@/components/module-nav";
import { LiveDetectionRunner } from "@/components/live-detection-runner";
import { Badge, Button, Card, EmptyState, Field, PageHeader, Progress } from "@/components/ui";
import {
  completedDetectionsForBrand,
} from "@/lib/detection-metrics";
import {
  buildGeoDetectionSummary,
  isTargetMentioned,
  normalizedPresentationRole,
} from "@/lib/geo-result-summary";
import { currentBrand, useAppStore } from "@/lib/store";
import type {
  CitationSourceCategory,
  Detection,
  GeoDetectionSummary,
  PresentationRole,
  ProviderId,
  RiskSignal,
} from "@/lib/types";
import { providerNames } from "@/lib/types";

const detectionNav = [
  { href: "/geo", label: "总览" },
  { href: "/geo/records", label: "检测记录" },
  { href: "/geo/questions", label: "问题库" },
];

function DetectionFrame({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return <>
    <PageHeader title={title} description={description} actions={actions} />
    <ModuleNav items={detectionNav} />
    {children}
  </>;
}

function useDetectionData() {
  const brand = useAppStore(currentBrand);
  const allDetections = useAppStore((state) => state.detections);
  const detections = useMemo(
    () => brand ? allDetections
      .filter((item) => item.brandId === brand.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [],
    [allDetections, brand],
  );
  return { brand, detections };
}

export function DetectionOverviewView() {
  const { brand, detections } = useDetectionData();
  const [now] = useState(() => Date.now());
  if (!brand) return null;
  const completed = completedDetectionsForBrand(detections, brand.id);
  const latest = completed[0];
  const last30 = detections.filter((item) => now - new Date(item.createdAt).getTime() <= 30 * 86400000).length;
  const historyPlatformCounts = Object.entries(
    detections.reduce<Partial<Record<ProviderId, number>>>((map, detection) => {
      detection.providers.forEach((provider) => { map[provider] = (map[provider] || 0) + 1; });
      return map;
    }, {}),
  ).map(([provider, value]) => ({
    label: providerNames[provider as ProviderId],
    value: value || 0,
    color: providerColor(provider as ProviderId),
  }));

  return <DetectionFrame
    title="检测"
    description="管理品牌检测问题、执行记录和最新检测结果。"
    actions={<Link className="btn btn-primary" href="/geo/new"><Plus size={16} />发起最新检测</Link>}
  >
    <div className="grid grid-2 detection-overview-top">
      <Card title="累计检测次数" description="当前品牌历史发起的检测批次">
        <div className="detection-big-number">{detections.length}</div>
      </Card>
      <Card title="近30天检测频率" description="近30天内实际完成或发起的检测批次">
        <div className="detection-big-number detection-big-number-purple">{last30}<span>次</span></div>
      </Card>
    </div>

    <div className="grid grid-2 section-gap">
      <Card title="检测平台分布" description="历史检测批次中各AI平台的参与次数">
        <DonutChart items={historyPlatformCounts} emptyText="暂无平台检测数据" />
      </Card>
      <Card title="最近一次各平台出现情况" description={latest ? "按各AI平台的有效回答计算检测对象出现率" : "完成检测后自动生成"}>
        {latest
          ? <PlatformCoverage detection={latest} />
          : <EmptyState title="暂无检测结果" description="发起首次检测后展示平台提及分布。" />}
      </Card>
    </div>

    {latest
      ? <LatestDetectionSummary detection={latest} brandName={brand.name} />
      : <Card className="section-gap">
          <EmptyState
            title="尚未进行检测"
            description="先从问题库选择问题并发起检测，完成后可查看分析结果。"
            action={<Link className="btn btn-primary" href="/geo/new">开始首次检测</Link>}
            icon={<SearchCheck size={24} />}
          />
        </Card>}
  </DetectionFrame>;
}

function LatestDetectionSummary({ detection, brandName }: { detection: Detection; brandName: string }) {
  const summary = summaryForDetection(detection, detection.subjectName || brandName);
  return <Card
    className="section-gap"
    title="最近一次GEO检测摘要"
    description={`${new Date(detection.completedAt || detection.createdAt).toLocaleString("zh-CN")} · ${brandName}`}
    action={<div className="page-actions">
      <Link className="btn btn-primary btn-sm" href={`/geo/results/${detection.id}`}>查看检测结果</Link>
      <Link className="btn btn-sm" href="/geo/records">查看记录</Link>
    </div>}
  >
    <div className="grid grid-4 analysis-summary-grid">
      <SummaryMetric label="有效回答" value={`${summary.validCount}/${summary.requestedCount}`} tone="blue" />
      <SummaryMetric label="出现率" value={ratioText(summary.mentionedAnswerCount, summary.validCount)} tone="purple" />
      <SummaryMetric label="自然出现率" value={summary.naturalEligibleCount ? ratioText(summary.naturalMentionedCount, summary.naturalEligibleCount) : "暂无"} tone="green" />
      <SummaryMetric label="风险信号回答" value={`${summary.riskSignalCounts.cautious_description + summary.riskSignalCounts.negative_counterexample}`} tone="orange" />
    </div>
    {summary.findings[0] && <div className="notice analysis-static-summary"><Info size={17} />{summary.findings[0].text}</div>}
  </Card>;
}

function SummaryMetric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className={`analysis-summary-item tone-${tone}`}>
    <span>{label}</span>
    <strong>{value}</strong>
  </div>;
}

export function DetectionRecordsView() {
  const router = useRouter();
  const { detections } = useDetectionData();
  const retryDetection = useAppStore((state) => state.retryDetection);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const retry = async (id: string) => {
    if (retryingId) return;
    setRetryingId(id);
    await retryDetection(id);
    router.push(`/geo/progress/${id}`);
  };

  return <DetectionFrame
    title="检测记录"
    description="查看每次检测的执行、回答和分析状态。"
    actions={<Link className="btn btn-primary" href="/geo/new"><Plus size={16} />发起最新检测</Link>}
  >
    <Card>
      {detections.length
        ? <div className="table-wrap"><table className="table">
            <thead><tr><th>检测时间</th><th>检测对象</th><th>AI平台</th><th>问题数</th><th>有效回答</th><th>出现回答</th><th>风险信号</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>{detections.map((item) => {
              const completed = isDetectionFlowComplete(item);
              const summary = item.resultSummary;
              return <tr key={item.id}>
              <td><strong>{new Date(item.createdAt).toLocaleString("zh-CN")}</strong></td>
              <td>{item.subjectName || "品牌"}</td>
              <td>{item.providers.map((provider) => providerNames[provider]).join("、")}</td>
              <td>{item.questionIds.length}</td>
              <td>{summary?.validCount ?? item.results.length}</td>
              <td>{summary?.mentionedAnswerCount ?? "—"}</td>
              <td>{summary ? summary.riskSignalCounts.cautious_description + summary.riskSignalCounts.negative_counterexample : "—"}</td>
              <td><Badge tone={completed ? item.status === "partial" ? "warning" : "success" : "warning"}>{completed ? item.status === "partial" ? "部分完成" : "完成" : "未完成"}</Badge></td>
              <td><div className="table-row-action detection-record-actions">
                {item.results.length > 0 && <Link className="btn btn-sm" href={`/geo/results/${item.id}`}>结果</Link>}
                {(!completed || item.status === "partial") && <Button size="sm" disabled={retryingId === item.id} onClick={() => void retry(item.id)}><RefreshCw size={14} />{retryingId === item.id ? "重试中…" : "重试"}</Button>}
              </div></td>
            </tr>})}</tbody>
          </table></div>
        : <EmptyState
            title="暂无检测记录"
            description="发起首次检测后，执行状态和结果会保存在这里。"
            action={<Link className="btn btn-primary" href="/geo/new">开始首次检测</Link>}
            icon={<History size={24} />}
          />}
    </Card>
  </DetectionFrame>;
}

function isDetectionFlowComplete(detection: Detection) {
  const currentFlowComplete = (detection.status === "completed" || detection.status === "partial")
    && detection.results.length > 0
    && Boolean(detection.resultSummary);
  const legacyFlowComplete = detection.status === "completed"
    && detection.results.length > 0
    && Boolean(detection.diagnosis);
  return currentFlowComplete || legacyFlowComplete;
}

export function DetectionProgressView() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const detection = useAppStore((state) => state.detections.find((item) => item.id === params.id));
  const advance = useAppStore((state) => state.advanceDetection);
  const retry = useAppStore((state) => state.retryDetection);
  const [retrying, setRetrying] = useState(false);
  const retryCurrent = async () => {
    if (!detection || retrying) return;
    setRetrying(true);
    await retry(detection.id);
    setRetrying(false);
  };

  useEffect(() => {
    if (!detection || detection.status !== "running" || detection.serverManaged) return;
    const timer = window.setInterval(() => advance(detection.id), 650);
    return () => window.clearInterval(timer);
  }, [advance, detection]);

  useEffect(() => {
    if (!detection || !isDetectionFlowComplete(detection)) return;
    const timer = window.setTimeout(() => router.replace(`/geo/results/${detection.id}`), 800);
    return () => window.clearTimeout(timer);
  }, [detection, router]);

  if (!detection) return <><PageHeader title="检测进度" description="查看检测任务执行状态。" back /><Card><EmptyState title="未找到检测任务" description="该检测任务不存在。" /></Card></>;
  const collectionTotal = detection.collectionTotal || detection.providers.length * detection.questionIds.length;
  const collectionErrors = (detection.runErrors || []).filter(
    (item) => item.questionId !== "__analysis__" && item.questionId !== "__task__",
  );
  const collectionCompleted = Math.min(
    collectionTotal,
    detection.collectionCompleted ?? detection.results.length + collectionErrors.length,
  );
  const collectionPercent = collectionTotal ? Math.round(collectionCompleted / collectionTotal * 100) : 0;
  const collectionSucceeded = collectionCompleted === collectionTotal && collectionErrors.length === 0;
  const analysisTotal = detection.analysisTotal || detection.questionIds.length;
  const analysisCompleted = Math.min(
    analysisTotal,
    detection.analysisCompleted ?? new Set(detection.results.filter((item) => item.analysisModel).map((item) => item.questionId)).size,
  );
  const analysisPercent = analysisTotal ? Math.round(analysisCompleted / analysisTotal * 100) : 0;
  const analysisComplete = analysisCompleted === analysisTotal;
  const aggregationComplete = Boolean(detection.resultSummary || detection.diagnosis);
  const analysisSkipped = detection.status === "failed" && detection.results.length === 0;
  const finished = isDetectionFlowComplete(detection);
  const processing = detection.status === "pending" || detection.status === "running";
  const canRetry = !processing && !finished;
  const inconsistentTerminalState = detection.status === "completed" && !finished;
  const statusLabel = finished ? detection.status === "partial" ? "部分完成" : "已完成" : detection.status === "pending" ? "排队中" : detection.status === "running" ? "检测中" : "未完成";
  const analysisLabel = analysisComplete ? "100%" : analysisSkipped ? "未执行" : detection.stage === "failed" ? "失败" : detection.stage === "analyzing" ? `${analysisPercent}%` : detection.stage === "aggregating" ? "汇总中" : "等待中";
  const failureMessage = detection.runErrors?.[0]?.message;
  return <>
    {detection.serverManaged && <LiveDetectionRunner key={`${detection.id}:${detection.attempt || 1}:${detection.status}`} detectionId={detection.id} />}
    <PageHeader
      title="检测进度"
      description="系统将依次采集AI回答、逐条处理并汇总检测结果；完成后自动进入结果页。"
      actions={<Badge tone={finished ? "success" : processing ? "primary" : "warning"}>{statusLabel}</Badge>}
      back
    />
    <div className="stack">
      <Card>
        <div className="detection-stage-row">
          <span className="empty-icon">{collectionSucceeded ? <CheckCircle2 size={24} /> : collectionPercent === 100 ? <Info size={24} /> : <LoaderCircle size={24} className="spin" />}</span>
          <div>
            <div><strong>第一阶段：采集AI回答</strong><strong>{collectionErrors.length ? `${collectionErrors.length} 个失败` : `${collectionPercent}%`}</strong></div>
            <Progress value={collectionPercent} success={collectionSucceeded} />
            <small>{collectionCompleted}/{collectionTotal} 个问题与平台组合已处理{collectionErrors.length ? ` · ${detection.results.length} 个成功` : ""}</small>
          </div>
        </div>
      </Card>
      <Card>
        <div className="detection-stage-row">
          <span className="empty-icon">{analysisComplete ? <CheckCircle2 size={24} /> : detection.stage === "analyzing" ? <LoaderCircle size={24} className="spin" /> : <BarChart3 size={24} />}</span>
          <div>
            <div><strong>第二阶段：逐条处理</strong><strong>{analysisLabel}</strong></div>
            <Progress value={analysisComplete ? 100 : analysisPercent} success={analysisComplete} />
            <small>{analysisSkipped ? "因AI回答采集失败，本阶段未执行" : detection.progressMessage || `${analysisCompleted}/${analysisTotal} 个问题已完成分析`}</small>
          </div>
        </div>
      </Card>
      <Card>
        <div className="detection-stage-row">
          <span className="empty-icon">{aggregationComplete ? <CheckCircle2 size={24} /> : detection.stage === "aggregating" ? <LoaderCircle size={24} className="spin" /> : <BarChart3 size={24} />}</span>
          <div>
            <div><strong>第三阶段：汇总检测结果</strong><strong>{aggregationComplete ? "100%" : detection.stage === "failed" ? "失败" : detection.stage === "aggregating" ? "进行中" : "等待中"}</strong></div>
            <Progress value={aggregationComplete ? 100 : 0} success={aggregationComplete} />
            <small>{aggregationComplete ? "出现情况、呈现位置、引用来源和风险信号已汇总" : detection.stage === "aggregating" ? detection.progressMessage || "正在汇总本次检测结果" : "完成逐条处理后自动执行"}</small>
          </div>
        </div>
      </Card>
    </div>
    {processing && <div className="notice section-gap"><Info size={17} />检测由服务端持续执行，可以离开或关闭当前页面，稍后在检测记录中查看结果。</div>}
    {inconsistentTerminalState && !failureMessage && <div className="notice notice-warning section-gap"><Info size={17} />检测流程未完整完成，请重新执行。</div>}
    {failureMessage && <div className="notice notice-warning section-gap"><Info size={17} /><div><strong>检测执行失败</strong><div className="small" style={{ marginTop: 5 }}>{failureMessage}</div></div></div>}
    <div className="form-actions" style={{ marginTop: 18 }}>
      {canRetry && <Button disabled={retrying} onClick={() => void retryCurrent()}><RefreshCw size={16} />{retrying ? "重试中…" : "重试"}</Button>}
      {finished && <Badge tone="success">即将自动进入检测结果</Badge>}
    </div>
  </>;
}

export function DetectionResultsView() {
  const params = useParams<{ id: string }>();
  const query = useSearchParams();
  const detection = useAppStore((state) => state.detections.find((item) => item.id === params.id));
  const brand = useAppStore((state) => state.brands.find((item) => item.id === detection?.brandId));
  const [provider, setProvider] = useState(query.get("provider") || "all");
  const [question, setQuestion] = useState("all");
  const [appearance, setAppearance] = useState("all");
  const [presentationRole, setPresentationRole] = useState<PresentationRole | "all">("all");
  const [riskSignal, setRiskSignal] = useState<RiskSignal | "all">("all");
  const [sourceCategory, setSourceCategory] = useState<CitationSourceCategory | "all">("all");
  const [showAll, setShowAll] = useState(false);
  const [expandedAnswers, setExpandedAnswers] = useState<string[]>([]);
  if (!detection || !brand) return <EmptyState title="未找到检测结果" description="该检测记录不存在。" />;

  const subjectName = detection.subjectName || brand.name;
  const summary = summaryForDetection(detection, subjectName);
  const results = detection.results.filter((item) =>
    (provider === "all" || item.provider === provider)
    && (question === "all" || item.questionId === question)
    && (appearance === "all" || isTargetMentioned(item) === (appearance === "mentioned"))
    && (presentationRole === "all" || normalizedPresentationRole(item) === presentationRole)
    && (riskSignal === "all" || item.riskSignal === riskSignal)
    && (sourceCategory === "all" || item.citations.some((citation) => citation.sourceCategory === sourceCategory)),
  );
  const visibleResults = showAll ? results : results.slice(0, 10);
  const questionText = (id: string) =>
    detection.results.find((item) => item.questionId === id)?.questionSnapshot
    || brand.questions.find((item) => item.id === id)?.text
    || "检测问题";
  const toggleAnswer = (id: string) =>
    setExpandedAnswers((old) => old.includes(id) ? old.filter((item) => item !== id) : [...old, id]);
  const clearSemanticFilters = () => {
    setAppearance("all");
    setPresentationRole("all");
    setRiskSignal("all");
    setSourceCategory("all");
  };
  const scrollToDetails = () => window.requestAnimationFrame(() => {
    document.getElementById("geo-answer-details")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  const filterByAppearance = (mentioned: boolean) => {
    clearSemanticFilters();
    setAppearance(mentioned ? "mentioned" : "unmentioned");
    scrollToDetails();
  };
  const filterByRole = (role: PresentationRole) => {
    clearSemanticFilters();
    setPresentationRole(role);
    scrollToDetails();
  };
  const filterByRisk = (risk: RiskSignal) => {
    clearSemanticFilters();
    setRiskSignal(risk);
    scrollToDetails();
  };
  const filterBySource = (category: CitationSourceCategory) => {
    clearSemanticFilters();
    setSourceCategory(category);
    scrollToDetails();
  };

  return <>
    <PageHeader
      title="GEO检测结果"
      description={`${subjectName} · ${new Date(detection.completedAt || detection.createdAt).toLocaleString("zh-CN")} · ${detection.providers.length}个AI平台`}
      actions={<div className="page-actions"><Link className="btn" href="/geo/records">检测记录</Link><Link className="btn btn-primary" href="/geo/new">重新检测</Link></div>}
      back
    />
    {summary.failedCount > 0 && <div className="notice notice-warning" style={{ marginBottom: 18 }}><Info size={17} />本次有{summary.failedCount}个回答采集失败，以下统计仅基于{summary.validCount}个有效回答。可在检测记录中重试失败项。</div>}
    <div className="grid grid-4">
      <SummaryMetric label="有效回答" value={`${summary.validCount}/${summary.requestedCount}`} tone="blue" />
      <SummaryMetric label="出现回答" value={`${summary.mentionedAnswerCount}/${summary.validCount} · ${ratioText(summary.mentionedAnswerCount, summary.validCount)}`} tone="purple" />
      <SummaryMetric label="自然出现" value={summary.naturalEligibleCount ? `${summary.naturalMentionedCount}/${summary.naturalEligibleCount} · ${ratioText(summary.naturalMentionedCount, summary.naturalEligibleCount)}` : "暂无可计算"} tone="green" />
      <SummaryMetric label="累计出现" value={`${summary.totalMentionCount}次`} tone="orange" />
    </div>

    <div className="grid grid-2 section-gap geo-distribution-grid">
      <DistributionCard title="出现分布" denominatorLabel="有效回答" items={[
        { key: "mentioned", label: "出现", value: summary.mentionedAnswerCount, color: "#12b76a", onClick: () => filterByAppearance(true) },
        { key: "unmentioned", label: "未出现", value: summary.unmentionedAnswerCount, color: "#98a2b3", onClick: () => filterByAppearance(false) },
      ]} />
      <DistributionCard title="呈现位置分布" denominatorLabel="出现检测对象的回答" emptyText="没有出现检测对象，暂无呈现位置数据" items={presentationRoleOptions.filter((item) => item.key !== "not_mentioned").map((item) => ({
        ...item,
        value: summary.presentationRoleCounts[item.key],
        onClick: () => filterByRole(item.key),
      }))} />
      <DistributionCard title="相关回答引用来源" denominatorLabel="独立引用URL" emptyText={summary.mentionedAnswerCount ? "相关回答未提供外部引用" : "没有出现检测对象，暂无相关引用来源"} items={sourceCategoryOptions.map((item) => ({
        ...item,
        value: summary.sourceCategoryCounts[item.key],
        onClick: () => filterBySource(item.key),
      }))} />
      <DistributionCard title="风险信号分布" denominatorLabel="出现检测对象的回答" emptyText={summary.mentionedAnswerCount ? "该历史检测未采集风险信号" : "没有出现检测对象，暂无风险信号数据"} items={riskSignalOptions.map((item) => ({
        ...item,
        value: summary.riskSignalCounts[item.key],
        onClick: () => filterByRisk(item.key),
      }))} />
    </div>

    <Card className="section-gap" title="关键发现" description="以下结论由固定统计规则生成，可追溯到本次回答。">
      {summary.findings.length ? <div className="geo-findings">{summary.findings.map((finding, index) => <button key={finding.id} type="button" onClick={() => {
        if (finding.filter?.targetMentioned !== undefined) filterByAppearance(finding.filter.targetMentioned);
        else if (finding.filter?.presentationRole) filterByRole(finding.filter.presentationRole);
        else if (finding.filter?.riskSignal) filterByRisk(finding.filter.riskSignal);
        else if (finding.filter?.sourceCategory) filterBySource(finding.filter.sourceCategory);
      }}><span>{index + 1}</span><strong>{finding.text}</strong></button>)}</div>
      : <EmptyState title="暂无关键发现" description="本次没有可汇总的有效回答。" />}
    </Card>

    <Card className="section-gap" title="回答明细筛选" description="筛选只影响下方明细，不改变顶部完整批次统计。">
      <div className="geo-result-filters">
        <Field label="AI平台">
          <select className="select" value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="all">全部平台</option>
            {detection.providers.map((item) => <option key={item} value={item}>{providerNames[item]}</option>)}
          </select>
        </Field>
        <Field label="检测问题">
          <select className="select" value={question} onChange={(event) => setQuestion(event.target.value)}>
            <option value="all">全部问题</option>
            {detection.questionIds.map((id) => <option key={id} value={id}>{questionText(id)}</option>)}
          </select>
        </Field>
        <Field label="出现状态"><select className="select" value={appearance} onChange={(event) => setAppearance(event.target.value)}><option value="all">全部</option><option value="mentioned">出现</option><option value="unmentioned">未出现</option></select></Field>
        <Field label="呈现位置"><select className="select" value={presentationRole} onChange={(event) => setPresentationRole(event.target.value as PresentationRole | "all")}><option value="all">全部</option>{presentationRoleOptions.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</select></Field>
        <Field label="风险信号"><select className="select" value={riskSignal} onChange={(event) => setRiskSignal(event.target.value as RiskSignal | "all")}><option value="all">全部</option>{riskSignalOptions.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</select></Field>
        <Field label="引用来源"><select className="select" value={sourceCategory} onChange={(event) => setSourceCategory(event.target.value as CitationSourceCategory | "all")}><option value="all">全部</option>{sourceCategoryOptions.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</select></Field>
        <div className="geo-filter-reset"><Button size="sm" onClick={() => { setProvider("all"); setQuestion("all"); clearSemanticFilters(); }}>清除筛选</Button></div>
      </div>
    </Card>

    <Card id="geo-answer-details" className="section-gap" title={`问题与回答明细（${results.length}）`} description="默认展示10条，展开后可查看判断依据、引用来源和竞品提及。">
      {visibleResults.length
        ? <div className="detection-answer-list">{visibleResults.map((result, index) => {
            const expanded = expandedAnswers.includes(result.id);
            const mentioned = isTargetMentioned(result);
            const role = normalizedPresentationRole(result);
            return <article className="detection-answer-card" key={result.id}>
              <div className="detection-answer-heading">
                <span className="detection-answer-index">{index + 1}</span>
                <div>
                  <h3>{questionText(result.questionId)}</h3>
                  <div className="detection-answer-badges">
                    <Badge tone="primary">{providerNames[result.provider]}</Badge>
                    <Badge tone={mentioned ? "success" : "default"}>{mentioned ? "出现检测对象" : "未出现"}</Badge>
                    <Badge tone={role === "negative_counterexample" ? "danger" : role === "risk_warning" ? "warning" : "default"}>{presentationRoleLabel(role)}</Badge>
                    {result.riskSignal && <Badge tone={result.riskSignal === "negative_counterexample" ? "danger" : result.riskSignal === "cautious_description" ? "warning" : "success"}>{riskSignalLabel(result.riskSignal)}</Badge>}
                    <Badge>{result.citations.length}个引用</Badge>
                  </div>
                </div>
              </div>
              <div className={`detection-raw-answer ${expanded ? "expanded" : ""}`}>{result.answer}</div>
              {expanded && <div className="geo-answer-analysis">
                <div><span>呈现位置依据</span><p>{result.presentationEvidence || result.recommendationEvidence || "没有单独的语义依据，仅确认名称出现。"}</p></div>
                <div><span>风险信号依据</span><p>{result.riskSignal === "none_detected" ? "本次回答中未识别到谨慎或负向风险信号。" : result.riskEvidence || "暂无有效依据。"}</p></div>
                <div className="geo-answer-sources"><span>引用来源</span>{result.citations.length ? <ul>{result.citations.map((citation) => <li key={citation.id}><Badge>{sourceCategoryLabel(citation.sourceCategory || "unknown")}</Badge>{/^https?:\/\//i.test(citation.url) ? <a href={citation.url} target="_blank" rel="noreferrer">{citation.title || citation.url}</a> : <span>{citation.title || citation.url}</span>}</li>)}</ul> : <p>该回答未提供外部引用。</p>}</div>
                {result.competitorMentions.length > 0 && <div><span>辅助信息</span><p>提及竞品：{result.competitorMentions.join("、")}</p></div>}
              </div>}
              <Button size="sm" variant="ghost" onClick={() => toggleAnswer(result.id)}>
                {expanded ? <><ChevronUp size={15} />收起回答</> : <><ChevronDown size={15} />展开完整回答</>}
              </Button>
            </article>;
          })}</div>
        : <EmptyState title="暂无匹配结果" description="调整筛选条件后重试。" icon={<FileSearch size={24} />} />}
      {results.length > 10 && <div className="detection-expand-all">
        <Button onClick={() => setShowAll(!showAll)}>
          {showAll ? <><ChevronUp size={16} />收起其余结果</> : <><ChevronDown size={16} />加载其余 {results.length - 10} 条</>}
        </Button>
      </div>}
    </Card>
  </>;
}

const presentationRoleOptions: Array<{ key: PresentationRole; label: string; color: string }> = [
  { key: "top_recommendation", label: "首位推荐", color: "#12b76a" },
  { key: "alternative", label: "备选方案", color: "#6172f3" },
  { key: "general_mention", label: "一般提及", color: "#98a2b3" },
  { key: "risk_warning", label: "风险提醒", color: "#f79009" },
  { key: "negative_counterexample", label: "负向反例", color: "#f04438" },
  { key: "not_mentioned", label: "未出现", color: "#d0d5dd" },
];

const riskSignalOptions: Array<{ key: RiskSignal; label: string; color: string }> = [
  { key: "none_detected", label: "未发现风险信号", color: "#12b76a" },
  { key: "cautious_description", label: "谨慎描述", color: "#f79009" },
  { key: "negative_counterexample", label: "负向反例", color: "#f04438" },
];

const sourceCategoryOptions: Array<{ key: CitationSourceCategory; label: string; color: string }> = [
  { key: "industry_association", label: "行业协会", color: "#7f56d9" },
  { key: "authoritative_media", label: "权威媒体", color: "#2e90fa" },
  { key: "research_institution", label: "研究机构", color: "#6172f3" },
  { key: "standards_organization", label: "标准组织", color: "#06aed4" },
  { key: "trusted_platform", label: "高可信平台", color: "#12b76a" },
  { key: "brand_official", label: "品牌官方", color: "#f79009" },
  { key: "other", label: "其他", color: "#98a2b3" },
  { key: "unknown", label: "无法判断", color: "#d0d5dd" },
];

function DistributionCard({
  title,
  denominatorLabel,
  emptyText = "暂无可用于统计的数据",
  items,
}: {
  title: string;
  denominatorLabel: string;
  emptyText?: string;
  items: Array<{ key: string; label: string; value: number; color: string; onClick: () => void }>;
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return <Card title={title} description={`统计口径：${denominatorLabel}`}>
    {total ? <div className="geo-distribution-list">{items.filter((item) => item.value > 0).map((item) => <button type="button" key={item.key} onClick={item.onClick}>
      <span className="geo-distribution-label"><i style={{ background: item.color }} />{item.label}</span>
      <span className="geo-distribution-track"><i style={{ width: `${item.value / total * 100}%`, background: item.color }} /></span>
      <strong>{item.value}</strong><em>{ratioText(item.value, total)}</em>
    </button>)}</div> : <EmptyState title={emptyText} description="完成新的GEO检测后将按固定口径展示。" icon={<CircleDot size={24} />} />}
  </Card>;
}

function PlatformCoverage({ detection }: { detection: Detection }) {
  const rows = detection.providers.map((provider) => {
    const results = detection.results.filter((result) => result.provider === provider);
    const mentioned = results.filter(isTargetMentioned).length;
    return { provider, total: results.length, mentioned };
  });
  if (!rows.some((item) => item.total)) return <EmptyState title="暂无平台检测数据" description="完成检测后展示各平台出现率。" />;
  return <div className="geo-platform-coverage">{rows.map((item) => <div key={item.provider}>
    <div><strong>{providerNames[item.provider]}</strong><span>{item.mentioned}/{item.total} · {ratioText(item.mentioned, item.total)}</span></div>
    <Progress value={item.total ? item.mentioned / item.total * 100 : 0} success={item.mentioned === item.total && item.total > 0} />
  </div>)}</div>;
}

function summaryForDetection(detection: Detection, subjectName: string): GeoDetectionSummary {
  return detection.resultSummary || buildGeoDetectionSummary({
    results: detection.results,
    requestedCount: detection.collectionTotal || detection.providers.length * detection.questionIds.length,
    failedCount: detection.failedRuns,
    subjectName,
  });
}

function presentationRoleLabel(role: PresentationRole) {
  return presentationRoleOptions.find((item) => item.key === role)?.label || "一般提及";
}

function riskSignalLabel(signal: RiskSignal) {
  return riskSignalOptions.find((item) => item.key === signal)?.label || "未发现风险信号";
}

function sourceCategoryLabel(category: CitationSourceCategory) {
  return sourceCategoryOptions.find((item) => item.key === category)?.label || "无法判断";
}

function ratioText(value: number, total: number) {
  return total ? `${Number((value / total * 100).toFixed(1))}%` : "—";
}

function DonutChart({
  items,
  emptyText,
}: {
  items: { label: string; value: number; color: string }[];
  emptyText: string;
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!total) return <EmptyState title={emptyText} description="当前没有可用于占比统计的数据。" icon={<CircleDot size={24} />} />;
  const segments = items.filter((item) => item.value > 0).reduce<{ parts: string[]; cursor: number }>((state, item) => {
    const end = state.cursor + item.value / total * 360;
    return { parts: [...state.parts, `${item.color} ${state.cursor}deg ${end}deg`], cursor: end };
  }, { parts: [], cursor: 0 }).parts;
  return <div className="donut-layout">
    <div className="donut-chart" style={{ background: `conic-gradient(${segments.join(",")})` }}>
      <div><strong>{total}</strong><span>合计</span></div>
    </div>
    <div className="donut-legend">{items.filter((item) => item.value > 0).map((item) => <div key={item.label}>
      <span className="legend-dot" style={{ background: item.color }} />
      <span>{item.label}</span>
      <strong>{item.value}</strong>
      <em>{Math.round(item.value / total * 100)}%</em>
    </div>)}</div>
  </div>;
}

function providerColor(provider: ProviderId) {
  if (provider === "doubao") return "#4f46e5";
  if (provider === "deepseek") return "#12b76a";
  return "#f79009";
}
