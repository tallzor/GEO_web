"use client";

// Legacy view collection kept behind the canonical task-views facade during the architecture cleanup.

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, Copy, ExternalLink, RefreshCw, Send, ShieldCheck, StopCircle, Target } from "lucide-react";
import { useMemo, useState } from "react";
import { ModuleNav } from "@/components/module-nav";
import { OperationProgress } from "@/components/operation-progress";
import { Badge, Button, Card, Drawer, EmptyState, Field, Modal, PageHeader, Progress, Toast } from "@/components/ui";
import { activeCycle, currentBrand, flushWorkspaceNow, useAppStore } from "@/lib/store";
import { Brand, ChannelId, OptimizationCycle, OptimizationTask, TaskStatus } from "@/lib/types";

const taskNav = [{ href: "/tasks", label: "任务概览" }, { href: "/publishes", label: "发布记录" }];
const taskStatus: Record<TaskStatus, { label: string; tone: "default" | "primary" | "success" | "warning" }> = { pending: { label: "待开始", tone: "default" }, in_progress: { label: "进行中", tone: "primary" }, completed: { label: "已完成", tone: "success" }, void: { label: "已作废", tone: "warning" } };

/* 已停用：以下 V1 任务、内容和发布页面已由本文件的 V2 页面及 publishing-views 取代。
export function TasksView() {
  const router = useRouter(); const brand = useAppStore(currentBrand)!; const cycle = useAppStore(activeCycle); const rawCycles = useAppStore((s) => s.cycles); const rawContents = useAppStore((s) => s.contents); const rawRecords = useAppStore((s) => s.publishRecords); const rawDetections = useAppStore((s) => s.detections); const allCycles = useMemo(() => rawCycles.filter((x) => x.brandId === brand.id), [rawCycles, brand.id]); const contents = useMemo(() => rawContents.filter((x) => x.brandId === brand.id), [rawContents, brand.id]); const records = useMemo(() => rawRecords.filter((x) => x.brandId === brand.id), [rawRecords, brand.id]); const detections = useMemo(() => rawDetections.filter((x) => x.brandId === brand.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [rawDetections, brand.id]); const updateTask = useAppStore((s) => s.updateTaskStatus); const ensureContent = useAppStore((s) => s.ensureTaskContent); const terminate = useAppStore((s) => s.terminateCycle);
  const [taskId, setTaskId] = useState<string | null>(null); const [terminateOpen, setTerminateOpen] = useState(false); const selectedTask = cycle?.tasks.find((x) => x.id === taskId); const latestPast = allCycles.find((x) => x.status !== "active"); const latestDetection = detections.find((x) => x.status === "completed" && x.diagnosis);
  if (!cycle) return <><PageHeader title="内容与任务" description="围绕已确认目标执行7天GEO优化任务。" /><ModuleNav items={taskNav} /><Card>{latestPast?.status === "terminated" ? <EmptyState title="上一轮任务已终止" description="原优化任务已作废，可以返回最近一次分析重新选择目标。" action={latestDetection ? <Link className="btn btn-primary" href={`/analysis/visibility?detection=${latestDetection.id}`}>重新选择优化目标</Link> : undefined} icon={<StopCircle size={24} />} /> : latestPast?.status === "completed" ? <EmptyState title="本轮优化任务已完成" description="已完成目标相关任务，可在合适时间发起下一次GEO检测查看变化。" action={<Link className="btn btn-primary" href="/geo/new">发起下一次检测</Link>} icon={<CheckCircle2 size={24} />} /> : latestDetection ? <EmptyState title="还没有选择优化目标" description="请从最近一次分析的1—3项建议中选择一项，系统将生成7天任务。" action={<Link className="btn btn-primary" href={`/analysis/visibility?detection=${latestDetection.id}`}>选择优化目标</Link>} icon={<Target size={24} />} /> : <EmptyState title="还没有GEO诊断" description="先发起检测，完成分析后才能规划优化目标和任务。" action={<Link className="btn btn-primary" href="/geo/new">发起GEO检测</Link>} />}</Card></>;
  const completed = cycle.tasks.filter((x) => x.status === "completed").length; const inProgress = cycle.tasks.filter((x) => x.status === "in_progress").length; const pending = cycle.tasks.filter((x) => x.status === "pending").length; const percent = Math.round(completed / cycle.tasks.length * 100); const todayTasks = cycle.tasks.filter((x) => x.day === cycle.currentDay); const latestContent = contents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const execute = async (task: OptimizationTask) => { if (task.type === "content" || task.type === "review" || task.type === "publish") { const id = await ensureContent(cycle.id, task.id); router.push(`/content/${id}`); } else { updateTask(cycle.id, task.id, task.status === "completed" ? "completed" : "in_progress"); setTaskId(task.id); } };
  return <><PageHeader title="内容与任务" description="目标确认后按7天任务推进，今天优先完成当前待办。" actions={<><Link className="btn" href="/publishes"><History size={16} />发布记录</Link><Button variant="danger" onClick={() => setTerminateOpen(true)}><StopCircle size={16} />终止任务</Button></>} /><ModuleNav items={taskNav} /><Card title="当前优化目标" description={`来源：${new Date(cycle.startDate).toLocaleDateString("zh-CN")} 诊断报告`} action={<Badge tone="primary"><span className="status-dot" />进行中</Badge>}><div className="split-layout" style={{ gridTemplateColumns: "minmax(0, 1fr) 260px" }}><div><div style={{ display: "flex", gap: 10, alignItems: "center" }}><span className="empty-icon" style={{ margin: 0 }}><Target size={22} /></span><div><h2 style={{ margin: 0, fontSize: 21 }}>{cycle.target}</h2><p className="secondary" style={{ margin: "6px 0 0", lineHeight: 1.6 }}>{cycle.description}</p></div></div><div className="notice" style={{ marginTop: 17 }}><LockKeyhole size={17} />目标进行期间不可直接变更；如需调整，须先终止本轮任务。</div></div><div style={{ padding: 16, border: "1px solid var(--line)", borderRadius: 10 }}><div style={{ display: "flex", justifyContent: "space-between" }}><span className="secondary">当前进度</span><strong>第 {cycle.currentDay}/7 天</strong></div><Progress value={cycle.currentDay / 7 * 100} /><div className="muted small" style={{ marginTop: 9 }}>{cycle.startDate} — {cycle.endDate}</div></div></div></Card>
    <div className="grid grid-4 section-gap"><div className="card metric-card"><div className="metric-label">任务进度</div><div className="metric-value">{percent}%</div><div className="metric-meta">{completed}/{cycle.tasks.length} 项已完成</div></div><div className="card metric-card"><div className="metric-label">已完成</div><div className="metric-value trend-up">{completed}</div><div className="metric-meta">已形成可追溯执行记录</div></div><div className="card metric-card"><div className="metric-label">进行中</div><div className="metric-value" style={{ color: "var(--primary)" }}>{inProgress}</div><div className="metric-meta">需要继续处理</div></div><div className="card metric-card"><div className="metric-label">待完成</div><div className="metric-value">{pending}</div><div className="metric-meta">按7天计划逐项完成</div></div></div>
    <div className="split-layout section-gap"><div className="stack"><Card title="7天优化任务表" description="默认定位当前日，也可以查看并提前处理其他日期。"><div className="timeline">{cycle.tasks.map((task) => <button key={task.id} className={`day-card ${task.day === cycle.currentDay ? "current" : ""}`} onClick={() => setTaskId(task.id)} style={{ textAlign: "left" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span className="day-number">第 {task.day} 天</span><Badge tone={taskStatus[task.status].tone}>{taskStatus[task.status].label}</Badge></div><div className="day-title">{task.title}</div><p className="muted small" style={{ lineHeight: 1.5, margin: 0 }}>{task.description}</p>{task.contentId && <span className="link small" style={{ display: "block", marginTop: 9 }}>已关联内容</span>}</button>)}</div></Card>{latestContent && <Card title="关联内容" description="当前任务周期最近编辑的内容。" action={<Link className="btn btn-sm" href={`/content/${latestContent.id}`}>继续编辑 <ArrowRight size={14} /></Link>}><div style={{ display: "flex", alignItems: "center", gap: 12 }}><span className="empty-icon" style={{ margin: 0 }}><FileText size={21} /></span><div><strong>{latestContent.title}</strong><div className="muted small" style={{ marginTop: 5 }}>{channelNames[latestContent.selectedChannel]} · 版本 {latestContent.version} · {contentStatusLabel(latestContent.status)}</div></div></div></Card>}</div><div className="stack"><Card title="今日任务" description={`第 ${cycle.currentDay} 天，共 ${todayTasks.length} 项待办。`}>{todayTasks.map((task) => <article key={task.id} style={{ padding: 14, border: "1px solid var(--line)", borderRadius: 9, marginBottom: 10 }}><Badge tone={taskStatus[task.status].tone}>{taskStatus[task.status].label}</Badge><h3 style={{ margin: "10px 0 6px", fontSize: 15 }}>{task.title}</h3><p className="muted small" style={{ lineHeight: 1.55 }}>{task.description}</p><Button size="sm" variant={task.status === "completed" ? "default" : "primary"} onClick={() => execute(task)}>{task.status === "completed" ? "查看详情" : "继续任务"}</Button></article>)}</Card><Card title="最近发布" action={<Link className="link small" href="/publishes">查看全部</Link>}>{records.slice(0, 3).map((record) => <Link href={`/publishes?record=${record.id}`} key={record.id} style={{ display: "block", padding: "11px 0", borderBottom: "1px solid var(--line)" }}><strong>{record.title}</strong><div className="muted small" style={{ marginTop: 5 }}>{channelNames[record.channel]} · {new Date(record.createdAt).toLocaleDateString("zh-CN")}</div></Link>)}{!records.length && <p className="muted">暂无发布记录</p>}</Card></div></div>
    <TaskDrawer task={selectedTask} contentId={selectedTask?.contentId} onClose={() => setTaskId(null)} onExecute={() => { if (selectedTask) void execute(selectedTask); }} onComplete={() => { if (selectedTask) updateTask(cycle.id, selectedTask.id, "completed"); setTaskId(null); }} />
    <Modal open={terminateOpen} title="终止当前任务？" description="该操作不可恢复，请确认后再继续。" onClose={() => setTerminateOpen(false)} footer={<><Button onClick={() => setTerminateOpen(false)}>取消</Button><Button variant="danger" onClick={() => { terminate(cycle.id); setTerminateOpen(false); }}>确认终止任务</Button></>}><div className="notice notice-danger"><AlertTriangle size={19} /><div>终止后，当前目标和所有未完成任务将作废；已发布内容和历史记录保留。之后可从诊断报告重新选择目标。</div></div></Modal>
  </>;
}

function TaskDrawer({ task, contentId, onClose, onExecute, onComplete }: { task?: OptimizationTask; contentId?: string; onClose: () => void; onExecute: () => void; onComplete: () => void }) {
  if (!task) return null; const automatic = task.type === "publish";
  return <Drawer open title={task.title} description={`第 ${task.day} 天任务`} onClose={onClose}><div className="stack"><div style={{ display: "flex", gap: 8 }}><Badge tone={taskStatus[task.status].tone}>{taskStatus[task.status].label}</Badge><Badge>{taskTypeLabel(task.type)}</Badge></div><Card title="任务说明"><p className="secondary" style={{ lineHeight: 1.7, margin: 0 }}>{task.description}</p></Card><Card title="执行要求"><ul style={{ margin: 0, paddingLeft: 20, lineHeight: 2 }}><li>围绕当前已确认目标执行，不改变目标范围</li><li>使用当前品牌档案和已生效知识资料</li><li>发布前完成违禁词、敏感表达和事实一致性检查</li></ul></Card>{task.completedAt && <div className="notice notice-success"><CheckCircle2 size={17} />完成时间：{new Date(task.completedAt).toLocaleString("zh-CN")}</div>}{contentId && <Link href={`/content/${contentId}`} className="btn"><FileText size={16} />查看关联内容</Link>}{task.status !== "completed" && task.status !== "void" && <><Button variant="primary" onClick={onExecute}>{contentId ? "继续编辑内容" : task.type === "content" ? "生成内容" : "开始任务"}<ArrowRight size={16} /></Button>{!automatic && <Button onClick={onComplete}>标记为已完成</Button>}</>}</div></Drawer>;
}
function taskTypeLabel(type: OptimizationTask["type"]) { return ({ profile: "档案完善", content: "内容生成", review: "内容检查", publish: "内容发布", retest: "复测准备" } as const)[type]; }
function contentStatusLabel(status: string) { return ({ draft: "草稿", checking: "检查中", blocked: "检查未通过", publishable: "可发布", publishing: "发布中", published: "已发布", failed: "发布失败" } as Record<string, string>)[status] || status; }

export function ContentEditorView() {
  const params = useParams<{ id: string }>(); const router = useRouter(); const content = useAppStore((s) => s.contents.find((x) => x.id === params.id)); const brand = useAppStore((s) => s.brands.find((x) => x.id === content?.brandId)); const cycle = useAppStore((s) => s.cycles.find((x) => x.id === content?.cycleId)); const platforms = useAppStore((s) => s.platforms); const updateChannel = useAppStore((s) => s.updateChannelContent); const updateContent = useAppStore((s) => s.updateContent); const regenerate = useAppStore((s) => s.regenerateContent); const check = useAppStore((s) => s.runRiskCheck); const publish = useAppStore((s) => s.publishContent);
  const [channel, setChannel] = useState<ChannelId>(content?.selectedChannel || "xiaohongshu"); const channelData = content?.channels.find((x) => x.channel === channel); const [title, setTitle] = useState(channelData?.title || ""); const [body, setBody] = useState(channelData?.body || ""); const [confirmOpen, setConfirmOpen] = useState(false); const [previewOpen, setPreviewOpen] = useState(false); const [toast, setToast] = useState("");
  if (!content || !brand || !cycle) return <EmptyState title="未找到关联内容" description="内容必须从当前优化任务中生成，不能创建无来源内容。" action={<Link href="/tasks" className="btn">返回任务概览</Link>} />;
  const switchChannel = (next: ChannelId) => { updateChannel(content.id, channel, title, body); const nextData = content.channels.find((x) => x.channel === next); setChannel(next); setTitle(nextData?.title || ""); setBody(nextData?.body || ""); updateContent(content.id, { selectedChannel: next }); };
  const save = () => { if (!title.trim() || !body.trim()) { setToast("标题和正文不能为空"); return; } updateChannel(content.id, channel, title, body); setToast("内容已保存"); };
  const runCheck = () => { updateChannel(content.id, channel, title, body); check(content.id); setToast("内容风险检查已完成"); };
  const selectedPlatform = platforms.find((x) => x.channel === channel);
  return <><PageHeader title="内容生成与编辑" description="内容来自当前目标、任务和品牌知识，审核后由用户确认发布。" actions={<><Button onClick={() => router.push("/tasks")}>返回任务</Button><Button onClick={() => { regenerate(content.id); window.location.reload(); }}><RefreshCw size={16} />重新生成</Button><Button variant="primary" onClick={save}><Save size={16} />保存内容</Button></>} /><Card><div className="grid grid-4"><ContextItem label="当前品牌" value={brand.name} /><ContextItem label="关联目标" value={cycle.target} /><ContextItem label="关联任务" value={cycle.tasks.find((x) => x.id === content.taskId)?.title || "内容任务"} /><ContextItem label="内容状态" value={`${contentStatusLabel(content.status)} · 版本 ${content.version}`} /></div></Card><div className="split-layout section-gap" style={{ gridTemplateColumns: "minmax(0, 1fr) 340px" }}><div className="stack"><Card title="渠道内容版本" description="每个渠道独立保存标题和正文。"><div className="tabs" style={{ marginBottom: 18 }}>{channelOptions.map((item) => <button key={item.id} className={`tab ${channel === item.id ? "active" : ""}`} onClick={() => switchChannel(item.id)}>{item.name}{platforms.find((x) => x.channel === item.id)?.configured ? "" : "（未配置）"}</button>)}</div><div className="stack"><Field label="内容标题" required><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} /></Field><Field label="内容正文" required hint={`${body.length} 字 · 修改后需重新运行风险检查`}><textarea className="textarea" style={{ minHeight: 390 }} value={body} onChange={(e) => setBody(e.target.value)} /></Field><div className="form-actions"><Button onClick={() => setPreviewOpen(true)}><EyeIcon />预览</Button><Button onClick={save}><Save size={16} />保存草稿</Button></div></div></Card><Card title="使用的品牌事实" description="仅使用档案和已解析生效的知识资料。"><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{brand.products.slice(0, 3).map((x) => <Badge key={x.id} tone="primary">{x.name}</Badge>)}{brand.knowledge.filter((x) => x.status === "active").map((x) => <Badge key={x.id} tone="success">{x.fileName}</Badge>)}</div></Card></div><div className="stack"><Card title="风险与合规检查" description="产品只做内容合格兜底，最终审核由用户完成。"><div style={{ display: "flex", justifyContent: "center", padding: "8px 0 18px" }}><div className="score-ring" style={{ "--value": content.riskStatus === "passed" ? 100 : content.riskStatus === "warning" ? 80 : content.riskStatus === "blocked" ? 36 : 0 } as React.CSSProperties}><strong>{content.riskStatus === "passed" ? "通过" : content.riskStatus === "warning" ? "提醒" : content.riskStatus === "blocked" ? "阻止" : "未检查"}</strong></div></div>{content.riskIssues.length ? <div className="stack">{content.riskIssues.map((issue) => <div className={`notice ${issue.blocking ? "notice-danger" : "notice-warning"}`} key={issue.id}><AlertTriangle size={17} /><div><strong>{issue.term}</strong><div className="small" style={{ marginTop: 3 }}>{issue.message}</div></div></div>)}</div> : content.riskStatus !== "unchecked" && <div className="notice notice-success"><ShieldCheck size={18} />未发现违禁词或品牌事实冲突。</div>}<Button style={{ width: "100%", marginTop: 15 }} onClick={runCheck}><ShieldCheck size={16} />运行风险检查</Button></Card><Card title="发布内容" description="执行发布即表示用户已完成内容自审。"><div className="stack"><div style={{ display: "flex", justifyContent: "space-between" }}><span>{channelNames[channel]}</span><Badge tone={selectedPlatform?.configured ? "success" : "warning"}>{selectedPlatform?.configured ? selectedPlatform.accountName : "未配置"}</Badge></div>{!selectedPlatform?.configured && <Link className="btn" href="/settings/platforms">配置发布平台</Link>}<Button variant="primary" disabled={!selectedPlatform?.configured || (content.riskStatus !== "passed" && content.riskStatus !== "warning")} onClick={() => { save(); setConfirmOpen(true); }}><Send size={16} />审核后发布</Button></div></Card></div></div><Modal open={confirmOpen} title="确认发布内容" description="请确认本次实际发布的渠道、账号和内容版本。" onClose={() => setConfirmOpen(false)} footer={<><Button onClick={() => setConfirmOpen(false)}>取消</Button><Button variant="primary" onClick={() => { try { publish(content.id, channel); setConfirmOpen(false); router.push("/publishes"); } catch (error) { setToast(error instanceof Error ? error.message : "发布失败"); } }}>确认并发布</Button></>}><div className="stack"><div className="notice notice-warning"><AlertTriangle size={18} />执行发布即代表您已完成内容自审，并同意发布当前内容快照。</div><ContextItem label="发布平台与账号" value={`${channelNames[channel]} · ${selectedPlatform?.accountName || "未配置"}`} /><ContextItem label="内容版本" value={`版本 ${content.version}`} /><ContextItem label="关联目标与任务" value={`${cycle.target} · ${cycle.tasks.find((x) => x.id === content.taskId)?.title}`} /><ContextItem label="风险检查结论" value={content.riskStatus === "passed" ? "已通过" : "存在提醒，允许发布"} /></div></Modal><Modal open={previewOpen} title={`${channelNames[channel]}发布预览`} onClose={() => setPreviewOpen(false)} footer={<Button onClick={() => setPreviewOpen(false)}>关闭预览</Button>}><article style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 20 }}><div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}><span className="avatar">{brand.name.slice(0, 1)}</span><div><strong>{brand.name}</strong><div className="muted small">刚刚 · {channelNames[channel]}</div></div></div><h2 style={{ lineHeight: 1.5 }}>{title}</h2><div style={{ whiteSpace: "pre-wrap", lineHeight: 1.8 }}>{body}</div></article></Modal>{toast && <Toast message={toast} onClose={() => setToast("")} />}</>;
}
function EyeIcon() { return <ExternalLink size={16} />; }
function ContextItem({ label, value }: { label: string; value: string }) { return <div><div className="muted small">{label}</div><strong style={{ display: "block", marginTop: 6, lineHeight: 1.45 }}>{value}</strong></div>; }

export function PublishesView() {
  const brand = useAppStore(currentBrand)!; const rawRecords = useAppStore((s) => s.publishRecords); const records = useMemo(() => rawRecords.filter((x) => x.brandId === brand.id), [rawRecords, brand.id]); const retry = useAppStore((s) => s.retryPublish); const [status, setStatus] = useState("all"); const [channel, setChannel] = useState("all"); const [recordId, setRecordId] = useState<string | null>(null); const filtered = useMemo(() => records.filter((x) => (status === "all" || x.status === status) && (channel === "all" || x.channel === channel)), [records, status, channel]); const selected = records.find((x) => x.id === recordId);
  return <><PageHeader title="发布记录" description="查看当前品牌的内容发布状态、实际内容快照和关联任务。" actions={<Link className="btn btn-primary" href="/tasks">返回当前任务</Link>} /><ModuleNav items={taskNav} /><Card><div className="form-row" style={{ marginBottom: 16 }}><Field label="发布状态"><select className="select" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">全部状态</option><option value="published">发布成功</option><option value="publishing">发布中</option><option value="failed">发布失败</option></select></Field><Field label="发布平台"><select className="select" value={channel} onChange={(e) => setChannel(e.target.value)}><option value="all">全部平台</option>{channelOptions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field></div>{filtered.length ? <div className="table-wrap"><table className="table"><thead><tr><th>内容标题</th><th>发布平台</th><th>发布账号</th><th>发布时间</th><th>状态</th><th>操作</th></tr></thead><tbody>{filtered.map((record) => <tr key={record.id}><td><strong>{record.title}</strong><div className="muted small">内容版本 {record.contentVersion}</div></td><td>{channelNames[record.channel]}</td><td>{record.accountName}</td><td>{new Date(record.createdAt).toLocaleString("zh-CN")}</td><td><Badge tone={record.status === "published" ? "success" : record.status === "failed" ? "danger" : "primary"}>{record.status === "published" ? "发布成功" : record.status === "failed" ? "发布失败" : "发布中"}</Badge></td><td><div className="table-row-action"><Button size="sm" onClick={() => setRecordId(record.id)}>查看详情</Button>{record.status === "failed" && <Button size="sm" variant="soft" onClick={() => retry(record.id)}>重试</Button>}</div></td></tr>)}</tbody></table></div> : <EmptyState title="暂无发布记录" description="从当前任务生成内容并完成风险检查后，即可模拟发布。" action={<Link className="btn btn-primary" href="/tasks">前往任务概览</Link>} icon={<Rocket size={24} />} />}</Card><PublishDrawer record={selected} onClose={() => setRecordId(null)} onRetry={() => { if (selected) retry(selected.id); }} /></>;
}
function PublishDrawer({ record, onClose, onRetry }: { record?: PublishRecord; onClose: () => void; onRetry: () => void }) { if (!record) return null; return <Drawer open title="发布记录详情" description={`内容版本 ${record.contentVersion}`} onClose={onClose}><div className="stack"><div><Badge tone={record.status === "published" ? "success" : record.status === "failed" ? "danger" : "primary"}>{record.status === "published" ? "发布成功" : record.status === "failed" ? "发布失败" : "发布中"}</Badge></div><Card title="发布信息"><div className="stack"><ContextItem label="平台与账号" value={`${channelNames[record.channel]} · ${record.accountName}`} /><ContextItem label="发起时间" value={new Date(record.createdAt).toLocaleString("zh-CN")} />{record.completedAt && <ContextItem label="完成时间" value={new Date(record.completedAt).toLocaleString("zh-CN")} />}</div></Card><Card title="发布内容快照"><h3>{record.title}</h3><div style={{ whiteSpace: "pre-wrap", lineHeight: 1.8 }}>{record.bodySnapshot}</div></Card>{record.error && <div className="notice notice-danger"><XCircle size={17} />{record.error}</div>}<Link className="btn" href={`/content/${record.contentId}`}><Edit3 size={16} />基于该内容继续编辑</Link>{record.status === "failed" && <Button variant="primary" onClick={onRetry}><RefreshCw size={16} />重试发布</Button>}</div></Drawer>; }
*/

function EyeIcon() { return <ExternalLink size={16} />; }

export function ContentEditorViewV2() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const content = useAppStore((state) => state.contents.find((item) => item.id === params.id));
  const brand = useAppStore((state) => state.brands.find((item) => item.id === content?.brandId));
  const cycle = useAppStore((state) => state.cycles.find((item) => item.id === content?.cycleId));
  const task = cycle?.tasks.find((item) => item.id === content?.taskId);
  const updateChannel = useAppStore((state) => state.updateChannelContent);
  const regenerate = useAppStore((state) => state.regenerateContent);
  const check = useAppStore((state) => state.runRiskCheck);
  const initialChannel = content?.selectedChannel || "xiaohongshu";
  const initialVersion = content?.channels.find((item) => item.channel === initialChannel);
  const channel: ChannelId = initialChannel;
  const [title, setTitle] = useState(initialVersion?.title || "");
  const [body, setBody] = useState(initialVersion?.body || "");
  // 已停用：旧封面选择器只记录本地文件名，没有上传或进入发布请求。
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopUrl, setDesktopUrl] = useState(process.env.NEXT_PUBLIC_APP_URL || "");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [regenerating, setRegenerating] = useState(false);

  if (!content || !brand || !cycle || !task) return <EmptyState title="未找到关联内容" description="内容必须从当前优化任务中生成，不能创建无来源内容。" />;

  const save = () => {
    if (!title.trim() || !body.trim()) { setToast("标题和正文不能为空"); return false; }
    updateChannel(content.id, channel, title, body);
    setToast("内容已保存");
    return true;
  };
  const runCheck = () => {
    updateChannel(content.id, channel, title, body);
    check(content.id);
    setToast("内容风险检查已完成");
  };
  const prepareDelivery = async () => {
    if (!save()) return;
    check(content.id);
    const reviewed = useAppStore.getState().contents.find((item) => item.id === content.id);
    if (reviewed?.riskStatus === "blocked") { setToast("内容风险检查未通过，请修改后重试"); return; }
    try {
      await flushWorkspaceNow();
      if (window.matchMedia("(max-width: 767px)").matches) {
        setDesktopUrl(process.env.NEXT_PUBLIC_APP_URL || window.location.origin);
        setMobileOpen(true);
        return;
      }
      router.push(`/publish/new?contentId=${encodeURIComponent(content.id)}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "内容保存失败，请重试");
    }
  };
  const regenerateNow = async () => {
    if (regenerating) return;
    setRegenerating(true);
    try {
      await regenerate(content.id);
      const refreshed = useAppStore.getState().contents.find((item) => item.id === content.id);
      const refreshedVersion = refreshed?.channels.find((item) => item.channel === refreshed.selectedChannel);
      setTitle(refreshedVersion?.title || refreshed?.title || "");
      setBody(refreshedVersion?.body || refreshed?.body || "");
      setToast("内容已根据当前品牌资料和优化目标重新生成");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "内容重新生成失败，请稍后重试");
    } finally {
      setRegenerating(false);
    }
  };
  return <>
    <PageHeader title={task.title} actions={<Button disabled={regenerating} onClick={() => { void regenerateNow(); }}><RefreshCw size={16} />{regenerating ? "生成中…" : "重新生成"}</Button>} />
    <div className="split-layout section-gap" style={{ gridTemplateColumns: "minmax(0, 1fr) 340px" }}>
      <div className="stack">
        <Card title="已生成内容" description="内容主题和交付方式已按当前任务确定，无需选择渠道。">
          <div className="notice" style={{ marginBottom: 18 }}><div><strong>说明</strong><div className="small" style={{ marginTop: 3 }}>{task.description}</div></div></div>
          <div className="stack">
            <Field label="内容标题" required><input className="input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} /></Field>
            <Field label="内容正文" required><textarea className="textarea" style={{ minHeight: 390 }} value={body} onChange={(event) => setBody(event.target.value)} /></Field>
            {/* 封面由发布账号配置中的默认封面提供，不在内容编辑器中模拟选择。 */}
            <div className="form-actions"><Button onClick={() => setPreviewOpen(true)}><EyeIcon />预览</Button></div>
          </div>
        </Card>
      </div>
      <div className="stack">
        <Card title="风险与合规检查" description="复制、保存或发布时会自动检查，也可以提前检查。">
          <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 18px" }}><div className="score-ring" style={{ "--value": content.riskStatus === "passed" ? 100 : content.riskStatus === "warning" ? 80 : content.riskStatus === "blocked" ? 36 : 0 } as React.CSSProperties}><strong>{content.riskStatus === "passed" ? "通过" : content.riskStatus === "warning" ? "提醒" : content.riskStatus === "blocked" ? "阻止" : "未检查"}</strong></div></div>
          {content.riskIssues.length ? <div className="stack">{content.riskIssues.map((issue) => <div className={`notice ${issue.blocking ? "notice-danger" : "notice-warning"}`} key={issue.id}><AlertTriangle size={17} /><div><strong>{issue.term}</strong><div className="small" style={{ marginTop: 3 }}>{issue.message}</div></div></div>)}</div> : content.riskStatus !== "unchecked" && <div className="notice notice-success"><ShieldCheck size={18} />未发现违禁词或品牌事实冲突。</div>}
          <Button style={{ width: "100%", marginTop: 15 }} onClick={runCheck}><ShieldCheck size={16} />运行风险检查</Button>
        </Card>
        <Card title="内容操作" description="复制内容不会完成任务；至少一个平台同步成功后，任务才会完成。">
          <div className="stack">
            <Button onClick={() => { void copyText(`${title}\n\n${body}`).then(() => setToast("内容已复制")); }}><Copy size={16} />复制内容</Button>
            <Button variant="primary" disabled={!title.trim() || !body.trim()} onClick={() => { void prepareDelivery(); }}><Send size={16} />多平台同步</Button>
            <Link className="link small" href="/settings/platforms">管理发布平台与账号</Link>
          </div>
        </Card>
      </div>
    </div>
    <Modal open={mobileOpen} title="请登录网页端进行操作" description="多平台同步需要网页端和浏览器扩展协同完成。" onClose={() => setMobileOpen(false)} footer={<Button variant="primary" onClick={() => setMobileOpen(false)}>我知道了</Button>}>
      <div className="stack"><div className="notice">请在电脑浏览器打开以下链接，登录同一账号后继续同步。</div><div className="input" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}><span style={{ overflowWrap: "anywhere" }}>{desktopUrl || "请联系管理员获取网页端链接"}</span><Button size="sm" disabled={!desktopUrl} onClick={() => { void copyText(desktopUrl).then(() => setToast("网页端链接已复制")); }}>复制链接</Button></div></div>
    </Modal>
    <Modal open={previewOpen} title={channel === "wechat" ? "公众号草稿预览" : "小红书发布预览"} onClose={() => setPreviewOpen(false)} footer={<Button onClick={() => setPreviewOpen(false)}>关闭预览</Button>}><article style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 20 }}><div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}><span className="avatar">{brand.name.slice(0, 1)}</span><div><strong>{brand.name}</strong><div className="muted small">{channel === "wechat" ? "公众号草稿预览" : "刚刚 · 小红书"}</div></div></div><h2 style={{ lineHeight: 1.5 }}>{title}</h2><div style={{ whiteSpace: "pre-wrap", lineHeight: 1.8 }}>{body}</div></article></Modal>
    <Modal open={regenerating} title="正在重新生成内容" description="系统会使用当前品牌资料、优化目标和任务要求重新生成。" dismissible={false} onClose={() => undefined}>
      <OperationProgress kind="content" />
    </Modal>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </>;
}

/* 已停用：发布记录已经迁移到 publishing-views 的专用仓储读取链路。
export function PublishesViewV2() {
  const brand = useAppStore(currentBrand)!;
  const rawRecords = useAppStore((state) => state.publishRecords);
  const records = useMemo(() => rawRecords.filter((item) => item.brandId === brand.id), [rawRecords, brand.id]);
  const retry = useAppStore((state) => state.retryPublish);
  const [status, setStatus] = useState("all");
  const [channel, setChannel] = useState("all");
  const [recordId, setRecordId] = useState<string | null>(null);
  const filtered = useMemo(() => records.filter((item) => (status === "all" || item.status === status) && (channel === "all" || item.channel === channel)), [records, status, channel]);
  const selected = records.find((item) => item.id === recordId);

  return <>
    <PageHeader title="发布记录" description="查看小红书发布结果和公众号草稿箱保存记录。" />
    <ModuleNav items={taskNav} />
    <Card>
      <div className="form-row" style={{ marginBottom: 16 }}>
        <Field label="操作状态"><select className="select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="draft_saved">已存公众号草稿箱</option><option value="published">发布成功</option><option value="publishing">处理中</option><option value="failed">操作失败</option></select></Field>
        <Field label="发布平台"><select className="select" value={channel} onChange={(event) => setChannel(event.target.value)}><option value="all">全部平台</option>{channelOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      </div>
      {filtered.length ? <div className="table-wrap"><table className="table"><thead><tr><th>内容标题</th><th>平台</th><th>账号</th><th>操作时间</th><th>状态</th><th>操作</th></tr></thead><tbody>{filtered.map((record) => <tr key={record.id}><td><strong>{record.title}</strong><div className="muted small">内容版本{record.contentVersion}</div></td><td>{channelNames[record.channel]}</td><td>{record.accountName}</td><td>{new Date(record.createdAt).toLocaleString("zh-CN")}</td><td><Badge tone={deliveryTone(record.status)}>{deliveryLabel(record.status)}</Badge></td><td><div className="table-row-action"><Button size="sm" onClick={() => setRecordId(record.id)}>查看详情</Button>{record.status === "failed" && <Button size="sm" variant="soft" onClick={() => retry(record.id)}>重试</Button>}</div></td></tr>)}</tbody></table></div> : <EmptyState title="暂无发布记录" description="完成风险检查后，可将公众号内容存入草稿箱或模拟发布小红书内容。" action={<Link className="btn btn-primary" href="/tasks">前往任务概览</Link>} icon={<Rocket size={24} />} />}
    </Card>
    <DraftPublishDrawer record={selected} onClose={() => setRecordId(null)} onRetry={() => { if (selected) retry(selected.id); }} />
  </>;
}

function DraftPublishDrawer({ record, onClose, onRetry }: { record?: PublishRecord; onClose: () => void; onRetry: () => void }) {
  if (!record) return null;
  return <Drawer open title="操作记录详情" description={`内容版本${record.contentVersion}`} onClose={onClose}><div className="stack"><div><Badge tone={deliveryTone(record.status)}>{deliveryLabel(record.status)}</Badge></div>{record.status === "draft_saved" && <div className="notice notice-success"><CheckCircle2 size={18} />已存入公众号草稿箱，请前往公众号后台检查内容和排版后手动发布。</div>}<Card title="操作信息"><div className="stack"><ContextItem label="平台与账号" value={`${channelNames[record.channel]} · ${record.accountName}`} /><ContextItem label="发起时间" value={new Date(record.createdAt).toLocaleString("zh-CN")} />{record.completedAt && <ContextItem label="完成时间" value={new Date(record.completedAt).toLocaleString("zh-CN")} />}</div></Card><Card title="内容快照"><h3>{record.title}</h3><div style={{ whiteSpace: "pre-wrap", lineHeight: 1.8 }}>{record.bodySnapshot}</div></Card>{record.error && <div className="notice notice-danger"><XCircle size={17} />{record.error}</div>}<Link className="btn" href={`/content/${record.contentId}`}><Edit3 size={16} />基于该内容继续编辑</Link>{record.status === "failed" && <Button variant="primary" onClick={onRetry}><RefreshCw size={16} />重试操作</Button>}</div></Drawer>;
}

function deliveryLabel(status: PublishRecord["status"]) {
  return { queued: "排队中", syncing: "同步中", publishing: "处理中", published: "发布成功", draft_saved: "已存草稿箱", failed: "操作失败" }[status];
}

function deliveryTone(status: PublishRecord["status"]): "primary" | "success" | "danger" {
  if (status === "failed") return "danger";
  if (status === "published" || status === "draft_saved") return "success";
  return "primary";
}
*/

async function copyText(value: string) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return; }
  } catch {
    // 局域网HTTP环境可能无法使用异步剪贴板，继续使用兼容方案。
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function TasksViewV2() {
  const router = useRouter();
  const brand = useAppStore(currentBrand)!;
  const cycle = useAppStore(activeCycle);
  const cycles = useAppStore((state) => state.cycles);
  const rawRecords = useAppStore((state) => state.publishRecords);
  const rawDetections = useAppStore((state) => state.detections);
  const records = useMemo(() => rawRecords.filter((item) => item.brandId === brand.id), [brand.id, rawRecords]);
  const detections = useMemo(() => rawDetections.filter((item) => item.brandId === brand.id), [brand.id, rawDetections]);
  const updateTask = useAppStore((state) => state.updateTaskStatus);
  const ensureContent = useAppStore((state) => state.ensureTaskContent);
  const terminate = useAppStore((state) => state.terminateCycle);
  const [materialTaskId, setMaterialTaskId] = useState<string | null>(null);
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [generatingTaskId, setGeneratingTaskId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const latestPast = cycles.filter((item) => item.brandId === brand.id && item.status !== "active").sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  const latestDetection = detections.filter((item) => item.status === "completed" && item.diagnosis).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  if (!cycle) return <>
    <PageHeader title="内容与任务" description="围绕已确认目标执行7天内容任务。" />
    <ModuleNav items={taskNav} />
    <Card>{latestPast?.status === "terminated" ? <EmptyState title="上一轮任务已终止" description="原优化任务已作废，可以重新选择目标建立新任务。" action={latestDetection ? <Link className="btn btn-primary" href={`/analysis/visibility?detection=${latestDetection.id}`}>重新选择优化目标</Link> : undefined} icon={<StopCircle size={24} />} /> : latestPast?.status === "completed" ? <EmptyState title="本轮任务已完成" description="7天资料和内容任务均已完成，可以发起下一次GEO检测。" action={<Link className="btn btn-primary" href="/geo/new">发起下一次检测</Link>} icon={<CheckCircle2 size={24} />} /> : latestDetection ? <EmptyState title="还没有选择优化目标" description="从最近一次分析中选择目标后，系统将生成7天任务。" action={<Link className="btn btn-primary" href={`/analysis/visibility?detection=${latestDetection.id}`}>选择优化目标</Link>} icon={<Target size={24} />} /> : <EmptyState title="还没有GEO诊断" description="先完成GEO检测，再建立7天内容任务。" action={<Link className="btn btn-primary" href="/geo/new">发起GEO检测</Link>} />}</Card>
  </>;

  const completed = cycle.tasks.filter((task) => task.status === "completed").length;
  const inProgress = cycle.tasks.filter((task) => task.status === "in_progress").length;
  const pending = cycle.tasks.filter((task) => task.status === "pending").length;
  const percent = Math.round(completed / cycle.tasks.length * 100);
  const currentTask = cycle.tasks.find((task) => task.day === cycle.currentDay) || cycle.tasks.find((task) => task.status !== "completed");
  const selectedMaterialTask = cycle.tasks.find((task) => task.id === materialTaskId);
  const materialChecks = getMaterialChecks(brand, cycle.dimension);
  const materialsReady = materialChecks.every((item) => item.ready);
  const openTask = async (task: OptimizationTask) => {
    if (task.delivery === "material") { setMaterialTaskId(task.id); return; }
    if (generatingTaskId) return;
    setGeneratingTaskId(task.id);
    try {
      const contentId = await ensureContent(cycle.id, task.id);
      router.push(`/content/${contentId}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "内容生成失败，请稍后重试");
    } finally {
      setGeneratingTaskId(null);
    }
  };

  return <>
    <PageHeader title="内容与任务" description="资料准备好后，内容可直接复制、存入公众号草稿箱或发布。" actions={<Button variant="danger" onClick={() => setTerminateOpen(true)}><StopCircle size={16} />终止任务</Button>} />
    <ModuleNav items={taskNav} />
    <Card title="当前目标" action={<Badge tone="primary"><span className="status-dot" />进行中</Badge>}>
      <div className="split-layout" style={{ gridTemplateColumns: "minmax(0, 1fr) 260px" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}><span className="empty-icon" style={{ margin: 0 }}><Target size={22} /></span><div><h2 style={{ margin: 0, fontSize: 21 }}>{cycle.target}</h2><p className="muted small" style={{ margin: "7px 0 0" }}>任务周期：{new Date(cycle.startDate).toLocaleDateString("zh-CN")}—{new Date(cycle.endDate).toLocaleDateString("zh-CN")}</p></div></div>
        <div style={{ padding: 16, border: "1px solid var(--line)", borderRadius: 10, alignSelf: "start" }}><div style={{ display: "grid", gridTemplateColumns: "auto minmax(80px, 1fr) auto", alignItems: "center", gap: 12 }}><span className="secondary">当前进度</span><Progress value={percent} success={percent === 100} /><strong>{completed}/7</strong></div><div className="muted small" style={{ marginTop: 12 }}>当前第 {cycle.currentDay} 天</div></div>
      </div>
    </Card>
    <div className="grid grid-4 section-gap"><div className="card metric-card" style={{ padding: "14px 18px", minHeight: 96 }}><div className="metric-label">任务进度</div><div className="metric-value" style={{ marginTop: 10 }}>{percent}%</div></div><div className="card metric-card" style={{ padding: "14px 18px", minHeight: 96 }}><div className="metric-label">已完成</div><div className="metric-value trend-up" style={{ marginTop: 10 }}>{completed}</div></div><div className="card metric-card" style={{ padding: "14px 18px", minHeight: 96 }}><div className="metric-label">进行中</div><div className="metric-value" style={{ color: "var(--primary)", marginTop: 10 }}>{inProgress}</div></div><div className="card metric-card" style={{ padding: "14px 18px", minHeight: 96 }}><div className="metric-label">待完成</div><div className="metric-value" style={{ marginTop: 10 }}>{pending}</div></div></div>
    <div className="split-layout section-gap">
      <div className="stack">
        <Card title="7天优化任务表" description="每天只需要完成资料确认、复制或发布动作。">
          <div className="stack">{cycle.tasks.map((task) => <article className="task-plan-row" key={task.id} style={{ display: "grid", gridTemplateColumns: "58px minmax(0, 1fr) auto", gap: 14, alignItems: "center", padding: 15, border: `1px solid ${task.day === cycle.currentDay ? "#818cf8" : "var(--line)"}`, borderRadius: 10, background: task.day === cycle.currentDay ? "#fafaff" : "#fff" }}>
            <div style={{ textAlign: "center" }}><strong style={{ fontSize: 18 }}>{task.day}</strong><div className="muted small">DAY</div></div>
            <div><div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><strong>{task.title}</strong><Badge tone={deliveryToneForTask(task.delivery)}>{deliveryLabelForTask(task.delivery)}</Badge><Badge tone={taskStatus[task.status].tone}>{taskStatus[task.status].label}</Badge></div><p className="muted small" style={{ margin: "6px 0 0", lineHeight: 1.55 }}>{task.description}</p></div>
            <Button size="sm" variant={task.status === "completed" ? "default" : "primary"} disabled={generatingTaskId === task.id} onClick={() => { void openTask(task); }}>{generatingTaskId === task.id ? "生成中…" : "查看详情"}<ArrowRight size={14} /></Button>
          </article>)}</div>
        </Card>
      </div>
      <div className="stack">
        {currentTask && <Card title="当前任务" description={`第 ${currentTask.day} 天`}><Badge tone={deliveryToneForTask(currentTask.delivery)}>{deliveryLabelForTask(currentTask.delivery)}</Badge><h3 style={{ lineHeight: 1.55 }}>{currentTask.title}</h3><p className="secondary" style={{ lineHeight: 1.65 }}>{currentTask.description}</p><Button style={{ width: "100%" }} variant="primary" disabled={generatingTaskId === currentTask.id} onClick={() => { void openTask(currentTask); }}>{generatingTaskId === currentTask.id ? "生成中…" : taskActionLabel(currentTask)}<ArrowRight size={15} /></Button></Card>}
        <Card title="最近操作" action={<Link className="link small" href="/publishes">查看全部</Link>}>{records.slice(0, 3).map((record) => <div key={record.id} style={{ padding: "11px 0", borderBottom: "1px solid var(--line)" }}><strong>{record.title}</strong><div className="muted small" style={{ marginTop: 5 }}>{record.channel === "wechat" ? "已存公众号草稿箱" : "已发布小红书"} · {new Date(record.createdAt).toLocaleDateString("zh-CN")}</div></div>)}</Card>
      </div>
    </div>
    <Drawer open={Boolean(selectedMaterialTask)} title={selectedMaterialTask?.title || "资料准备"} description="确认以下资料已经准备好" onClose={() => setMaterialTaskId(null)}>
      <div className="stack"><div className={`notice ${materialsReady ? "notice-success" : "notice-warning"}`}>{materialsReady ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}{materialsReady ? "当前品牌档案已具备所需资料，可以直接确认完成。" : "仍有资料未完善，请先补充后再确认。"}</div><Card title="需要准备的资料"><div className="stack">{materialChecks.map((item) => <div key={item.label} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>{item.label}</span><Badge tone={item.ready ? "success" : "warning"}>{item.ready ? "已准备" : "待完善"}</Badge></div>)}</div></Card><Link className="btn" href={selectedMaterialTask?.materialRoute || "/brand/basic"}>查看并完善品牌资料</Link><Button variant="primary" disabled={!materialsReady || selectedMaterialTask?.status === "completed"} onClick={() => { if (!selectedMaterialTask) return; updateTask(cycle.id, selectedMaterialTask.id, "completed"); setMaterialTaskId(null); }}>确认资料已准备</Button></div>
    </Drawer>
    <Modal open={terminateOpen} title="终止当前任务？" description="该操作不可恢复，请确认后再继续。" onClose={() => setTerminateOpen(false)} footer={<><Button onClick={() => setTerminateOpen(false)}>取消</Button><Button variant="danger" onClick={() => { terminate(cycle.id); setTerminateOpen(false); }}>确认终止任务</Button></>}><div className="notice notice-danger"><AlertTriangle size={19} />终止后，当前目标和所有未完成任务将作废；已复制、保存或发布的记录保留。</div></Modal>
    <Modal open={Boolean(generatingTaskId)} title="正在生成内容" description="系统正在根据当前任务生成可编辑内容。" dismissible={false} onClose={() => undefined}>
      <OperationProgress kind="content" />
    </Modal>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </>;
}

function deliveryLabelForTask(delivery: OptimizationTask["delivery"]) {
  return { material: "完善资料", copy: "一键复制", wechat_draft: "公众号草稿", zhihu_draft: "知乎草稿", xiaohongshu_publish: "小红书发布", multi_platform: "多平台同步" }[delivery];
}

function deliveryToneForTask(delivery: OptimizationTask["delivery"]): "default" | "primary" | "success" | "warning" {
  return delivery === "material" ? "warning" : delivery === "copy" ? "default" : delivery === "wechat_draft" ? "primary" : "success";
}

function taskActionLabel(task: OptimizationTask) {
  if (task.status === "completed") return task.delivery === "material" ? "查看资料" : "查看内容";
  return { material: "准备资料", copy: "查看并复制", wechat_draft: "查看并存草稿", zhihu_draft: "查看并存草稿", xiaohongshu_publish: "查看并发布", multi_platform: "查看并同步" }[task.delivery];
}

function getMaterialChecks(brand: Brand, dimension: OptimizationCycle["dimension"]) {
  const product = brand.products[0];
  if (dimension === "ranking") return [{ label: "核心服务", ready: Boolean(product?.description) }, { label: "差异化特点", ready: Boolean(product?.features) }, { label: "适用场景", ready: Boolean(product?.audience) }];
  if (dimension === "reputation") return [{ label: "服务特点", ready: Boolean(product?.features) }, { label: "体验说明", ready: Boolean(product?.description || brand.intro) }, { label: "案例资料", ready: brand.knowledge.some((item) => item.status === "active") }];
  if (dimension === "sentiment") return [{ label: "服务流程或简介", ready: Boolean(product?.description || brand.intro) }, { label: "核心特点", ready: Boolean(product?.features) }, { label: "适用人群", ready: Boolean(product?.audience) }];
  return [{ label: "门店与服务范围", ready: Boolean(brand.city && (brand.serviceArea || brand.stores.length)) }, { label: "核心服务项目", ready: Boolean(product?.name) }, { label: "适用人群", ready: Boolean(product?.audience) }];
}
