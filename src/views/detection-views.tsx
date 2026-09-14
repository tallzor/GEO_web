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
  detectionAnalysisSummary,
  detectionSummary,
  platformMetrics,
} from "@/lib/detection-metrics";
import { currentBrand, useAppStore } from "@/lib/store";
import type { Detection, ProviderId } from "@/lib/types";
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
      <Card title="最近一次各平台品牌提及占比" description={latest ? "按最近一次检测中品牌出现次数统计" : "完成检测后自动生成"}>
        {latest
          ? <DonutChart
              items={platformMetrics(latest).map((item) => ({
                label: item.name,
                value: item.brandOccurrences,
                color: providerColor(item.provider),
              }))}
              emptyText="最近一次检测未发现品牌提及"
            />
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
  const brand = useAppStore((state) => state.brands.find((item) => item.id === detection.brandId));
  if (!brand) return null;
  const summary = detectionAnalysisSummary(detection, brand);
  return <Card
    className="section-gap"
    title="最近一次检测分析摘要"
    description={`${new Date(detection.completedAt || detection.createdAt).toLocaleString("zh-CN")} · ${brandName}`}
    action={<div className="page-actions">
      <Link className="btn btn-sm" href={`/geo/results/${detection.id}`}>查看结果</Link>
      <Link className="btn btn-sm" href="/geo/records">查看记录</Link>
      <Link className="btn btn-primary btn-sm" href={`/analysis/visibility?detection=${detection.id}`}>进入分析</Link>
    </div>}
  >
    <div className="grid grid-4 analysis-summary-grid">
      <SummaryMetric label="能见" value={summary.display.visibility} tone="blue" />
      <SummaryMetric label="排名" value={summary.display.ranking} tone="purple" />
      <SummaryMetric label="口碑" value={summary.display.reputation} tone="green" />
      <SummaryMetric label="情感" value={summary.display.sentiment} tone="orange" />
    </div>
    {detection.diagnosis?.summary && <div className="notice analysis-static-summary"><Info size={17} />{detection.diagnosis.summary}</div>}
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
            <thead><tr><th>检测时间</th><th>AI平台</th><th>问题数</th><th>有效回答</th><th>失败数</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>{detections.map((item) => {
              const completed = isDetectionFlowComplete(item);
              return <tr key={item.id}>
              <td><strong>{new Date(item.createdAt).toLocaleString("zh-CN")}</strong></td>
              <td>{item.providers.map((provider) => providerNames[provider]).join("、")}</td>
              <td>{item.questionIds.length}</td>
              <td>{item.results.length}</td>
              <td>{item.failedRuns}</td>
              <td><Badge tone={completed ? "success" : "warning"}>{completed ? "完成" : "未完成"}</Badge></td>
              <td><div className="table-row-action detection-record-actions">
                {item.results.length > 0 && <Link className="btn btn-sm" href={`/geo/results/${item.id}`}>结果</Link>}
                {completed && <Link className="btn btn-ghost btn-sm" href={`/analysis/visibility?detection=${item.id}`}>分析</Link>}
                {!completed && <Button size="sm" disabled={retryingId === item.id} onClick={() => void retry(item.id)}><RefreshCw size={14} />{retryingId === item.id ? "重试中…" : "重试"}</Button>}
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
  const expectedResults = detection.providers.length * detection.questionIds.length;
  return detection.status === "completed"
    && expectedResults > 0
    && detection.results.length === expectedResults
    && detection.failedRuns === 0
    && Boolean(detection.diagnosis?.summary.trim());
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
  const aggregationComplete = Boolean(detection.diagnosis?.summary.trim());
  const analysisSkipped = detection.status === "failed" && detection.results.length === 0;
  const finished = isDetectionFlowComplete(detection);
  const processing = detection.status === "pending" || detection.status === "running";
  const canRetry = !processing && !finished;
  const inconsistentTerminalState = detection.status === "completed" && !finished;
  const statusLabel = finished ? "已完成" : detection.status === "pending" ? "排队中" : detection.status === "running" ? "检测中" : "未完成";
  const analysisLabel = analysisComplete ? "100%" : analysisSkipped ? "未执行" : detection.stage === "failed" ? "失败" : detection.stage === "analyzing" ? `${analysisPercent}%` : detection.stage === "aggregating" ? "汇总中" : "等待中";
  const failureMessage = detection.runErrors?.[0]?.message;
  return <>
    {detection.serverManaged && <LiveDetectionRunner key={`${detection.id}:${detection.attempt || 1}:${detection.status}`} detectionId={detection.id} />}
    <PageHeader
      title="检测进度"
      description="系统将先采集AI回答，再完成单批次分析；完成后自动进入结果页。"
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
            <div><strong>第二阶段：整理与分析</strong><strong>{analysisLabel}</strong></div>
            <Progress value={analysisComplete ? 100 : analysisPercent} success={analysisComplete} />
            <small>{analysisSkipped ? "因AI回答采集失败，本阶段未执行" : detection.progressMessage || `${analysisCompleted}/${analysisTotal} 个问题已完成分析`}</small>
          </div>
        </div>
      </Card>
      <Card>
        <div className="detection-stage-row">
          <span className="empty-icon">{aggregationComplete ? <CheckCircle2 size={24} /> : detection.stage === "aggregating" ? <LoaderCircle size={24} className="spin" /> : <BarChart3 size={24} />}</span>
          <div>
            <div><strong>第三阶段：汇总结论</strong><strong>{aggregationComplete ? "100%" : detection.stage === "failed" ? "失败" : detection.stage === "aggregating" ? "进行中" : "等待中"}</strong></div>
            <Progress value={aggregationComplete ? 100 : 0} success={aggregationComplete} />
            <small>{aggregationComplete ? "能见、排名、口碑、情感四个维度已汇总" : detection.stage === "aggregating" ? detection.progressMessage || "正在汇总四个维度的分析结论" : "完成逐题分析后自动执行"}</small>
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
  const [showAll, setShowAll] = useState(false);
  const [expandedAnswers, setExpandedAnswers] = useState<string[]>([]);
  if (!detection || !brand) return <EmptyState title="未找到检测结果" description="该检测记录不存在。" />;

  const results = detection.results.filter((item) =>
    (provider === "all" || item.provider === provider)
    && (question === "all" || item.questionId === question),
  );
  const visibleResults = showAll ? results : results.slice(0, 2);
  const summary = detectionSummary(detection, brand);
  const questionText = (id: string) =>
    detection.results.find((item) => item.questionId === id)?.questionSnapshot
    || brand.questions.find((item) => item.id === id)?.text
    || "检测问题";
  const toggleAnswer = (id: string) =>
    setExpandedAnswers((old) => old.includes(id) ? old.filter((item) => item !== id) : [...old, id]);

  return <>
    <PageHeader
      title="检测结果明细"
      description="查看本次检测的核心统计、检测问题和AI平台原始回答。"
      actions={detection.diagnosis
        ? <Link className="btn btn-primary" href={`/analysis/visibility?detection=${detection.id}`}>进入分析</Link>
        : undefined}
      back
    />
    <div className="grid grid-4">
      <SummaryMetric label="品牌出现次数" value={`${summary.brandOccurrences}`} tone="blue" />
      <SummaryMetric label="首次出现次数" value={`${summary.firstPlaceAppearances}`} tone="purple" />
      <SummaryMetric label="推荐次数" value={`${summary.recommendations}`} tone="green" />
      <SummaryMetric label="竞品提及数" value={`${summary.competitorMentions}`} tone="orange" />
    </div>

    <Card className="section-gap">
      <div className="form-row">
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
      </div>
    </Card>

    <Card className="section-gap" title={`问题与原始回答（${results.length}）`} description="默认展示2条，可展开查看全部结果。">
      {visibleResults.length
        ? <div className="detection-answer-list">{visibleResults.map((result, index) => {
            const expanded = expandedAnswers.includes(result.id);
            return <article className="detection-answer-card" key={result.id}>
              <div className="detection-answer-heading">
                <span className="detection-answer-index">{index + 1}</span>
                <div>
                  <h3>{questionText(result.questionId)}</h3>
                  <div className="detection-answer-badges">
                    <Badge tone="primary">{providerNames[result.provider]}</Badge>
                    <Badge tone={result.brandMentioned ? "success" : "default"}>{result.brandMentioned ? "提及品牌" : "未提及品牌"}</Badge>
                    {result.recommended && <Badge tone="success">形成推荐</Badge>}
                  </div>
                </div>
              </div>
              <div className={`detection-raw-answer ${expanded ? "expanded" : ""}`}>{result.answer}</div>
              <Button size="sm" variant="ghost" onClick={() => toggleAnswer(result.id)}>
                {expanded ? <><ChevronUp size={15} />收起回答</> : <><ChevronDown size={15} />展开完整回答</>}
              </Button>
            </article>;
          })}</div>
        : <EmptyState title="暂无匹配结果" description="调整筛选条件后重试。" icon={<FileSearch size={24} />} />}
      {results.length > 2 && <div className="detection-expand-all">
        <Button onClick={() => setShowAll(!showAll)}>
          {showAll ? <><ChevronUp size={16} />收起其余结果</> : <><ChevronDown size={16} />展开全部 {results.length} 条</>}
        </Button>
      </div>}
    </Card>
  </>;
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
