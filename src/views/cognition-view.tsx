"use client";

import { AlertTriangle, BrainCircuit, CheckCircle2, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccountContext } from "@/components/auth-context";
import { ModuleNav } from "@/components/module-nav";
import { Badge, Button, Card, EmptyState, PageHeader, Progress, Toast } from "@/components/ui";
import { buildCognitionInput, cognitionInputChanged, cognitionSupportLabels, preflightCognition } from "@/lib/cognition";
import { currentBrand, flushWorkspaceNow, useAppStore } from "@/lib/store";
import type { CognitionInsightRevision, CognitionRun, CognitionSupportStatus } from "@/lib/types";
import { brandNavigationItems } from "@/lib/brand-navigation";

const statusMeta: Record<CognitionRun["status"], { label: string; progress: number; tone: "default" | "primary" | "success" | "warning" | "danger" }> = {
  queued: { label: "等待分析", progress: 20, tone: "warning" },
  analyzing: { label: "正在分析", progress: 60, tone: "primary" },
  review_required: { label: "待审核", progress: 90, tone: "warning" },
  confirmed: { label: "已确认", progress: 100, tone: "success" },
  failed: { label: "分析失败", progress: 100, tone: "danger" },
};

type Drafts = Record<string, Record<string, string>>;

const fieldLabels: Record<string, string> = {
  name: "名称",
  shortName: "简称",
  characteristics: "品牌特质",
  categoryName: "营销品类",
  trustProof: "信任依据",
  positioningStatement: "品牌定位",
  industry: "所属行业",
  industryCode: "行业编码",
  industryPath: "行业路径",
  industryStandard: "行业标准",
  website: "官方网站",
  intro: "简介",
  serviceArea: "服务市场",
  targetAudience: "核心受众 / 目标客户",
  coreScenarios: "核心场景",
  valuePromise: "价值承诺",
  cognitionBoundary: "认知边界",
  otherInfo: "其他信息",
  type: "类型",
  description: "产品简介",
  features: "核心特点",
  audience: "目标客户",
  scenarios: "应用场景",
  advantages: "优势主张",
  problemsSolved: "可解决问题",
  quantitativeFacts: "定量信息",
  evidence: "证明依据",
  limitations: "应用限制",
  competitors: "竞品比较",
  "brand.valuePromise": "品牌价值承诺",
};

export function CognitionView({ runId }: { runId?: string }) {
  const router = useRouter();
  const account = useAccountContext();
  const brand = useAppStore(currentBrand);
  const dataMode = useAppStore((state) => state.dataMode);
  const cognitionRuns = useAppStore((state) => state.cognitionRuns);
  const startCognition = useAppStore((state) => state.startCognition);
  const loadCognition = useAppStore((state) => state.loadCognition);
  const retryCognition = useAppStore((state) => state.retryCognition);
  const confirmCognition = useAppStore((state) => state.confirmCognition);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const run = useMemo(() => {
    if (runId) return cognitionRuns.find((item) => item.id === runId);
    return cognitionRuns.find((item) => item.brandId === brand?.id);
  }, [brand?.id, cognitionRuns, runId]);

  useEffect(() => {
    if (!brand) return;
    let cancelled = false;
    void loadCognition(runId ? { runId } : { brandId: brand.id })
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : "认知洞察读取失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [brand, loadCognition, runId]);

  useEffect(() => {
    if (!run || (run.status !== "queued" && run.status !== "analyzing")) return;
    const timer = window.setInterval(() => {
      void loadCognition({ runId: run.id }).catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [loadCognition, run]);

  if (!brand) return null;
  const owner = dataMode === "local" || account?.role === "owner";
  const checked = preflightCognition({ brand, products: brand.products, competitors: brand.competitors });
  const factsChanged = Boolean(run && run.status === "confirmed"
    && cognitionInputChanged(buildCognitionInput(brand), run.inputSnapshot));

  const begin = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await flushWorkspaceNow();
      const nextId = await startCognition(brand.id);
      router.replace(`/brand/cognition/${nextId}`);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "认知分析启动失败");
    } finally {
      setSubmitting(false);
    }
  };

  const retry = async () => {
    if (!run || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await retryCognition(run.id);
      setToast("已重新提交分析");
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "认知分析重试失败");
    } finally {
      setSubmitting(false);
    }
  };

  const confirmAll = async () => {
    if (!run || submitting) return;
    const revisions: CognitionInsightRevision[] = run.insights.map((insight) => ({
      insightId: insight.id,
      items: insight.items.map((item) => ({
        key: item.key,
        conclusion: (drafts[insight.id]?.[item.key] ?? item.conclusion).trim(),
      })),
    }));
    if (revisions.some((revision) => revision.items.some((item) => !item.conclusion))) {
      setError("每项洞察都需要保留结论；信息不足时请填写“信息不足”");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await confirmCognition(run.id, revisions);
      setToast("品牌与产品认知已一次确认完成");
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "认知洞察确认失败");
    } finally {
      setSubmitting(false);
    }
  };

  return <>
    <PageHeader
      title="认知洞察"
      description="品牌使用六要素模型，产品或服务使用 BFABEWW 模型；分析结论与事实档案相互隔离。"
      actions={run?.status === "review_required" && owner ? <Button variant="primary" disabled={submitting} onClick={() => void confirmAll()}><CheckCircle2 size={16} />{submitting ? "确认中…" : "一次确认全部洞察"}</Button> : undefined}
    />
    <ModuleNav items={brandNavigationItems} />

    {error && <div className="notice notice-danger" role="alert">{error}</div>}
    {loading && !run ? <Card><div className="cognition-loading"><LoaderCircle className="spin" size={24} />正在读取认知洞察…</div></Card> : !run ? <Card>
      <EmptyState
        icon={<BrainCircuit size={26} />}
        title="尚未建立认知洞察"
        description={checked.ready ? "品牌和产品事实已达到最低分析条件，可以开始建立认知。" : `开始前还需补充 ${checked.issues.length} 项必要信息。`}
        action={owner ? <Button variant="primary" disabled={!checked.ready || submitting} onClick={() => void begin()}>{submitting ? "提交中…" : "开始认知分析"}</Button> : undefined}
      />
      {!checked.ready && <div className="cognition-issues">{checked.issues.map((issue) => <span key={`${issue.path}-${issue.message}`}>{issue.message}</span>)}</div>}
    </Card> : <>
      <Card className="cognition-status-card" title={<span className="cognition-status-title">本次认知建立 <Badge tone={statusMeta[run.status].tone}>{statusMeta[run.status].label}</Badge></span>} description={`基于创建时的品牌与产品事实快照 · 第 ${run.attempt || 1} 次尝试`} action={run.status === "failed" && owner ? <Button disabled={submitting} onClick={() => void retry()}><RefreshCw size={15} />重新分析</Button> : run.status === "confirmed" && factsChanged && owner ? <Button variant="primary" disabled={submitting || !checked.ready} onClick={() => void begin()}><RefreshCw size={15} />更新洞察</Button> : undefined}>
        <Progress value={statusMeta[run.status].progress} success={run.status === "confirmed"} />
        {(run.status === "queued" || run.status === "analyzing") && <p className="secondary cognition-status-copy">后台正在根据事实档案建立品牌和产品认知，页面会自动更新。</p>}
        {run.status === "review_required" && <div className="notice notice-warning">请统一审核全部品牌与产品洞察。你可以修改 AI 结论；修改只写入认知洞察，不会改动事实档案。</div>}
        {run.status === "confirmed" && <div className="notice notice-success">本批次已确认，日常不能直接修改。{factsChanged ? "系统检测到事实信息发生变化，可由你决定是否更新洞察。" : "当前洞察将继续作为认知基准使用。"}</div>}
        {run.status === "failed" && <div className="notice notice-danger"><AlertTriangle size={16} />{run.error || "分析未完成，请重试。"}</div>}
      </Card>

      {(run.status === "review_required" || run.status === "confirmed") && <div className="cognition-insight-list">
        {run.insights.map((insight) => <Card
          key={insight.id}
          title={`${insight.subjectType === "brand" ? "品牌" : "产品 / 服务"} · ${insight.subjectName}`}
          description={insight.modelType === "brand_six_elements" ? "品牌认知六要素" : "BFABEWW（Base 仅作输入预检，不单独输出）"}
          action={<Badge tone={insight.status === "confirmed" ? "success" : "warning"}>{insight.status === "confirmed" ? `认知基准 v${insight.version}` : "待审核"}</Badge>}
        >
          <div className="cognition-item-list">
            {insight.items.map((item) => <section className="cognition-item" key={item.key}>
              <header><strong>{item.label}</strong><SupportBadge status={item.supportStatus} /></header>
              {run.status === "review_required" && owner ? <textarea
                className="textarea"
                maxLength={2_000}
                value={drafts[insight.id]?.[item.key] ?? item.conclusion}
                onChange={(event) => setDrafts((current) => ({
                  ...current,
                  [insight.id]: { ...current[insight.id], [item.key]: event.target.value },
                }))}
              /> : <p className="cognition-conclusion">{item.conclusion}</p>}
              <div className="cognition-evidence">
                <span>事实依据：{item.inputFields.length ? item.inputFields.map((field) => fieldLabels[field] || field).join("、") : "暂无"}</span>
                {item.missingOrConflict && <span>{item.missingOrConflict}</span>}
                {item.webReferences.map((reference) => <a href={reference.url} target="_blank" rel="noreferrer" key={reference.url}>{reference.title}<ExternalLink size={12} /></a>)}
              </div>
            </section>)}
          </div>
        </Card>)}
      </div>}
    </>}
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </>;
}

function SupportBadge({ status }: { status: CognitionSupportStatus }) {
  const tone = status === "supported" ? "success" : status === "partially_supported" ? "primary" : status === "conflicting" ? "danger" : "warning";
  return <Badge tone={tone}>{cognitionSupportLabels[status]}</Badge>;
}
