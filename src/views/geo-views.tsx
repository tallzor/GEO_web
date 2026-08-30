"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, BarChart3, Bot, Check, CheckCircle2, ChevronRight, FileSearch, History, Info, Lightbulb, Link2, LoaderCircle, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LiveDetectionRunner } from "@/components/live-detection-runner";
import { ModuleNav } from "@/components/module-nav";
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Progress, Toast } from "@/components/ui";
import { brandCompleteness, missingBrandFields, providerOptions } from "@/lib/engine";
import { ensureServerDetectionTask } from "@/lib/detection-client";
import { usedQuestionIds } from "@/lib/detection-metrics";
import { activeCycle, currentBrand, useAppStore } from "@/lib/store";
import { Detection, DetectionResult, DiagnosisScores, ProviderId, providerNames } from "@/lib/types";

const geoNav = [
  { href: "/geo", label: "总览" }, { href: "/geo/records", label: "检测记录" }, { href: "/geo/questions", label: "问题库" },
];
const providerLogos: Record<ProviderId, string> = {
  doubao: "/platforms/doubao.png",
  deepseek: "/platforms/deepseek.png",
  yuanbao: "/platforms/yuanbao-large.png",
};
const dimensions: { key: keyof DiagnosisScores; label: string; explain: string }[] = [
  { key: "visibility", label: "能见", explain: "AI回答中品牌被真实提及的覆盖情况" },
  { key: "ranking", label: "排名", explain: "品牌进入推荐榜单、Top3和首位的综合表现" },
  { key: "reputation", label: "口碑", explain: "AI回答中带有原文依据的正向评价占比" },
  { key: "sentiment", label: "情感", explain: "AI回答对品牌表达的综合情感倾向" },
];

function GeoFrame({ title, description, actions, children }: { title: string; description: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return <><PageHeader title={title} description={description} actions={actions} /><ModuleNav items={geoNav} />{children}</>;
}
function useBrandDetectionList() {
  const detections = useAppStore((state) => state.detections);
  const brandId = useAppStore((state) => state.currentBrandId);
  return useMemo(() => detections.filter((item) => item.brandId === brandId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [detections, brandId]);
}
function DimensionCards({ current, previous, availability, previousAvailability }: { current: DiagnosisScores; previous?: DiagnosisScores; availability?: Partial<Record<keyof DiagnosisScores, boolean>>; previousAvailability?: Partial<Record<keyof DiagnosisScores, boolean>> }) {
  return <div className="grid grid-4">{dimensions.map(({ key, label, explain }) => {
    const currentValue = current[key];
    const available = availability?.[key] !== false && Number.isFinite(currentValue);
    const previousValue = previous?.[key];
    const canCompare = available && Number.isFinite(previousValue) && previousAvailability?.[key] !== false;
    const delta = canCompare ? currentValue - previousValue! : null;
    return <div className="card metric-card" key={key}><div className="metric-label"><span>{label}</span><Info size={14} color="#98a2b3" /></div><div className="metric-value">{available ? currentValue : "—"}</div><div className="metric-meta">{available ? delta === null ? "本次检测" : <span className={delta >= 0 ? "trend-up" : "trend-down"}>{delta >= 0 ? "↑" : "↓"} {Math.abs(delta)} 较上次</span> : "暂无可分析证据"} · {explain}</div></div>;
  })}</div>;
}

export function GeoOverviewView() {
  const router = useRouter(); const detections = useBrandDetectionList(); const cycle = useAppStore(activeCycle); const selectObjective = useAppStore((s) => s.selectObjective); const [confirming, setConfirming] = useState<string | null>(null); const [creatingCycle, setCreatingCycle] = useState(false); const [confirmError, setConfirmError] = useState("");
  const completed = detections.filter((x) => x.status === "completed" && x.diagnosis); const latest = completed[0]; const previous = completed[1];
  if (!latest?.diagnosis) return <GeoFrame title="检测数据概览" description="了解品牌在国内AI平台中的推荐表现。" actions={<Link href="/geo/new" className="btn btn-primary"><Plus size={16} />发起检测</Link>}><Card><EmptyState title="尚未进行检测" description="完成首次检测后，这里会展示四维诊断、主要问题和优化建议。" action={<Link className="btn btn-primary" href="/geo/new">开始首次检测</Link>} icon={<BarChart3 size={24} />} /></Card></GeoFrame>;
  const suggestion = latest.diagnosis.suggestions.find((x) => x.id === confirming);
  return <GeoFrame title="检测数据概览" description="查看最近一次检测表现、主要问题和下一步优化方向。" actions={<><Link href="/geo/compare" className="btn" aria-disabled={!previous}><History size={16} />历史对比</Link><Link href="/geo/new" className="btn btn-primary"><Plus size={16} />发起新检测</Link></>}>
    <Card title="最近一次检测" description={`${new Date(latest.completedAt || latest.createdAt).toLocaleString("zh-CN")} · ${latest.providers.map((x) => providerNames[x]).join("、")} · ${latest.questionIds.length}个问题`} action={<Link href={`/geo/report/${latest.id}`} className="btn btn-sm">查看完整报告 <ChevronRight size={14} /></Link>}><div className="notice notice-success"><CheckCircle2 size={18} />本次检测已完成，共获得 {latest.results.length} 条有效AI回答。</div></Card>
    <div className="section-gap"><DimensionCards current={latest.diagnosis.scores} previous={previous?.diagnosis?.scores} availability={latest.diagnosis.scoreAvailability} previousAvailability={previous?.diagnosis?.scoreAvailability} /></div>
    <div className="split-layout section-gap"><div className="stack"><Card title="诊断概览" description="先看结论，再查看问题依据。"><h3 style={{ margin: "0 0 16px", fontSize: 18, lineHeight: 1.55 }}>{latest.diagnosis.summary}</h3><div className="stack">{latest.diagnosis.issues.map((issue) => <Link key={issue.id} href={`/geo/results/${latest.id}`} style={{ display: "flex", gap: 12, padding: 14, border: "1px solid var(--line)", borderRadius: 9 }}><span className={`badge badge-${issue.severity === "high" ? "danger" : issue.severity === "medium" ? "warning" : "primary"}`}>{issue.severity === "high" ? "高优先级" : issue.severity === "medium" ? "中优先级" : "提示"}</span><div><strong>{issue.title}</strong><p className="secondary" style={{ margin: "5px 0 0", lineHeight: 1.55 }}>{issue.evidence}</p></div><ChevronRight size={17} style={{ marginLeft: "auto", color: "#98a2b3" }} /></Link>)}</div></Card><ProviderPerformance detection={latest} /></div>
<Card title="优化建议" description="根据诊断输出1—3个目标，选择一项后生成7天任务。">{cycle && <div className="notice" style={{ marginBottom: 14 }}>当前已有进行中的目标“{cycle.target}”，目标期间不可变更。</div>}<div className="stack">{latest.diagnosis.suggestions.map((item, index) => <article key={item.id} style={{ border: `1px solid ${item.selected ? "#818cf8" : "var(--line)"}`, borderRadius: 10, padding: 15, background: item.selected ? "#fafaff" : "#fff" }}><span className="badge badge-primary">建议 {index + 1}</span><h3 style={{ margin: "12px 0 7px", fontSize: 16 }}>{item.title}</h3><p className="muted small" style={{ margin: "0 0 14px", lineHeight: 1.55 }}><strong>目标依据：</strong>{item.reason}</p>{cycle ? <Link className="btn btn-soft btn-sm" href="/tasks">查看当前目标</Link> : <Button size="sm" variant="primary" onClick={() => setConfirming(item.id)}>选择此目标</Button>}</article>)}</div></Card>
</div><Modal open={!!confirming} title="确认优化目标" description="确认后将创建7天优化任务，执行期间目标不可修改。" onClose={() => { if (!creatingCycle) setConfirming(null); }} footer={<><Button disabled={creatingCycle} onClick={() => setConfirming(null)}>取消</Button><Button variant="primary" disabled={creatingCycle} onClick={async () => { if (!confirming) return; setCreatingCycle(true); setConfirmError(""); try { await selectObjective(latest.id, confirming); router.push("/tasks"); } catch (error) { setConfirmError(error instanceof Error ? error.message : "优化任务创建失败"); setCreatingCycle(false); } }}>{creatingCycle ? "创建中…" : "确认并创建任务"}</Button></>}><div className="notice notice-warning"><Lightbulb size={19} /><div><strong>{suggestion?.title}</strong><div style={{ marginTop: 5 }}>目标依据：{suggestion?.reason}</div></div></div>{confirmError && <div className="notice notice-danger" style={{ marginTop: 12 }}>{confirmError}</div>}</Modal>
  </GeoFrame>;
}

function ProviderPerformance({ detection }: { detection: Detection }) {
  return <Card title="AI平台表现" description="本次检测各平台的品牌提及与推荐表现。"><div className="grid grid-3">{detection.providers.map((provider) => { const results = detection.results.filter((x) => x.provider === provider); const mention = results.filter((x) => x.brandMentioned).length; const recommend = results.filter((x) => x.recommended).length; return <Link key={provider} href={`/geo/results/${detection.id}?provider=${provider}`} style={{ padding: 15, border: "1px solid var(--line)", borderRadius: 9 }}><div style={{ display: "flex", alignItems: "center", gap: 9 }}><span className="empty-icon" style={{ margin: 0, width: 38, height: 38 }}><Bot size={18} /></span><strong>{providerNames[provider]}</strong></div><div style={{ display: "flex", gap: 18, marginTop: 15 }}><div><strong style={{ fontSize: 20 }}>{mention}/{results.length}</strong><div className="muted small">品牌提及</div></div><div><strong style={{ fontSize: 20 }}>{recommend}/{results.length}</strong><div className="muted small">主动推荐</div></div></div></Link>; })}</div></Card>;
}

export function QuestionsView() {
  const brand = useAppStore(currentBrand)!;
  const add = useAppStore((state) => state.addQuestion);
  const update = useAppStore((state) => state.updateQuestion);
  const remove = useAppStore((state) => state.deleteQuestion);
  const allDetections = useAppStore((state) => state.detections);
  const detections = useMemo(() => allDetections.filter((item) => item.brandId === brand.id), [allDetections, brand.id]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const list = brand.questions
    .filter((item) => item.text.includes(search))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const enabled = brand.questions.filter((item) => item.enabled).length;
  const recentlyUsed = usedQuestionIds(detections.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 1));
  const questionsNeedRefresh = brand.questions.length > 0
    && (!brand.questionsGeneratedAt || Boolean(brand.questionContextUpdatedAt && brand.questionContextUpdatedAt > brand.questionsGeneratedAt));
  const openCreate = () => { setEditingId(null); setText(""); setOpen(true); };
  const openEdit = (id: string, value: string) => { setEditingId(id); setText(value); setOpen(true); };
  const save = () => {
    const value = text.trim();
    if (!value) return;
    if (editingId) update(brand.id, editingId, { text: value });
    else add(brand.id, value, "");
    setOpen(false);
  };

  return <GeoFrame title="检测问题库" description="管理实际提交给AI平台的问题，每次检测时重新选择需要使用的问题。" actions={<><Link href="/geo/questions/generate" className="btn"><RefreshCw size={16} />AI生成问题</Link><Button variant="primary" onClick={openCreate}><Plus size={16} />添加问题</Button></>}>
    {questionsNeedRefresh && <div className="notice notice-warning" style={{ marginBottom: 16 }}><Info size={17} />品牌核心信息已更新，建议重新生成检测问题。<Link className="link" href="/geo/questions/generate">立即重新生成</Link></div>}
    <div className="grid grid-2" style={{ marginBottom: 16 }}>
      <div className="card metric-card"><div className="metric-label">全部问题</div><div className="metric-value">{brand.questions.length}</div></div>
      <div className="card metric-card"><div className="metric-label">已启用</div><div className="metric-value">{enabled}</div></div>
    </div>
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 360, position: "relative", flex: 1 }}><Search size={16} style={{ position: "absolute", left: 12, top: 13, color: "#98a2b3" }} /><input className="input" value={search} onChange={(event) => setSearch(event.target.value)} style={{ paddingLeft: 36 }} placeholder="搜索问题" /></div>
      </div>
      {list.length ? <div className="table-wrap"><table className="table">
        <thead><tr><th>检测问题</th><th>最近使用</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead>
        <tbody>{list.map((item) => <tr key={item.id}>
          <td style={{ maxWidth: 680 }}><strong>{item.text}</strong></td>
          <td>{recentlyUsed.has(item.id) ? <Badge tone="primary">上次检测已使用</Badge> : <span className="muted small">未使用</span>}</td>
          <td><label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={item.enabled} onChange={(event) => update(brand.id, item.id, { enabled: event.target.checked })} />{item.enabled ? "启用" : "停用"}</label></td>
          <td>{new Date(item.updatedAt).toLocaleDateString("zh-CN")}</td>
          <td><div className="table-row-action"><Button size="icon" variant="ghost" onClick={() => openEdit(item.id, item.text)}><Pencil size={15} /></Button><Button size="icon" variant="ghost" onClick={() => confirm("确认删除该问题？历史检测记录不受影响。") && remove(brand.id, item.id)}><Trash2 size={15} /></Button></div></td>
        </tr>)}</tbody>
      </table></div> : <EmptyState title="问题库为空" description="使用AI生成问题，或手动添加一个真实用户问题。" action={<Link className="btn btn-primary" href="/geo/questions/generate">AI生成问题</Link>} />}
    </Card>
    <Modal open={open} title={editingId ? "编辑检测问题" : "添加检测问题"} onClose={() => setOpen(false)} footer={<><Button onClick={() => setOpen(false)}>取消</Button><Button variant="primary" onClick={save}>保存问题</Button></>}>
      <Field label="问题内容" required><textarea className="textarea" value={text} onChange={(event) => setText(event.target.value)} placeholder="例如：附近适合健身新手的健身房有哪些？" /></Field>
    </Modal>
  </GeoFrame>;
}

export function NewDetectionView() {
  const router = useRouter(); const search = useSearchParams(); const brand = useAppStore(currentBrand)!; const start = useAppStore((s) => s.startDetection); const [step, setStep] = useState(1); const [providers, setProviders] = useState<ProviderId[]>(["doubao"]); const requestedQuestions = (search.get("questions") || "").split(",").filter(Boolean); const [questions, setQuestions] = useState<string[]>(() => requestedQuestions.filter((id) => brand.questions.some((item) => item.id === id && item.enabled)).slice(0, 10)); const [preflightError, setPreflightError] = useState(""); const [submitting, setSubmitting] = useState(false); const completeness = brandCompleteness(brand); const missing = missingBrandFields(brand);
  const toggleQuestion = (id: string) => setQuestions((old) => old.includes(id) ? old.filter((x) => x !== id) : old.length < 10 ? [...old, id] : old);
  const toggleProvider = (id: ProviderId) => setProviders((old) => old.includes(id) ? old.filter((item) => item !== id) : [...old, id]);
  const next = () => setStep(2);
  const submit = async () => {
    setPreflightError("");
    if (!brand.name.trim()) return setPreflightError("请先填写品牌名称");
    if (!questions.length || questions.length > 10) return setPreflightError("请选择1—10个检测问题");
    setSubmitting(true);
    let createdId = "";
    try {
      const response = await fetch(`/api/detections/preflight?providers=${providers.join(",")}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => undefined) as { error?: string } | undefined;
      if (!response.ok) throw new Error(payload?.error || "AI平台暂时不可用，请稍后重试");
      createdId = start(brand.id, providers, questions, search.get("source") || undefined);
      await ensureServerDetectionTask(createdId);
      router.push(`/geo/progress/${createdId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "检测前检查失败";
      if (createdId) {
        const task = useAppStore.getState().detections.find((item) => item.id === createdId);
        if (task) {
          useAppStore.getState().syncServerDetection({
            ...task,
            status: "failed",
            stage: "failed",
            runErrors: [{
              provider: providers[0] || "doubao",
              questionId: "__task__",
              message,
              category: "network",
              retryable: true,
            }],
          });
        }
      }
      setPreflightError(message);
      setSubmitting(false);
    }
  };
  return <><PageHeader title="发起检测" description="选择AI平台和真实用户问题，创建本次品牌检测任务。" /><div className="card" style={{ padding: 6, marginBottom: 18 }}><div className="grid grid-2">{["检查品牌档案", "选择平台与问题"].map((label, index) => <div key={label} style={{ display: "flex", alignItems: "center", gap: 9, padding: 12, color: step >= index + 1 ? "var(--primary)" : "var(--text-muted)", background: step === index + 1 ? "var(--primary-soft)" : "transparent", borderRadius: 8 }}><span className="badge" style={{ background: step >= index + 1 ? "var(--primary)" : "#eaecf0", color: step >= index + 1 ? "#fff" : "#667085" }}>{step > index + 1 ? <Check size={13} /> : index + 1}</span><strong>{label}</strong></div>)}</div></div>
    {step === 1 && <Card title="确认品牌档案" description="仅品牌名称为必填项，资料完整度不会阻止检测。"><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}><strong style={{ fontSize: 26 }}>{brand.name}</strong><Badge tone={completeness >= 67 ? "success" : "warning"}>资料完整度 {completeness}%</Badge></div><Progress value={completeness} /><div style={{ marginTop: 18 }}><span className="secondary">可继续完善：</span>{missing.length ? missing.map((x) => <Badge key={x} tone="warning">{x}</Badge>) : <Badge tone="success">资料完整</Badge>}</div><div style={{ marginTop: 18 }}><Link className="btn" href="/brand/basic">编辑品牌信息</Link></div></Card>}
    {step === 2 && <div className="stack"><Card title="选择AI平台" description="豆包、DeepSeek和混元（腾讯元宝）均已接入真实模型API，可同时选择。"><div className="grid grid-3">{providerOptions.map((item) => { const selected = providers.includes(item.id); return <button type="button" key={item.id} aria-pressed={selected} onClick={() => toggleProvider(item.id)} style={{ display: "flex", alignItems: "center", gap: 13, minHeight: 76, padding: "14px 16px", borderRadius: 10, border: `1px solid ${selected ? "#6366f1" : "var(--line)"}`, background: selected ? "#fafaff" : "#f8fafc", textAlign: "left", cursor: "pointer" }}><span style={{ display: "grid", placeItems: "center", flex: "0 0 44px", width: 44, height: 44, borderRadius: 12, background: "#fff", border: "1px solid #eaecf0" }}><Image src={providerLogos[item.id]} alt={`${item.name} Logo`} width={34} height={34} style={{ width: 34, height: 34, objectFit: "contain", borderRadius: 8 }} /></span><strong style={{ flex: 1 }}>{item.name}</strong>{selected && <CheckCircle2 size={18} color="#4f46e5" />}</button>; })}</div></Card><Card title="选择检测问题" description={`已选择 ${questions.length}/10 条；每次检测都需要重新选择问题。`} action={<Link href="/geo/questions" className="btn btn-sm">管理问题库</Link>}><div className="stack">{brand.questions.filter((x) => x.enabled).map((item) => <label key={item.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: 13, border: `1px solid ${questions.includes(item.id) ? "#818cf8" : "var(--line)"}`, background: questions.includes(item.id) ? "#fafaff" : "#fff", borderRadius: 9 }}><input type="checkbox" checked={questions.includes(item.id)} disabled={!questions.includes(item.id) && questions.length >= 10} onChange={() => toggleQuestion(item.id)} style={{ marginTop: 3 }} /><strong>{item.text}</strong></label>)}{!brand.questions.some((item) => item.enabled) && <EmptyState title="暂无可用问题" description="请先生成或添加检测问题。" action={<Link className="btn btn-primary" href="/geo/questions/generate">AI生成问题</Link>} />}</div></Card></div>}
    {preflightError && <div className="notice notice-warning" style={{ marginTop: 18 }}><Info size={17} />{preflightError}</div>}
    <div className="form-actions" style={{ marginTop: 18 }}>{step > 1 ? <Button disabled={submitting} onClick={() => setStep(step - 1)}><ArrowLeft size={16} />上一步</Button> : <Button onClick={() => router.back()}>取消</Button>}{step === 1 ? <Button variant="primary" onClick={next}>下一步 <ArrowRight size={16} /></Button> : <Button variant="primary" disabled={submitting || !providers.length || !questions.length} onClick={() => void submit()}>{submitting ? "检查中…" : "开始检测"} <ArrowRight size={16} /></Button>}</div>
  </>;
}

export function DetectionProgressView() {
  const params = useParams<{ id: string }>(); const detection = useAppStore((s) => s.detections.find((x) => x.id === params.id)); const advance = useAppStore((s) => s.advanceDetection); const retry = useAppStore((s) => s.retryDetection);
  useEffect(() => { if (!detection || detection.status !== "running") return; const timer = window.setInterval(() => advance(detection.id), 650); return () => clearInterval(timer); }, [detection, advance]);
  if (!detection) return <EmptyState title="未找到检测任务" description="该检测任务不存在或不属于当前品牌。" action={<Link href="/geo/records" className="btn">返回检测记录</Link>} />;
  const percent = detection.totalRuns ? Math.round(detection.completedRuns / detection.totalRuns * 100) : 0;
  return <><PageHeader title="检测进度" description="正在逐平台执行检测问题，并整理AI回答与引用信源。" actions={<Badge tone={detection.status === "completed" ? "success" : detection.status === "failed" ? "danger" : "primary"}>{detection.status === "completed" ? "已完成" : detection.status === "failed" ? "检测失败" : "检测中"}</Badge>} /><Card><div style={{ display: "flex", alignItems: "center", gap: 18 }}><span className="empty-icon" style={{ margin: 0, width: 54, height: 54 }}>{detection.status === "completed" ? <CheckCircle2 size={26} /> : <LoaderCircle size={26} className="spin" />}</span><div style={{ flex: 1 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 9 }}><strong>{detection.status === "completed" ? "检测与诊断已完成" : "正在检测，请稍候"}</strong><strong>{percent}%</strong></div><Progress value={percent} success={percent === 100} /><div className="muted small" style={{ marginTop: 8 }}>{detection.completedRuns}/{detection.totalRuns} 个检测组合完成</div></div></div></Card><div className="grid grid-3 section-gap">{detection.providers.map((provider, index) => { const providerProgress = Math.max(0, Math.min(detection.questionIds.length, detection.completedRuns - index * detection.questionIds.length)); const complete = providerProgress >= detection.questionIds.length; return <Card key={provider}><div style={{ display: "flex", alignItems: "center", gap: 10 }}><span className="empty-icon" style={{ margin: 0, width: 40, height: 40 }}><Bot size={19} /></span><div><strong>{providerNames[provider]}</strong><div className="muted small" style={{ marginTop: 4 }}>{providerProgress}/{detection.questionIds.length} 个问题</div></div><Badge tone={complete ? "success" : providerProgress ? "primary" : "default"}>{complete ? "已完成" : providerProgress ? "检测中" : "等待中"}</Badge></div></Card>; })}</div><div className="form-actions" style={{ marginTop: 20 }}>{detection.status === "failed" && <Button onClick={() => retry(detection.id)}><RefreshCw size={16} />重试失败项</Button>}{detection.status === "completed" ? <Link className="btn btn-primary" href={`/geo/report/${detection.id}`}>查看诊断报告 <ArrowRight size={16} /></Link> : <Link className="btn" href="/workbench">返回工作台，后台继续</Link>}</div><style jsx global>{`.spin{animation:geo-spin 1s linear infinite}@keyframes geo-spin{to{transform:rotate(360deg)}}`}</style></>;
}

export function DetectionProgressViewV2() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const detection = useAppStore((state) => state.detections.find((item) => item.id === params.id));
  const advance = useAppStore((state) => state.advanceDetection);
  const retry = useAppStore((state) => state.retryDetection);

  useEffect(() => {
    if (!detection || detection.status !== "running" || detection.dataSource === "live_api") return;
    const timer = window.setInterval(() => advance(detection.id), 650);
    return () => window.clearInterval(timer);
  }, [advance, detection]);

  useEffect(() => {
    if (!detection || !detection.results.length) return;
    if (detection.status !== "completed" && detection.status !== "partial") return;
    const timer = window.setTimeout(() => router.replace(`/geo/results/${detection.id}`), 700);
    return () => window.clearTimeout(timer);
  }, [detection, router]);

  if (!detection) {
    return <>
      <PageHeader title="检测进度" description="查看检测任务的执行状态。" />
      <Card><EmptyState title="未找到检测任务" description="该检测任务不存在或不属于当前品牌。" /></Card>
    </>;
  }

  const percent = detection.totalRuns ? Math.round(detection.completedRuns / detection.totalRuns * 100) : 0;
  const isLive = detection.dataSource === "live_api";
  const isFinished = detection.status === "completed" || detection.status === "partial";
  const statusLabel = detection.status === "completed"
    ? "已完成"
    : detection.status === "partial"
      ? "部分完成"
      : detection.status === "failed"
        ? "检测失败"
        : "检测中";

  return <>
    {isLive && <LiveDetectionRunner detectionId={detection.id} />}
    <PageHeader
      title="检测进度"
      description={isLive ? "正在逐题采集1次模型API回答，并在采集完成后统一生成诊断。" : "正在逐平台执行检测问题，完成后将自动展示检测结果。"}
      actions={<Badge tone={detection.status === "completed" ? "success" : detection.status === "failed" ? "danger" : detection.status === "partial" ? "warning" : "primary"}>{statusLabel}</Badge>}
    />
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <span className="empty-icon" style={{ margin: 0, width: 54, height: 54 }}>{isFinished ? <CheckCircle2 size={26} /> : <LoaderCircle size={26} className={detection.status === "running" ? "spin" : ""} />}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 9 }}><strong>{isFinished ? "检测完成，正在打开结果页" : detection.status === "failed" ? "本次检测未获得有效回答" : "正在检测，请稍候"}</strong><strong>{percent}%</strong></div>
          <Progress value={percent} success={isFinished && percent === 100} />
          <div className="muted small" style={{ marginTop: 8 }}>{detection.completedRuns}/{detection.totalRuns} 个执行步骤已处理{detection.failedRuns > 0 ? ` · ${detection.failedRuns} 个失败` : ""}</div>
        </div>
      </div>
    </Card>
    {isLive && isFinished && <div className="notice section-gap"><Info size={17} />每个问题的单次原始回答已保存，规则分析与模型语义分析已完成。</div>}
    {!!detection.runErrors?.length && <div className="notice notice-warning section-gap"><Info size={17} /><div><strong>部分问题调用失败</strong><div className="small" style={{ marginTop: 5 }}>{detection.runErrors.map((item) => item.message).join("；")}</div></div></div>}
    <div className="grid grid-3 section-gap">
      {detection.providers.map((provider) => {
        const providerProgress = detection.results.filter((item) => item.provider === provider).length;
        const complete = providerProgress >= detection.questionIds.length;
        return <Card key={provider}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="empty-icon" style={{ margin: 0, width: 40, height: 40 }}><Bot size={19} /></span>
            <div><strong>{providerNames[provider]}</strong><div className="muted small" style={{ marginTop: 4 }}>{providerProgress}/{detection.questionIds.length} 个问题</div></div>
            <Badge tone={complete ? "success" : providerProgress ? "primary" : "default"}>{complete ? "已完成" : providerProgress ? "检测中" : "等待中"}</Badge>
          </div>
        </Card>;
      })}
    </div>
    <div className="form-actions" style={{ marginTop: 20 }}>
      {(detection.status === "failed" || (detection.status === "partial" && (!detection.diagnosis || !detection.diagnosis.suggestions.length))) && <Button onClick={() => retry(detection.id)}><RefreshCw size={16} />重试失败项</Button>}
      {isFinished ? <Badge tone="success">即将自动进入检测结果</Badge> : detection.status === "running" ? <Badge>请保持本页打开直至完成</Badge> : null}
    </div>
    <style jsx global>{`.spin{animation:geo-spin 1s linear infinite}@keyframes geo-spin{to{transform:rotate(360deg)}}`}</style>
  </>;
}

export function ReportView() {
  const router = useRouter(); const params = useParams<{ id: string }>(); const detection = useAppStore((s) => s.detections.find((x) => x.id === params.id)); const cycles = useAppStore((s) => s.cycles); const select = useAppStore((s) => s.selectObjective); const [confirming, setConfirming] = useState<string | null>(null); const [toast, setToast] = useState("");
  if (!detection?.diagnosis?.suggestions.length) return <EmptyState title="诊断报告尚未生成" description={detection?.dataSource === "live_api" && detection.results.length ? "原始回答已经保存，但本次批量分析未完成，可在检测进度页重试。" : "检测完成后才会生成四维诊断和优化建议。"} action={<Link className="btn" href={detection ? `/geo/progress/${detection.id}` : "/geo/records"}>{detection?.results.length ? "查看并重试" : "查看检测进度"}</Link>} />;
  const active = cycles.find((x) => x.brandId === detection.brandId && x.status === "active"); const suggestion = detection.diagnosis.suggestions.find((x) => x.id === confirming);
return <><PageHeader title="诊断报告" description={`${new Date(detection.completedAt || detection.createdAt).toLocaleString("zh-CN")} · ${detection.results.length}条有效回答`} actions={<><Link className="btn" href={`/geo/results/${detection.id}`}><FileSearch size={16} />查看回答与信源</Link><Link className="btn" href="/geo/records">历史记录</Link></>} /><DimensionCards current={detection.diagnosis.scores} availability={detection.diagnosis.scoreAvailability} /><div className="split-layout section-gap"><div className="stack"><Card title="诊断结论"><h2 style={{ fontSize: 20, lineHeight: 1.6, margin: 0 }}>{detection.diagnosis.summary}</h2></Card><Card title="主要问题与依据" description="每项结论均可追溯到本次AI回答和信源。"><div className="stack">{detection.diagnosis.issues.map((issue) => <article key={issue.id} style={{ padding: 16, border: "1px solid var(--line)", borderRadius: 10 }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><Badge tone={issue.severity === "high" ? "danger" : issue.severity === "medium" ? "warning" : "primary"}>{issue.severity === "high" ? "高优先级" : issue.severity === "medium" ? "中优先级" : "提示"}</Badge><Badge>{dimensions.find((x) => x.key === issue.dimension)?.label}</Badge></div><h3 style={{ margin: "11px 0 6px" }}>{issue.title}</h3><p className="secondary" style={{ margin: 0, lineHeight: 1.6 }}>{issue.evidence}</p><Link className="link small" href={`/geo/results/${detection.id}`} style={{ display: "inline-block", marginTop: 10 }}>查看问题依据 →</Link></article>)}</div></Card><ProviderPerformance detection={detection} /></div><Card title="选择优化目标" description="报告提供1—3项建议，只能确认其中一项作为本轮目标。">{active && <div className="notice" style={{ marginBottom: 14 }}>当前已有进行中的目标“{active.target}”。</div>}<div className="stack">{detection.diagnosis.suggestions.map((item, index) => <article key={item.id} style={{ padding: 16, border: `1px solid ${item.selected ? "#818cf8" : "var(--line)"}`, borderRadius: 10 }}><Badge tone="primary">建议 {index + 1}</Badge><h3 style={{ margin: "11px 0 6px" }}>{item.title}</h3><p className="muted small" style={{ lineHeight: 1.6, margin: "0 0 14px" }}><strong>目标依据：</strong>{item.reason}</p>{active ? <Link className="btn btn-soft btn-sm" href="/tasks">查看当前目标</Link> : <Button size="sm" variant="primary" onClick={() => setConfirming(item.id)}>选择此目标</Button>}</article>)}</div></Card></div><Modal open={!!confirming} title="确认优化目标" onClose={() => setConfirming(null)} footer={<><Button onClick={() => setConfirming(null)}>取消</Button><Button variant="primary" onClick={() => { if (!confirming) return; try { select(detection.id, confirming); router.push("/tasks"); } catch (error) { setToast(error instanceof Error ? error.message : "无法创建任务"); setConfirming(null); } }}>确认并创建7天任务</Button></>}><div className="notice notice-warning"><Lightbulb size={18} /><div><strong>{suggestion?.title}</strong><div style={{ marginTop: 5 }}>目标依据：{suggestion?.reason}</div></div></div></Modal>{toast && <Toast message={toast} onClose={() => setToast("")} />}</>;
}

export function ResultsView() {
  const params = useParams<{ id: string }>();
  const query = useSearchParams();
  const router = useRouter();
  const retry = useAppStore((state) => state.retryDetection);
  const detection = useAppStore((state) => state.detections.find((item) => item.id === params.id));
  const brand = useAppStore((state) => state.brands.find((item) => item.id === detection?.brandId));
  const [provider, setProvider] = useState(query.get("provider") || "all");
  const [question, setQuestion] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const results = useMemo(
    () => detection?.results.filter((item) =>
      (provider === "all" || item.provider === provider)
      && (question === "all" || item.questionId === question),
    ) || [],
    [detection, provider, question],
  );
  const detail = detection?.results.find((item) => item.id === selected) || results[0];
  if (!detection || !brand) return <EmptyState title="未找到检测结果" description="该检测不存在或不属于当前品牌。" />;
  const questionText = (id: string) => detection.results.find((item) => item.questionId === id)?.questionSnapshot || brand.questions.find((x) => x.id === id)?.text || "检测问题";
  const isLive = detection.dataSource === "live_api";

  return <>
    <PageHeader
      title="检测结果与信源明细"
      description={isLive ? "查看模型API原始回答、规则提取结果和模型分析结论。" : "逐平台、逐问题查看AI回答、品牌提及、竞品和引用来源。"}
      actions={<Link className="btn" href={detection.diagnosis ? `/geo/report/${detection.id}` : "/geo/records"}>{detection.diagnosis ? "返回诊断报告" : "返回检测记录"}</Link>}
    />
    {isLive && <div className="notice" style={{ marginBottom: 16 }}><Info size={17} />本次数据来自模型API，每个问题采集1次；名称提及由规则提取，推荐、情感和事实一致性由独立分析模型判断。</div>}
    {isLive && (!detection.diagnosis || !detection.diagnosis.suggestions.length) && detection.status === "partial" && <div className="notice notice-warning" style={{ marginBottom: 16 }}><Info size={17} /><div><strong>原始回答已保存，但批量分析未完成</strong><div className="small" style={{ marginTop: 5 }}>重试时将保留已采集回答，只补跑缺失项和分析步骤。</div></div><Button size="sm" onClick={() => { retry(detection.id); router.push(`/geo/progress/${detection.id}`); }}><RefreshCw size={15} />重试分析</Button></div>}
    <Card>
      <div className="form-row">
        <Field label="AI平台">
          <select className="select" value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="all">全部平台</option>
            {detection.providers.map((item) => <option value={item} key={item}>{providerNames[item]}</option>)}
          </select>
        </Field>
        <Field label="检测问题">
          <select className="select" value={question} onChange={(event) => setQuestion(event.target.value)}>
            <option value="all">全部问题</option>
            {detection.questionIds.map((id) => <option value={id} key={id}>{questionText(id)}</option>)}
          </select>
        </Field>
      </div>
    </Card>
    <div className="split-layout section-gap" style={{ gridTemplateColumns: "minmax(0, 420px) minmax(0, 1fr)" }}>
      <Card title={`检测结果（${results.length}）`}>
        <div className="stack">
          {results.map((item) => <button key={item.id} onClick={() => setSelected(item.id)} style={{ textAlign: "left", border: `1px solid ${detail?.id === item.id ? "#818cf8" : "var(--line)"}`, borderRadius: 9, background: detail?.id === item.id ? "#fafaff" : "#fff", padding: 14 }}>
            <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
              <Badge tone="primary">{providerNames[item.provider]}</Badge>
              {item.dataSource === "live_api" && <Badge tone="success">模型API</Badge>}
              {item.dataSource === "live_api" ? <Badge tone={item.mentionCount ? "success" : "default"}>{item.mentionCount ? `品牌出现 ${item.mentionCount}次` : "未提及品牌"}</Badge> : item.brandMentioned ? <Badge tone="success">提及品牌</Badge> : <Badge>未提及品牌</Badge>}
              {item.recommended && <Badge tone="success">形成推荐</Badge>}
            </div>
            <strong style={{ display: "block", marginTop: 10, lineHeight: 1.5 }}>{questionText(item.questionId)}</strong>
          </button>)}
          {!results.length && <EmptyState title="暂无匹配结果" description={detection.status === "failed" ? "本次调用失败，可返回进度页重试。" : "调整筛选条件后重试。"} />}
        </div>
      </Card>
      {detail && <Card title={questionText(detail.questionId)} description={`${providerNames[detail.provider]} · ${detail.recommendationPosition}`}>
        {detail.dataSource === "live_api" && detail.samples
          ? <LiveResultDetail result={detail} brandName={brand.name} />
          : <LegacyResultDetail result={detail} />}
      </Card>}
    </div>
  </>;
}

function LiveResultDetail({ result, brandName }: { result: DetectionResult; brandName: string }) {
  const sample = result.samples?.[0];
  return <>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
      <Badge tone={result.mentionCount ? "success" : "default"}>{result.mentionCount ? `提及${brandName} ${result.mentionCount}次` : `未提及${brandName}`}</Badge>
      <Badge tone={result.recommended ? "success" : "default"}>{result.recommendationPosition}</Badge>
      <Badge tone={result.accuracy === "准确" ? "success" : result.accuracy === "部分准确" ? "warning" : "default"}>事实一致性：{result.accuracy}</Badge>
      <Badge tone={result.sentimentLabel === "积极" ? "success" : result.sentimentLabel === "需改善" ? "danger" : "default"}>情感倾向：{result.sentimentLabel || "--"}</Badge>
      {result.competitorMentions.length > 0 && <Badge tone="warning">提及竞品：{result.competitorMentions.join("、")}</Badge>}
    </div>
    <h3 style={{ margin: "0 0 10px" }}>分析结论</h3>
    {result.analysisConclusion
      ? <div style={{ padding: 16, borderRadius: 9, background: "#f5f7ff", whiteSpace: "pre-wrap", lineHeight: 1.85 }}>{result.analysisConclusion}</div>
      : <div className="notice notice-warning"><Info size={17} />分析结论尚未生成，可查看原始回答并重试分析。</div>}
    {(result.recommendationEvidence || result.accuracyEvidence || result.sentimentEvidence) && <><h3 style={{ margin: "22px 0 10px" }}>判断依据</h3><div className="stack">
      {result.recommendationEvidence && <div className="notice"><strong>推荐判断：</strong>“{result.recommendationEvidence}”</div>}
      {result.accuracyEvidence && <div className="notice"><strong>事实一致性判断：</strong>“{result.accuracyEvidence}”</div>}
      {result.sentimentEvidence && <div className="notice"><strong>情感判断：</strong>“{result.sentimentEvidence}”</div>}
    </div></>}
    <h3 style={{ margin: "22px 0 10px" }}>AI原始回答</h3>
    {sample && <article style={{ border: "1px solid var(--line)", padding: 16, borderRadius: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <Badge tone={sample.brandMentioned ? "success" : "default"}>{sample.brandMentioned ? "提及品牌" : "未提及品牌"}</Badge>
        {sample.competitorMentions.length > 0 && <Badge tone="warning">竞品：{sample.competitorMentions.join("、")}</Badge>}
        <span className="muted small" style={{ marginLeft: "auto" }}>{sample.model}</span>
      </div>
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.85 }}>{sample.answer}</div>
    </article>}
    <div className="notice" style={{ marginTop: 16 }}><Info size={17} />本次未启用联网搜索，因此不展示网页引用信源。</div>
  </>;
}

function LegacyResultDetail({ result }: { result: DetectionResult }) {
  return <>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
      <Badge tone={result.accuracy === "准确" ? "success" : "warning"}>事实一致性：{result.accuracy}</Badge>
      <Badge tone={result.sentimentLabel === "积极" ? "success" : result.sentimentLabel === "需改善" ? "danger" : "default"}>情感倾向：{result.sentimentLabel || "--"}</Badge>
      {result.competitorMentions.length > 0 && <Badge tone="warning">提及竞品：{result.competitorMentions.join("、")}</Badge>}
    </div>
    <h3 style={{ margin: "0 0 10px" }}>AI原始回答</h3>
    <div style={{ padding: 16, borderRadius: 9, background: "#f8fafc", whiteSpace: "pre-wrap", lineHeight: 1.85 }}>{result.answer}</div>
    <h3 style={{ margin: "22px 0 10px" }}>引用信源</h3>
    {result.citations.length ? <div className="stack">{result.citations.map((citation) => <article key={citation.id} style={{ border: "1px solid var(--line)", padding: 14, borderRadius: 9 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}><Link2 size={16} color="#4f46e5" /><a className="link" href={citation.url} target="_blank" rel="noreferrer"><strong>{citation.title}</strong></a><Badge>{citation.type}</Badge></div>
      {citation.excerpt && <p className="secondary" style={{ margin: "8px 0", lineHeight: 1.55 }}>{citation.excerpt}</p>}
      <div className="small muted">相关性 {citation.relevance} · 可信度 {citation.credibility}</div>
    </article>)}</div> : <div className="notice"><Info size={17} />该回答未引用外部信源。</div>}
  </>;
}

export function RecordsView() {
  const detections = useBrandDetectionList();
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) => setSelected((old) => old.includes(id) ? old.filter((item) => item !== id) : old.length < 2 ? [...old, id] : [old[1], id]);
  const statusLabel = (item: Detection) => item.status === "completed"
    ? "已完成"
    : item.status === "partial"
      ? "部分完成"
      : item.status === "failed"
        ? "检测失败"
        : "检测中";

  return <GeoFrame title="检测记录" description="查看当前品牌历次检测任务、报告和结果。" actions={<Link className="btn btn-primary" href="/geo/new"><Plus size={16} />发起检测</Link>}>
    <Card>
      {detections.length ? <>
        <div className="notice" style={{ marginBottom: 16 }}>仅已生成诊断报告的检测可参与四维指标对比；真实API回答可直接查看结果明细。</div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>对比</th><th>检测名称</th><th>创建时间</th><th>AI平台</th><th>问题数</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>{detections.map((item) => <tr key={item.id}>
              <td><input type="checkbox" disabled={!item.diagnosis} checked={selected.includes(item.id)} onChange={() => toggle(item.id)} /></td>
              <td><div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}><strong>{item.name}</strong>{item.dataSource === "live_api" && <Badge tone="success">模型API</Badge>}</div></td>
              <td>{new Date(item.createdAt).toLocaleString("zh-CN")}</td>
              <td>{item.providers.map((provider) => providerNames[provider]).join("、")}</td>
              <td>{item.questionIds.length}</td>
              <td><Badge tone={item.status === "completed" ? "success" : item.status === "failed" ? "danger" : item.status === "partial" ? "warning" : "primary"}>{statusLabel(item)}</Badge></td>
              <td><div className="table-row-action">
                {item.results.length > 0 && <Link className="btn btn-sm" href={`/geo/results/${item.id}`}>结果明细</Link>}
                {item.diagnosis && <Link className="btn btn-ghost btn-sm" href={`/geo/report/${item.id}`}>查看报告</Link>}
                {(item.status === "running" || item.status === "failed") && <Link className="btn btn-sm" href={`/geo/progress/${item.id}`}>{item.status === "failed" ? "查看并重试" : "查看进度"}</Link>}
              </div></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="form-actions"><Link aria-disabled={selected.length !== 2} className={`btn btn-primary ${selected.length !== 2 ? "disabled" : ""}`} href={selected.length === 2 ? `/geo/compare?a=${selected[0]}&b=${selected[1]}` : "#"}>对比所选检测</Link></div>
      </> : <EmptyState title="暂无检测记录" description="发起首次检测后，记录将保存在这里。" action={<Link href="/geo/new" className="btn btn-primary">开始首次检测</Link>} />}
    </Card>
  </GeoFrame>;
}

export function CompareView() {
  const query = useSearchParams(); const allDetections = useBrandDetectionList(); const detections = useMemo(() => allDetections.filter((x) => x.status === "completed" && x.diagnosis), [allDetections]); const [a, setA] = useState(query.get("a") || detections[1]?.id || detections[0]?.id || ""); const [b, setB] = useState(query.get("b") || detections[0]?.id || ""); const first = detections.find((x) => x.id === a); const second = detections.find((x) => x.id === b);
  if (detections.length < 2) return <><PageHeader title="检测结果对比" description="对比同一品牌两次已完成检测。" /><Card><EmptyState title="至少需要两次检测" description="完成下一次检测后，即可查看优化前后的指标变化。" action={<Link className="btn btn-primary" href="/geo/new">发起新检测</Link>} /></Card></>;
  return <><PageHeader title="检测结果对比" description="比较两次已完成检测的四维指标、平台表现和期间优化动作。" actions={<Link className="btn" href="/geo/records">返回检测记录</Link>} /><Card><div className="form-row"><Field label="较早检测"><select className="select" value={a} onChange={(e) => setA(e.target.value)}>{detections.map((x) => <option key={x.id} value={x.id}>{new Date(x.completedAt || x.createdAt).toLocaleString("zh-CN")} · {x.name}</option>)}</select></Field><Field label="较新检测"><select className="select" value={b} onChange={(e) => setB(e.target.value)}>{detections.map((x) => <option key={x.id} value={x.id}>{new Date(x.completedAt || x.createdAt).toLocaleString("zh-CN")} · {x.name}</option>)}</select></Field></div>{a === b && <div className="notice notice-warning" style={{ marginTop: 14 }}>请选择两次不同的检测记录。</div>}</Card>{first?.diagnosis && second?.diagnosis && a !== b && <><div className="grid grid-4 section-gap">{dimensions.map((item) => { const before = first.diagnosis!.scores[item.key]; const after = second.diagnosis!.scores[item.key]; const delta = after - before; return <div className="card metric-card" key={item.key}><div className="metric-label">{item.label}</div><div className="metric-value">{after}</div><div className="metric-meta"><span className={delta >= 0 ? "trend-up" : "trend-down"}>{delta >= 0 ? "↑" : "↓"} {Math.abs(delta)}</span> · 前次 {before}</div></div>; })}</div><div className="grid grid-2 section-gap"><Card title="变化摘要"><div className="stack">{dimensions.map((item) => { const delta = second.diagnosis!.scores[item.key] - first.diagnosis!.scores[item.key]; return <div key={item.key} style={{ display: "flex", alignItems: "center", gap: 12 }}><span style={{ width: 80 }}>{item.label}</span><Progress value={second.diagnosis!.scores[item.key]} /><strong className={delta >= 0 ? "trend-up" : "trend-down"} style={{ width: 55, textAlign: "right" }}>{delta >= 0 ? "+" : ""}{delta}</strong></div>; })}</div></Card><Card title="期间优化动作" description="仅用于说明两次检测之间做过什么，不作为评分来源。"><PeriodActions from={first.createdAt} to={second.createdAt} /></Card></div></>}</>;
}
function PeriodActions({ from, to }: { from: string; to: string }) { const cycles = useAppStore((s) => s.cycles); const records = useAppStore((s) => s.publishRecords); const actions = cycles.filter((x) => x.startDate >= from.slice(0, 10) && x.startDate <= to.slice(0, 10)); const published = records.filter((x) => x.createdAt >= from && x.createdAt <= to); return <div className="stack"><div className="notice"><CheckCircle2 size={17} />{actions.length} 个优化周期，完成 {actions.reduce((sum, x) => sum + x.tasks.filter((t) => t.status === "completed").length, 0)} 项任务</div><div className="notice"><Link2 size={17} />期间发布 {published.length} 篇内容</div></div>; }
