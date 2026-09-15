"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, LoaderCircle, Plus, RefreshCw, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Progress } from "@/components/ui";
import { buildCognitionInput, cognitionInputChanged } from "@/lib/cognition";
import {
  normalizeQuestionText,
  preflightQuestionSimulation,
  questionCapacityShortfall,
  QUESTION_LIBRARY_LIMIT,
} from "@/lib/question-simulator";
import { currentBrand, flushWorkspaceNow, useAppStore } from "@/lib/store";
import type { QuestionCandidateReview, QuestionSimulationRun } from "@/lib/types";
import { createId } from "@/lib/utils";

const statusMeta: Record<QuestionSimulationRun["status"], { label: string; progress: number; tone: "default" | "primary" | "success" | "warning" | "danger" }> = {
  queued: { label: "等待模拟", progress: 20, tone: "warning" },
  generating: { label: "正在模拟", progress: 65, tone: "primary" },
  review_required: { label: "待审核", progress: 90, tone: "warning" },
  confirmed: { label: "已入库", progress: 100, tone: "success" },
  failed: { label: "生成失败", progress: 100, tone: "danger" },
  cancelled: { label: "已放弃", progress: 100, tone: "default" },
};

export function QuestionGenerationView() {
  const router = useRouter();
  const search = useSearchParams();
  const brand = useAppStore(currentBrand);
  const runs = useAppStore((state) => state.questionSimulationRuns);
  const cognitionRuns = useAppStore((state) => state.cognitionRuns);
  const startSimulation = useAppStore((state) => state.startQuestionSimulation);
  const loadSimulation = useAppStore((state) => state.loadQuestionSimulation);
  const loadCognition = useAppStore((state) => state.loadCognition);
  const retrySimulation = useAppStore((state) => state.retryQuestionSimulation);
  const requestedType = search.get("subjectType") === "product" ? "product" as const : "brand" as const;
  const requestedId = search.get("subjectId") || (requestedType === "brand" ? brand?.id : "");
  const targetExists = requestedType === "brand"
    ? requestedId === brand?.id
    : brand?.products.some((item) => item.id === requestedId);
  const target = targetExists && requestedId ? { subjectType: requestedType, subjectId: requestedId } : undefined;
  const run = useMemo(() => {
    const runId = search.get("runId");
    return runId
      ? runs.find((item) => item.id === runId)
      : runs.find((item) => item.brandId === brand?.id
        && item.subjectType === target?.subjectType && item.subjectId === target?.subjectId);
  }, [brand?.id, runs, search, target?.subjectId, target?.subjectType]);
  const cognitionRun = cognitionRuns.find((item) => item.brandId === brand?.id
    && item.status === "confirmed"
    && item.insights.some((insight) => insight.subjectType === target?.subjectType
      && insight.subjectId === target?.subjectId && insight.isCurrent));
  const [loading, setLoading] = useState(Boolean(brand && target));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!brand || !targetExists || !requestedId) return;
    let cancelled = false;
    void Promise.all([
      loadSimulation({ brandId: brand.id, subjectType: requestedType, subjectId: requestedId }),
      loadCognition({ brandId: brand.id }),
    ])
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : "模拟生成批次读取失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [brand, loadCognition, loadSimulation, requestedId, requestedType, targetExists]);

  useEffect(() => {
    if (!run || (run.status !== "queued" && run.status !== "generating")) return;
    const timer = window.setInterval(() => void loadSimulation({ runId: run.id }).catch(() => undefined), 2_000);
    return () => window.clearInterval(timer);
  }, [loadSimulation, run]);

  if (!brand) return <><PageHeader title="用户问题模拟器" description="根据已确认的认知基准模拟用户可能提出的问题。" /><Card><EmptyState title="未找到品牌" description="请先创建品牌档案。" /></Card></>;
  const checked = target ? preflightQuestionSimulation({ brand, cognitionRun, target }) : { ready: false, issues: [{ path: "subject", message: "请选择有效的检测对象" }] };
  const targetName = target?.subjectType === "product"
    ? brand.products.find((item) => item.id === target.subjectId)?.name || "产品或服务"
    : brand.name;
  const targetQuestions = target ? brand.questions.filter((item) => item.subjectType === target.subjectType && item.subjectId === target.subjectId) : [];
  const factsChanged = Boolean(cognitionRun && cognitionInputChanged(buildCognitionInput(brand), cognitionRun.inputSnapshot));

  const switchTarget = (value: string) => {
    const [subjectType, subjectId] = value.split(":");
    router.replace(`/geo/questions/generate?subjectType=${subjectType}&subjectId=${encodeURIComponent(subjectId)}`);
  };
  const begin = async () => {
    if (!target || submitting) return;
    setSubmitting(true); setError("");
    try {
      await flushWorkspaceNow();
      const mode = targetQuestions.length ? "new_batch" : "initial";
      const runId = await startSimulation({ brandId: brand.id, ...target, mode });
      router.replace(`/geo/questions/generate?subjectType=${target.subjectType}&subjectId=${encodeURIComponent(target.subjectId)}&runId=${runId}`);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "模拟问题生成启动失败");
    } finally { setSubmitting(false); }
  };

  return <>
    <PageHeader title="用户问题模拟器" description="让合成用户角色从真实决策场景出发，提出用于GEO检测的模拟问题。" actions={<Link href="/geo/questions" className="btn">返回问题库</Link>} />
    <Card title="选择检测对象" description="品牌与每个产品使用各自已确认的认知基准，信息不会跨对象混用。">
      <Field label="本次模拟对象"><select className="select" value={target ? `${target.subjectType}:${target.subjectId}` : ""} onChange={(event) => switchTarget(event.target.value)}>
        <option value={`brand:${brand.id}`}>品牌 · {brand.name}</option>
        {brand.products.map((product) => <option value={`product:${product.id}`} key={product.id}>产品 / 服务 · {product.name}</option>)}
      </select></Field>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}><Badge tone="primary">{targetName}</Badge><Badge>问题库 {brand.questions.length}/{QUESTION_LIBRARY_LIMIT}</Badge><Badge>{targetQuestions.length} 道该对象问题</Badge></div>
    </Card>
    {error && <div className="notice notice-danger" role="alert" style={{ marginTop: 16 }}>{error}</div>}
    {factsChanged && <div className="notice notice-warning" style={{ marginTop: 16 }}><AlertTriangle size={17} />当前认知基准未包含最新事实。本次模拟将继续使用已确认基准及其原始事实快照。</div>}

    <div className="section-gap">
      {loading ? <Card><div className="cognition-loading"><LoaderCircle className="spin" size={24} />正在读取模拟批次…</div></Card>
        : !run || run.status === "confirmed" || run.status === "cancelled" ? <Card><EmptyState
          icon={<Users size={26} />}
          title={run?.status === "confirmed" ? "上一批问题已进入问题库" : run?.status === "cancelled" ? "上一批模拟已放弃" : "可以开始模拟用户问题"}
          description={checked.ready ? `系统将围绕“${targetName}”生成默认12道候选问题，生成后由你审核确认。` : "当前信息还不足以可靠扮演用户。"}
          action={<Button variant="primary" disabled={!checked.ready || submitting} onClick={() => void begin()}>{submitting ? "提交中…" : run ? "再生成一批" : "开始模拟"}</Button>}
        />{!checked.ready && <div className="cognition-issues">{checked.issues.map((issue) => <span key={`${issue.path}-${issue.message}`}>{issue.message}</span>)}</div>}</Card>
        : run.status === "queued" || run.status === "generating" ? <Card title={<span className="cognition-status-title">模拟生成批次 <Badge tone={statusMeta[run.status].tone}>{statusMeta[run.status].label}</Badge></span>} description={`检测对象：${run.subjectName} · 第 ${run.attempt || 1} 次尝试`}>
          <Progress value={statusMeta[run.status].progress} /><p className="secondary cognition-status-copy">模拟器正在构造用户角色、规划覆盖并筛选候选问题，页面会自动更新。</p>
        </Card>
        : run.status === "failed" ? <Card><EmptyState title="模拟问题生成失败" description={run.error || "本批次未完成。"} action={<Button variant="primary" disabled={submitting || !run.retryable} onClick={() => void retrySimulation(run.id)}><RefreshCw size={16} />重新生成</Button>} /></Card>
        : <QuestionReviewPanel key={run.id} run={run} currentCount={brand.questions.length} existingQuestions={brand.questions.map((item) => item.text)} onError={setError} />}
    </div>
    <style jsx global>{`.spin{animation:geo-spin 1s linear infinite}@keyframes geo-spin{to{transform:rotate(360deg)}}.question-candidate{display:flex;align-items:flex-start;gap:12px;padding:14px;border:1px solid var(--line);border-radius:10px;background:#fff}.question-candidate-select{display:flex;align-items:center;gap:7px;padding-top:9px;color:var(--text-muted);font-size:12px}.question-candidate-fields{display:grid;gap:10px;flex:1}.persona-card{padding:14px;border:1px solid var(--line);border-radius:10px;background:#fbfcfe}.persona-card p{margin:8px 0;line-height:1.5}.persona-card span{color:var(--text-muted);font-size:12px}`}</style>
  </>;
}

function QuestionReviewPanel({ run, currentCount, existingQuestions, onError }: {
  run: QuestionSimulationRun;
  currentCount: number;
  existingQuestions: string[];
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const confirmSimulation = useAppStore((state) => state.confirmQuestionSimulation);
  const cancelSimulation = useAppStore((state) => state.cancelQuestionSimulation);
  const [drafts, setDrafts] = useState<QuestionCandidateReview[]>(() => run.candidates.map(({ id, text, persona, decisionScenario }) => ({ id, text, persona, decisionScenario })));
  const [selected, setSelected] = useState<Set<string>>(() => new Set(run.candidates.map((item) => item.id)));
  const [submitting, setSubmitting] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ text: "", persona: "", decisionScenario: "" });
  const selectedDrafts = drafts.filter((item) => selected.has(item.id));
  const capacityShortfall = questionCapacityShortfall(currentCount, selectedDrafts.length);
  const duplicateCount = duplicateWarningCount(drafts, existingQuestions);
  const confirmAll = async () => {
    if (submitting) return;
    setSubmitting(true); onError("");
    try {
      await confirmSimulation(run.id, selectedDrafts);
      router.push(`/geo/questions?subjectType=${run.subjectType}&subjectId=${encodeURIComponent(run.subjectId)}`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "候选问题确认失败");
    } finally { setSubmitting(false); }
  };
  const abandon = async () => {
    setSubmitting(true); onError("");
    try { await cancelSimulation(run.id); }
    catch (error) { onError(error instanceof Error ? error.message : "模拟批次放弃失败"); }
    finally { setSubmitting(false); }
  };
  const addManual = () => {
    if (!manual.text.trim() || !manual.persona.trim() || !manual.decisionScenario.trim()) return;
    const item = { id: createId("manual_candidate"), text: manual.text.trim(), persona: manual.persona.trim(), decisionScenario: manual.decisionScenario.trim() };
    setDrafts((current) => [...current, item]);
    setSelected((current) => new Set([...current, item.id]));
    setManual({ text: "", persona: "", decisionScenario: "" });
    setManualOpen(false);
  };
  return <>
    <Card title={`候选问题审核 · ${drafts.length} 道`} description="候选问题可以修改、删除或取消选择；确认后成为正式问题，不再允许编辑。" action={<Button onClick={() => setManualOpen(true)} disabled={drafts.length >= 24}><Plus size={16} />手动添加</Button>}>
      {run.coverageGaps.length > 0 && <div className="notice notice-warning" style={{ marginBottom: 14 }}>{run.coverageGaps.join("；")}</div>}
      {duplicateCount > 0 && <div className="notice" style={{ marginBottom: 14 }}>发现 {duplicateCount} 处疑似重复。你仍可确认入库，系统不会硬性阻止审核后的问题。</div>}
      <div className="stack">{drafts.map((item, index) => <article className="question-candidate" key={item.id}>
        <label className="question-candidate-select"><input type="checkbox" checked={selected.has(item.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} /><span>{index + 1}</span></label>
        <div className="question-candidate-fields"><textarea className="textarea" maxLength={300} value={item.text} onChange={(event) => setDrafts((current) => current.map((draft) => draft.id === item.id ? { ...draft, text: event.target.value } : draft))} /><div className="grid grid-2"><Field label="模拟用户角色"><input className="input" value={item.persona} onChange={(event) => setDrafts((current) => current.map((draft) => draft.id === item.id ? { ...draft, persona: event.target.value } : draft))} /></Field><Field label="决策场景"><input className="input" value={item.decisionScenario} onChange={(event) => setDrafts((current) => current.map((draft) => draft.id === item.id ? { ...draft, decisionScenario: event.target.value } : draft))} /></Field></div></div>
        <Button size="icon" variant="ghost" aria-label="删除候选问题" onClick={() => { setDrafts((current) => current.filter((draft) => draft.id !== item.id)); setSelected((current) => { const next = new Set(current); next.delete(item.id); return next; }); }}><Trash2 size={16} /></Button>
      </article>)}</div>
      {!drafts.length && <EmptyState title="候选问题已清空" description="你可以手动添加问题，或放弃本批次后重新生成。" />}
      <div className="form-actions" style={{ marginTop: 18 }}><Button disabled={submitting} onClick={() => void abandon()}>放弃本批次</Button><Button variant="primary" disabled={submitting || !selectedDrafts.length || Boolean(capacityShortfall)} onClick={() => void confirmAll()}><CheckCircle2 size={16} />确认 {selectedDrafts.length} 道并加入问题库</Button></div>
      {capacityShortfall > 0 && <div className="notice notice-warning" style={{ marginTop: 14 }}>问题库容量不足，请先删除 {capacityShortfall} 道旧问题。候选问题会保留在本批次中。</div>}
    </Card>
    {run.personas.length > 0 && <Card title="本批次模拟用户角色" description="角色只是生成问题时采用的合成视角，不代表真实自然人。"><div className="grid grid-2">{run.personas.map((persona) => <div className="persona-card" key={persona.id}><strong>{persona.name}</strong><p>{persona.task}</p><span>{persona.knowledgeLevel} · {persona.concern}</span></div>)}</div></Card>}
    {run.externalReferences.length > 0 && <Card title="公开参考资料" description="这些资料只用于理解行业语言与常见顾虑，不会自动成为品牌事实。"><div className="stack">{run.externalReferences.map((reference) => <a className="link" href={reference.url} target="_blank" rel="noreferrer" key={reference.url}>{reference.title}</a>)}</div></Card>}
    <Modal open={manualOpen} title="手动添加候选问题" description="手动问题同样先留在本批次，确认后才进入问题库。" onClose={() => setManualOpen(false)} footer={<><Button onClick={() => setManualOpen(false)}>取消</Button><Button variant="primary" onClick={addManual}>加入候选列表</Button></>}><div className="stack"><Field label="问题文本" required><textarea className="textarea" maxLength={300} value={manual.text} onChange={(event) => setManual({ ...manual, text: event.target.value })} /></Field><Field label="模拟用户角色" required><input className="input" value={manual.persona} onChange={(event) => setManual({ ...manual, persona: event.target.value })} /></Field><Field label="决策场景" required><input className="input" value={manual.decisionScenario} onChange={(event) => setManual({ ...manual, decisionScenario: event.target.value })} /></Field></div></Modal>
  </>;
}

function duplicateWarningCount(drafts: QuestionCandidateReview[], existing: string[]) {
  const counts = new Map<string, number>();
  [...existing, ...drafts.map((item) => item.text)].forEach((text) => {
    const key = normalizeQuestionText(text);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.values()].filter((count) => count > 1).length;
}
