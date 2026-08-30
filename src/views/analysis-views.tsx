"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BarChart3,
  ChevronRight,
  FileSearch,
  Lightbulb,
  Medal,
  MessageSquareText,
  Trophy,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ModuleNav } from "@/components/module-nav";
import { OperationProgress } from "@/components/operation-progress";
import { Badge, Button, Card, EmptyState, Modal, Toast } from "@/components/ui";
import {
  citationMetrics,
  competitorMetrics,
  completedDetectionsForBrand,
  detectionAnalysisSummary,
  detectionSummary,
  rankingMetrics,
  reputationTopics,
  sentimentMetrics,
} from "@/lib/detection-metrics";
import { activeCycle, currentBrand, useAppStore } from "@/lib/store";
import { readDetectionResponse } from "@/lib/detection-client";
import type { Brand, Detection } from "@/lib/types";
import { providerNames } from "@/lib/types";

const analysisNav = [
  { href: "/analysis/visibility", label: "能见&排名" },
  { href: "/analysis/reputation", label: "口碑分析" },
  { href: "/analysis/competitors", label: "竞品透视" },
];

function useAnalysisBatch() {
  const router = useRouter();
  const query = useSearchParams();
  const brand = useAppStore(currentBrand);
  const allDetections = useAppStore((state) => state.detections);
  const detections = useMemo(
    () => brand ? completedDetectionsForBrand(allDetections, brand.id).filter((item) => item.diagnosis) : [],
    [allDetections, brand],
  );
  const requestedId = query.get("detection");
  const detection = requestedId
    ? detections.find((item) => item.id === requestedId)
    : detections[0];
  const chooseDetection = (id: string) => {
    const params = new URLSearchParams(query.toString());
    params.set("detection", id);
    router.replace(`?${params.toString()}`);
  };
  return { brand, detections, detection, chooseDetection, requestedId };
}

function AnalysisFrame({
  description,
  children,
}: {
  description: string;
  children: (context: { brand: Brand; detection: Detection }) => React.ReactNode;
}) {
  const { brand, detections, detection, chooseDetection, requestedId } = useAnalysisBatch();
  const selectedDetectionId = detection?.id || requestedId;
  const analysisNavForBatch = selectedDetectionId
    ? analysisNav.map((item) => ({ ...item, href: `${item.href}?detection=${encodeURIComponent(selectedDetectionId)}` }))
    : analysisNav;
  if (!brand) return null;
  return <>
    <header className="analysis-page-header">
      <h1>分析</h1>
      {detection
        ? <div className="analysis-page-controls">
            <label htmlFor="analysis-detection">检测时间</label>
            <select
              id="analysis-detection"
              className="select"
              value={detection.id}
              onChange={(event) => chooseDetection(event.target.value)}
            >
              {detections.map((item) => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString("zh-CN")}</option>)}
            </select>
            <Link className="btn btn-primary" href="/geo/new">发起最新检测</Link>
          </div>
        : <Link className="btn btn-primary" href="/geo/new">发起最新检测</Link>}
    </header>
    {!detection
      ? <>
          <ModuleNav items={analysisNavForBatch} />
          <div className="analysis-tab-content">
            <p className="analysis-tab-description">{description}</p>
            <Card><EmptyState
              title={requestedId ? "该批次分析暂不可用" : "暂无可分析的检测"}
              description={requestedId ? "本次检测可能仍在同步或分析尚未完成，请从检测记录查看当前状态。" : "完成一次检测和分析后，这里会展示单批次洞察。"}
              action={<Link className="btn btn-primary" href="/geo/new">发起首次检测</Link>}
              icon={<BarChart3 size={24} />}
            /></Card>
          </div>
        </>
      : <>
          <section className="analysis-shared-overview" aria-label="分析总览">
            <Card className="analysis-overview-card">
              <div className="analysis-batch-grid">
                <div><span>检测时间</span><strong>{new Date(detection.createdAt).toLocaleString("zh-CN")}</strong></div>
                <div><span>AI平台</span><strong>{detection.providers.map((item) => providerNames[item]).join("、")}</strong></div>
                <div><span>检测问题</span><strong>{detection.questionIds.length} 条</strong></div>
                <div><span>有效回答</span><strong>{detection.results.length} 条</strong></div>
              </div>
              <AnalysisOverview brand={brand} detection={detection} />
              <AnalysisConclusion detection={detection} />
            </Card>
          </section>
          <div className="analysis-module-nav">
            <ModuleNav items={analysisNavForBatch} />
          </div>
          <div className="analysis-tab-content">
            <p className="analysis-tab-description">{description}</p>
            {children({ brand, detection })}
          </div>
        </>}
  </>;
}

function AnalysisOverview({ brand, detection }: { brand: Brand; detection: Detection }) {
  const summary = detectionSummary(detection, brand);
  const reputation = reputationTopics(detection);
  const activeReputationCount = reputation
    .filter((item) => item.sentimentLabel === "积极")
    .reduce((sum, item) => sum + item.count, 0);
  const dimensions = detectionAnalysisSummary(detection, brand);
  return <div className="analysis-overview-metrics">
    <OverviewMetric label="能见" value={`${dimensions.scores.visibility}%`} meta={`${summary.brandOccurrences} 次品牌出现`} tone="blue" />
    <OverviewMetric label="排名" value={summary.averageRank ? `第 ${summary.averageRank}` : "—"} meta={`Top3率 ${summary.top3Rate}%`} tone="purple" />
    <OverviewMetric label="口碑" value={`${dimensions.scores.reputation}%`} meta={`${activeReputationCount} 条积极评价`} tone="green" />
    <OverviewMetric label="情感" value={`${dimensions.scores.sentiment}`} meta="本次回答情感得分" tone="orange" />
  </div>;
}

function OverviewMetric({ label, value, meta, tone }: { label: string; value: string; meta: string; tone: string }) {
  return <div className={`analysis-overview-metric tone-${tone}`}>
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{meta}</small>
  </div>;
}

function MetricCard({ label, value, meta, tone }: { label: string; value: string; meta: string; tone: string }) {
  return <div className={`card analysis-metric-card tone-${tone}`}>
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{meta}</small>
  </div>;
}

export function VisibilityRankingView() {
  const [view, setView] = useState<"citations" | "ranking">("citations");
  const [provider, setProvider] = useState("all");
  const [question, setQuestion] = useState("all");
  return <AnalysisFrame description="查看当前检测中品牌的引用来源、提及率和推荐排名。">
    {({ brand, detection }) => {
      const filtered = filterDetection(detection, provider, question);
      return <Card>
        <div className="analysis-toolbar">
          <div className="segmented">
            <button className={view === "citations" ? "active" : ""} onClick={() => setView("citations")}>引用源</button>
            <button className={view === "ranking" ? "active" : ""} onClick={() => setView("ranking")}>排名</button>
          </div>
          <AnalysisFilters detection={detection} provider={provider} question={question} onProvider={setProvider} onQuestion={setQuestion} />
        </div>
        {view === "citations"
          ? <CitationAnalysis detection={filtered} />
          : <RankingAnalysis detection={filtered} brand={brand} />}
      </Card>;
    }}
  </AnalysisFrame>;
}

function CitationAnalysis({ detection }: { detection: Detection }) {
  const sources = citationMetrics(detection);
  const totalCitations = sources.reduce((sum, item) => sum + item.count, 0);
  const sourceCount = sources.length;
  const average = detection.results.length ? Number((totalCitations / detection.results.length).toFixed(1)) : 0;
  const platforms = detection.providers.map((provider) => ({
    provider,
    count: detection.results.filter((result) => result.provider === provider).reduce((sum, result) => sum + result.citations.length, 0),
  }));
  return <div className="analysis-section">
    <div className="grid grid-3">
      <MiniMetric label="引用来源数" value={`${sourceCount}`} />
      <MiniMetric label="总引用次数" value={`${totalCitations}`} />
      <MiniMetric label="平均引用次数" value={`${average}`} />
    </div>
    {!sources.length
      ? <EmptyState
          title="当前批次没有网页引用数据"
          description="本次模型API未启用联网搜索，因此不生成或模拟引用来源。"
          icon={<FileSearch size={24} />}
        />
      : <>
          <div className="grid grid-2 section-gap">
            <div className="analysis-panel">
              <h3>Top 10 引用来源</h3>
              <div className="bar-list">{sources.slice(0, 10).map((item) => <div key={item.source}>
                <span>{item.source}</span>
                <div><i style={{ width: `${Math.max(8, item.count / Math.max(sources[0].count, 1) * 100)}%` }} /></div>
                <strong>{item.count}</strong>
              </div>)}</div>
            </div>
            <div className="analysis-panel">
              <h3>平台引用分布</h3>
              <div className="platform-share-list">{platforms.map((item) => <div key={item.provider}>
                <span>{providerNames[item.provider]}</span><strong>{item.count}</strong>
                <em>{totalCitations ? Math.round(item.count / totalCitations * 100) : 0}%</em>
              </div>)}</div>
            </div>
          </div>
          <div className="table-wrap section-gap"><table className="table citation-source-table">
            <thead><tr><th>来源</th><th>引用次数</th><th>涉及平台</th><th>来源文章</th></tr></thead>
            <tbody>{sources.map((item) => <tr key={item.source}>
              <td><strong>{item.source}</strong></td>
              <td>{item.count}</td>
              <td>{item.providers.map((provider) => providerNames[provider]).join("、")}</td>
              <td><a className="link" href={item.url} target="_blank" rel="noreferrer">查看来源</a></td>
            </tr>)}</tbody>
          </table></div>
        </>}
  </div>;
}

function RankingAnalysis({ detection, brand }: { detection: Detection; brand: Brand }) {
  const summary = detectionSummary(detection, brand);
  const rankings = rankingMetrics(detection, brand);
  const ownName = brand.name.trim().toLocaleLowerCase();
  return <div className="analysis-section">
    <div className="grid grid-5 analysis-five-metrics">
      <MiniMetric label="品牌提及率" value={`${summary.mentionRate}%`} />
      <MiniMetric label="首位推荐率" value={`${summary.firstPlaceRate}%`} />
      <MiniMetric label="Top3推荐率" value={`${summary.top3Rate}%`} />
      <MiniMetric label="平均位置" value={summary.averageRank ? `第${summary.averageRank}` : "—"} />
      <MiniMetric label="未提及率" value={`${summary.notMentionedRate}%`} />
    </div>
    {rankings.length
      ? <div className="ranking-list section-gap">{rankings.map((item, index) => <article key={item.name} className={item.name.trim().toLocaleLowerCase() === ownName ? "own-brand" : ""}>
          <span className="ranking-number">{index + 1}</span>
          <div><strong>{item.name}</strong>{item.name.trim().toLocaleLowerCase() === ownName && <Badge tone="primary">本品牌</Badge>}</div>
          <span>{item.appearances} 次出现</span>
          <strong>{item.mentionRate}%</strong>
          <Link className="link small" href={`/geo/results/${detection.id}`}>查看依据 <ChevronRight size={13} /></Link>
        </article>)}</div>
      : <EmptyState title="暂无品牌排名数据" description="当前筛选结果未识别到品牌推荐或列举顺序。" icon={<Medal size={24} />} />}
  </div>;
}

export function ReputationAnalysisView() {
  const [provider, setProvider] = useState("all");
  const [question, setQuestion] = useState("all");
  const [sentiment, setSentiment] = useState("all");
  return <AnalysisFrame description="查看当前检测中AI回答对品牌的情感倾向、评价主题和原文依据。">
    {({ detection }) => {
      const filtered = filterDetection(detection, provider, question, sentiment);
      const metrics = sentimentMetrics(filtered);
      const topics = reputationTopics(filtered);
      return <Card>
        <div className="analysis-toolbar">
          <div className="segmented sentiment-tabs">
            {[
              ["all", "全部"],
              ["积极", "积极"],
              ["中性", "中性"],
              ["需改善", "需改善"],
            ].map(([value, label]) => <button key={value} className={sentiment === value ? "active" : ""} onClick={() => setSentiment(value)}>{label}</button>)}
          </div>
          <AnalysisFilters detection={detection} provider={provider} question={question} onProvider={setProvider} onQuestion={setQuestion} />
        </div>
        <div className="grid grid-2 analysis-section">
          <div className="analysis-panel">
            <h3>情感倾向分布</h3>
            <SentimentDonut
              active={metrics.activeRate}
              neutral={metrics.neutralRate}
              needsImprovement={metrics.needsImprovementRate}
              selectedSentiment={sentiment}
            />
          </div>
          <div className="analysis-panel">
            <h3>评价数量</h3>
            <div className="sentiment-count-list">
              <div className="positive"><span>积极评价</span><strong>{metrics.active}</strong><em>{metrics.activeRate}%</em></div>
              <div className="neutral"><span>中性描述</span><strong>{metrics.neutral}</strong><em>{metrics.neutralRate}%</em></div>
              <div className="negative"><span>需改善</span><strong>{metrics.needsImprovement}</strong><em>{metrics.needsImprovementRate}%</em></div>
            </div>
          </div>
        </div>
        <div className="analysis-panel section-gap">
          <h3>评价主题与原文依据</h3>
          {topics.length ? <div className="topic-evidence-layout">
            <div className="topic-list">{topics.map((topic) => <article key={`${topic.sentimentLabel}-${topic.label}`}>
              <Badge tone={topic.sentimentLabel === "积极" ? "success" : topic.sentimentLabel === "需改善" ? "danger" : "default"}>{topic.sentimentLabel}</Badge>
              <strong>{topic.label}</strong>
              <span>{topic.count} 次</span>
              <small>{topic.providers.map((item) => providerNames[item]).join("、")}</small>
            </article>)}</div>
            <div className="evidence-list">{topics.flatMap((topic) => topic.evidences.slice(0, 3).map((evidence) => <blockquote key={`${topic.label}-${evidence.resultId}`}>
              <span>{providerNames[evidence.provider]} · {topic.label}</span>
              <p>“{evidence.evidence}”</p>
            </blockquote>))}</div>
          </div> : <EmptyState title="暂无评价主题" description="当前筛选结果没有可核验的品牌评价原文。" icon={<MessageSquareText size={24} />} />}
        </div>
      </Card>;
    }}
  </AnalysisFrame>;
}

export function CompetitorInsightView() {
  const [selected, setSelected] = useState<string | null>(null);
  return <AnalysisFrame description="查看当前检测中被AI提及的竞品、出现频次和与本品牌的共同出现情况。">
    {({ brand, detection }) => {
      const rows = competitorMetrics(detection, brand).slice(0, 20);
      const strongest = rows[0];
      const selectedRow = rows.find((item) => item.name === selected);
      return <>
        <div className="grid grid-4">
          <MetricCard label="检测到的竞品" value={`${rows.length}`} meta="当前批次识别结果" tone="blue" />
          <MetricCard label="最强竞品" value={strongest?.name || "—"} meta={strongest ? `${strongest.appearances} 次出现` : "暂无竞品数据"} tone="purple" />
          <MetricCard label="竞品整体提及率" value={`${Math.min(100, rows.reduce((sum, item) => sum + item.mentionRate, 0))}%`} meta="至少一个竞品被提及" tone="green" />
          <MetricCard label="头号竞品提及率" value={`${strongest?.mentionRate || 0}%`} meta={strongest?.name || "暂无"} tone="orange" />
        </div>
        <Card className="section-gap" title="竞品品牌提及 Top 20" description="点击竞品可查看关联问题和原始回答依据。">
          {rows.length ? <div className="table-wrap"><table className="table">
            <thead><tr><th>排名</th><th>竞品名称</th><th>出现次数</th><th>提及率</th><th>首位提及率</th><th>共同出现</th><th>操作</th></tr></thead>
            <tbody>{rows.map((item, index) => <tr key={item.name}>
              <td><span className="ranking-number">{index + 1}</span></td>
              <td><strong>{item.name}</strong> {item.configuredCompetitor ? <Badge tone="primary">已配置竞品</Badge> : <Badge>模型识别</Badge>}</td>
              <td>{item.appearances}</td>
              <td>{item.mentionRate}%</td>
              <td>{item.firstPlaceRate}%</td>
              <td>{item.cooccurrences}</td>
              <td><Button size="sm" variant="ghost" onClick={() => setSelected(item.name)}>查看依据</Button></td>
            </tr>)}</tbody>
          </table></div> : <EmptyState title="当前批次未识别到竞品" description="系统只展示在原始回答中有名称和证据的竞品。" icon={<Trophy size={24} />} />}
        </Card>
        <Modal open={Boolean(selectedRow)} title={`${selectedRow?.name || ""}的提及依据`} description="以下内容均来自当前检测的原始回答。" onClose={() => setSelected(null)}>
          <div className="stack">{selectedRow?.evidences.map((evidence) => <article className="analysis-evidence-card" key={evidence.resultId}>
            <Badge tone="primary">{providerNames[evidence.provider]}</Badge>
            <strong>{evidence.question}</strong>
            <p>“{evidence.evidence}”</p>
            <Link className="link small" href={`/geo/results/${detection.id}`}>查看完整回答</Link>
          </article>)}</div>
        </Modal>
      </>;
    }}
  </AnalysisFrame>;
}

function AnalysisConclusion({ detection }: { detection: Detection }) {
  const router = useRouter();
  const active = useAppStore(activeCycle);
  const selectObjective = useAppStore((state) => state.selectObjective);
  const syncServerDetection = useAppStore((state) => state.syncServerDetection);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [creatingCycle, setCreatingCycle] = useState(false);
  const [requestingSuggestions, setRequestingSuggestions] = useState(false);
  const [toast, setToast] = useState("");
  const diagnosis = detection.diagnosis;
  const suggestionStatus = diagnosis?.suggestionStatus
    || (diagnosis?.suggestions.length ? "generated" : "not_generated");

  useEffect(() => {
    if (suggestionStatus !== "generating") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/detections/${encodeURIComponent(detection.id)}`, { cache: "no-store" });
        const latest = await readDetectionResponse(response);
        if (cancelled) return;
        syncServerDetection(latest);
        if (latest.diagnosis?.suggestionStatus === "generating") timer = setTimeout(() => void poll(), 3_000);
      } catch {
        if (!cancelled) timer = setTimeout(() => void poll(), 6_000);
      }
    };
    timer = setTimeout(() => void poll(), 3_000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [detection.id, suggestionStatus, syncServerDetection]);

  if (!diagnosis) return null;
  const activeForDetection = active?.detectionId === detection.id ? active : undefined;
  const blockingCycle = active && active.detectionId !== detection.id ? active : undefined;
  const suggestion = diagnosis.suggestions.find((item) => item.id === confirming);
  const requestSuggestions = async () => {
    if (requestingSuggestions || suggestionStatus === "generating") return;
    setRequestingSuggestions(true);
    try {
      const response = await fetch(`/api/detections/${encodeURIComponent(detection.id)}/suggestions`, { method: "POST" });
      const latest = await readDetectionResponse(response);
      syncServerDetection(latest);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "无法生成优化建议");
    } finally {
      setRequestingSuggestions(false);
    }
  };
  const confirm = async () => {
    if (!confirming) return;
    setCreatingCycle(true);
    try {
      await selectObjective(detection.id, confirming);
      router.push("/tasks");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "无法创建优化任务");
      setConfirming(null);
      setCreatingCycle(false);
    }
  };
  return <>
    <div className="analysis-overview-insight">
      <section className="analysis-overview-pane analysis-conclusion-pane">
        <div className="analysis-overview-pane-title">
          <h2>分析结论</h2>
          <Link className="link small" href={`/geo/results/${detection.id}`}>查看原始结果</Link>
        </div>
        <p className="analysis-conclusion-text">{diagnosis.summary}</p>
      </section>
      <section className="analysis-overview-pane analysis-goal-pane">
        <div className="analysis-overview-pane-title">
          <h2>{activeForDetection ? "优化目标" : "优化建议"}</h2>
          {!activeForDetection && suggestionStatus === "generated" && <span>{blockingCycle ? "终止当前任务后可选择新目标" : "选择一项生成7天任务"}</span>}
        </div>
        {activeForDetection
          ? <div className="analysis-active-goal">
              <Badge tone="primary">进行中</Badge>
              <span>当前目标</span>
              <strong>{activeForDetection.target}</strong>
              <Link className="btn btn-soft btn-sm" href="/tasks">查看目标</Link>
            </div>
          : suggestionStatus === "generated"
            ? <>
                {blockingCycle && <div className="analysis-goal-blocked"><span>已有一轮任务正在执行，本次建议来自当前最新检测。</span><Link className="link small" href="/tasks">处理当前任务</Link></div>}
                <div className="analysis-suggestion-list">{diagnosis.suggestions.map((item, index) => <article className="suggestion-compact" key={item.id}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{item.title}</strong>
                    <p><b>目标依据：</b>{item.reason}</p>
                  </div>
                  <Button size="sm" variant="primary" disabled={Boolean(blockingCycle)} onClick={() => setConfirming(item.id)}>{blockingCycle ? "暂不可选择" : "选择目标"}</Button>
                </article>)}</div>
              </>
            : suggestionStatus === "generating"
              ? <div className="analysis-goal-blocked"><span>正在根据本次检测生成个性化优化建议，可以离开页面，稍后返回查看。</span><Badge tone="primary">生成中</Badge></div>
              : <div className="analysis-goal-blocked">
                  <span>{suggestionStatus === "failed" ? diagnosis.suggestionError || "优化建议生成失败，可重新获取。" : "检测分析已完成，按需获取本次检测的优化建议。"}</span>
                  <Button size="sm" variant="primary" disabled={requestingSuggestions} onClick={() => void requestSuggestions()}>
                    <Lightbulb size={15} />{requestingSuggestions ? "正在提交…" : suggestionStatus === "failed" ? "重新获取" : "获取建议"}
                  </Button>
                </div>}
      </section>
    </div>
    <Modal open={Boolean(confirming)} title={creatingCycle ? "正在创建优化任务" : "确认优化目标"} description={creatingCycle ? "系统正在根据本次分析规划并保存7天内容任务。" : "确认后将按该目标建立7天优化任务。"} dismissible={!creatingCycle} onClose={() => { if (!creatingCycle) setConfirming(null); }} footer={creatingCycle ? undefined : <><Button onClick={() => setConfirming(null)}>取消</Button><Button variant="primary" onClick={() => void confirm()}>确认并创建7天任务</Button></>}>
      {creatingCycle
        ? <OperationProgress kind="planning" />
              : <div className="notice notice-warning"><Lightbulb size={18} /><div><strong>{suggestion?.title}</strong><div style={{ marginTop: 5 }}>目标依据：{suggestion?.reason}</div></div></div>}
    </Modal>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </>;
}

function AnalysisFilters({
  detection,
  provider,
  question,
  onProvider,
  onQuestion,
}: {
  detection: Detection;
  provider: string;
  question: string;
  onProvider: (value: string) => void;
  onQuestion: (value: string) => void;
}) {
  const questions = Array.from(new Map(detection.results.map((result) => [
    result.questionId,
    result.questionSnapshot || "检测问题",
  ])).entries());
  return <div className="analysis-filter-row">
    <select aria-label="AI平台" className="select" value={provider} onChange={(event) => onProvider(event.target.value)}>
      <option value="all">全部平台</option>
      {detection.providers.map((item) => <option key={item} value={item}>{providerNames[item]}</option>)}
    </select>
    <select aria-label="检测问题" className="select" value={question} onChange={(event) => onQuestion(event.target.value)}>
      <option value="all">全部问题</option>
      {questions.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
    </select>
  </div>;
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return <div className="analysis-mini-metric"><span>{label}</span><strong>{value}</strong></div>;
}

function SentimentDonut({
  active,
  neutral,
  needsImprovement,
  selectedSentiment,
}: {
  active: number;
  neutral: number;
  needsImprovement: number;
  selectedSentiment: string;
}) {
  const total = active + neutral + needsImprovement;
  const neutralEnd = active + neutral;
  const background = total
    ? `conic-gradient(#12b76a 0 ${active}%, #98a2b3 ${active}% ${neutralEnd}%, #f04438 ${neutralEnd}% 100%)`
    : "#eaecf0";
  const selectedLabel = selectedSentiment === "all" ? undefined : selectedSentiment;
  const label = total === 0
    ? "暂无数据"
    : selectedLabel || (active >= 60 ? "积极" : needsImprovement >= 30 ? "需改善" : "中性");
  const caption = selectedLabel ? `${selectedLabel}评价` : "综合倾向";
  return <div className="sentiment-donut-wrap">
    <div className="sentiment-donut" style={{ background }}><div><strong>{label}</strong><span>{caption}</span></div></div>
    <div className="sentiment-legend"><span className="positive">积极 {active}%</span><span className="neutral">中性 {neutral}%</span><span className="negative">需改善 {needsImprovement}%</span></div>
  </div>;
}

function filterDetection(detection: Detection, provider: string, question: string, sentiment = "all"): Detection {
  const results = detection.results.filter((result) =>
    (provider === "all" || result.provider === provider)
    && (question === "all" || result.questionId === question)
    && (sentiment === "all" || result.sentimentLabel === sentiment),
  );
  return { ...detection, results };
}
