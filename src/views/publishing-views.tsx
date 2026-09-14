"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, RefreshCw, Send, Settings2, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ModuleNav } from "@/components/module-nav";
import { Badge, Button, Card, EmptyState, PageHeader, Progress, Toast } from "@/components/ui";
import { currentBrand, useAppStore } from "@/lib/store";
import { PUBLISH_TOTAL_TIMEOUT_CODE, canRetryPublishRecord } from "@/lib/publishing-timeout";
import type { ChannelId, PublishBatch, PublishBatchStatus, PublishingPlatform, PublishRecord } from "@/lib/types";
import { channelNames } from "@/lib/types";

const taskNav = [{ href: "/tasks", label: "任务概览" }, { href: "/publishes", label: "发布记录" }];
const channels: Array<{ id: ChannelId; name: string; mark: string; color: string; description: string }> = [
  { id: "wechat", name: "微信公众号", mark: "微", color: "#07c160", description: "通过官方接口存入公众号草稿箱" },
  { id: "zhihu", name: "知乎", mark: "知", color: "#056de8", description: "通过浏览器扩展填入编辑器并保存草稿" },
  { id: "xiaohongshu", name: "小红书", mark: "红", color: "#ff2442", description: "同步能力建设中" },
];

export function PublishSelectionView({ contentId }: { contentId: string }) {
  const router = useRouter();
  const brand = useAppStore(currentBrand);
  const content = useAppStore((state) => state.contents.find((item) => item.id === contentId));
  const task = useAppStore((state) => state.cycles.flatMap((cycle) => cycle.tasks).find((item) => item.id === content?.taskId));
  const [platforms, setPlatforms] = useState<PublishingPlatform[]>([]);
  const [selected, setSelected] = useState<ChannelId[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKey = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!brand?.id) return;
    const controller = new AbortController();
    void fetch(`/api/publishing/accounts?brandId=${encodeURIComponent(brand.id)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { platforms?: PublishingPlatform[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "发布账号读取失败");
        setPlatforms(payload.platforms || []);
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "发布账号读取失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [brand?.id]);

  if (!brand || !content || !task) return <EmptyState title="未找到待同步内容" description="请从7天优化任务进入内容页后再发起同步。" action={<Link className="btn" href="/tasks">返回任务概览</Link>} />;

  function account(channel: ChannelId) { return platforms.find((item) => item.channel === channel); }
  function toggle(channel: ChannelId) { setSelected((value) => value.includes(channel) ? value.filter((item) => item !== channel) : [...value, channel]); }
  async function submit() {
    if (!selected.length || submitting) return;
    setSubmitting(true); setError("");
    try {
      const response = await fetch("/api/publishing/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentId, channels: selected, idempotencyKey: idempotencyKey.current }),
      });
      const payload = await response.json() as { batch?: PublishBatch; error?: string };
      if (!response.ok || !payload.batch) throw new Error(payload.error || "多平台同步发起失败");
      router.replace(`/publish/progress/${payload.batch.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "多平台同步发起失败"); setSubmitting(false); }
  }

  return <>
    <PageHeader title="选择发布平台" description="可选择一个或多个平台；每个平台使用当前品牌已连接的唯一账号。" back />
    <Card title={content.title} description={`关联任务：${task.title}`}>
      <div className="grid grid-3">
        {channels.map((item) => {
          const platform = account(item.id);
          // 知乎同步扩展仍在调整中，暂不允许进入发布批次；小红书同样保持建设中状态。
          const unavailable = item.id === "xiaohongshu" || item.id === "zhihu";
          const ready = Boolean(platform?.configured && platform.availability !== "coming_soon");
          const checked = selected.includes(item.id);
          return <button key={item.id} type="button" className={`platform-select-card ${checked ? "selected" : ""}`} disabled={unavailable || !ready} onClick={() => toggle(item.id)}>
            <span className="brand-mark" style={{ background: item.color }}>{item.mark}</span>
            <span style={{ flex: 1, textAlign: "left" }}><strong>{item.name}</strong><span className="muted small" style={{ display: "block", marginTop: 5 }}>{unavailable ? "暂不可用" : ready ? platform?.accountName : "尚未配置账号"}</span></span>
            <Badge tone={unavailable ? "default" : ready ? checked ? "primary" : "success" : "warning"}>{unavailable ? "暂不可用" : ready ? checked ? "已选择" : "可同步" : "未配置"}</Badge>
          </button>;
        })}
      </div>
      <div className="notice" style={{ marginTop: 18 }}><AlertTriangle size={17} />公众号只保存草稿，仍需用户进入平台后台检查并手动发布。</div>
      {error && <div className="notice notice-danger" style={{ marginTop: 14 }}>{error}</div>}
      <div className="form-actions" style={{ marginTop: 18 }}><Link className="btn" href="/settings/platforms"><Settings2 size={16} />管理发布账号</Link><Button variant="primary" disabled={loading || !selected.length || submitting} onClick={() => { void submit(); }}><Send size={16} />{submitting ? "正在创建同步任务…" : `同步发布${selected.length ? `（${selected.length}个平台）` : ""}`}</Button></div>
    </Card>
  </>;
}

export function PublishProgressView({ batchId }: { batchId: string }) {
  const mergePublishedTaskCompletion = useAppStore((state) => state.mergePublishedTaskCompletion);
  const [batch, setBatch] = useState<PublishBatch | null>(null);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState("");
  const [toast, setToast] = useState("");
  const taskCompletionSynced = useRef(false);
  const terminal = batch ? ["succeeded", "partial_succeeded", "failed"].includes(batch.status) : false;

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const response = await fetch(`/api/publishing/batches/${encodeURIComponent(batchId)}`, { cache: "no-store" });
        const payload = await response.json() as { batch?: PublishBatch; error?: string };
        if (!response.ok || !payload.batch) throw new Error(payload.error || "同步进度读取失败");
        if (stopped) return;
        setBatch(payload.batch); setError("");
        if (!["succeeded", "partial_succeeded", "failed"].includes(payload.batch.status)) timer = setTimeout(load, 2000);
      } catch (cause) { if (!stopped) { setError(cause instanceof Error ? cause.message : "同步进度读取失败"); timer = setTimeout(load, 4000); } }
    }
    void load();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [batchId]);

  useEffect(() => {
    if (!batch?.successCount || taskCompletionSynced.current) return;
    const cycleId = batch.records.find((record) => record.cycleId)?.cycleId;
    if (!cycleId) return;
    const localTask = useAppStore.getState().cycles
      .find((cycle) => cycle.id === cycleId)?.tasks.find((task) => task.id === batch.taskId);
    if (localTask?.status !== "completed") mergePublishedTaskCompletion(cycleId, batch.taskId);
    taskCompletionSynced.current = true;
  }, [batch, mergePublishedTaskCompletion]);

  async function retry(recordId: string) {
    setRetrying(recordId); setError("");
    try {
      const response = await fetch(`/api/publishing/records/${encodeURIComponent(recordId)}/retry`, { method: "POST" });
      const payload = await response.json() as { batch?: PublishBatch; error?: string };
      if (!response.ok || !payload.batch) throw new Error(payload.error || "重试失败");
      setBatch(payload.batch);
      const retriedRecord = payload.batch.records.find((record) => record.id === recordId);
      if (retriedRecord?.status === "failed") setError(retriedRecord.error || "同步任务重新入队失败");
      else setToast("失败平台已重新进入同步队列");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "重试失败"); }
    finally { setRetrying(""); }
  }

  const records = batch?.records || [];
  const hasTimedOutRecord = records.some((record) => record.errorCode === PUBLISH_TOTAL_TIMEOUT_CODE);
  const finished = records.filter((item) => item.status === "draft_saved" || item.status === "published" || item.status === "failed").length;
  const percent = records.length ? Math.round(finished / records.length * 100) : 0;
  return <>
    <PageHeader title="多平台同步进度" description="各平台独立排队执行，单个平台失败不会阻塞其他平台。" back actions={<Link className="btn" href="/publishes">发布记录</Link>} />
    <Card title={batch ? batchStatusLabel(batch.status) : "正在读取同步任务"} action={batch && <Badge tone={batchTone(batch.status)}>{finished}/{records.length}</Badge>}>
      <Progress value={percent} success={terminal && Boolean(batch?.successCount)} />
      <div className="grid grid-2" style={{ marginTop: 18 }}>
        {records.map((record) => <RecordStatusCard key={record.id} record={record} retrying={retrying === record.id} onRetry={() => { void retry(record.id); }} />)}
      </div>
      {!records.length && !error && <div className="empty"><span className="status-dot" />正在创建平台任务…</div>}
      {error && <div className="notice notice-danger" style={{ marginTop: 16 }}>{error}</div>}
      {terminal && batch && <div className={`notice ${batch.successCount && !hasTimedOutRecord ? "notice-success" : "notice-danger"}`} style={{ marginTop: 16 }}>{batch.successCount && !hasTimedOutRecord ? <CheckCircle2 size={18} /> : <XCircle size={18} />}{hasTimedOutRecord ? batch.successCount ? `已有${batch.successCount}个平台成功，另有平台超过10分钟未完成并已失败；如需补发，请重新发布失败平台。` : "排队发布超过10分钟未完成，本次发布已失败，请重新发布。" : batch.successCount ? `已有${batch.successCount}个平台成功保存草稿，本项优化任务已完成。` : "本次同步全部失败，可在下方逐个平台重试。"}</div>}
      <div className="form-actions" style={{ marginTop: 18 }}><Link className="btn" href="/tasks">返回任务概览</Link>{hasTimedOutRecord && batch && <Link className="btn btn-primary" href={`/publish/new?contentId=${encodeURIComponent(batch.contentId)}`}>重新发布</Link>}<Link className={hasTimedOutRecord ? "btn" : "btn btn-primary"} href="/publishes">查看发布记录</Link></div>
    </Card>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </>;
}

function RecordStatusCard({ record, retrying, onRetry }: { record: PublishRecord; retrying: boolean; onRetry: () => void }) {
  const success = record.status === "draft_saved" || record.status === "published";
  const failed = record.status === "failed";
  return <article className="platform-result-card">
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}><strong>{channelNames[record.channel]}</strong><Badge tone={failed ? "danger" : success ? "success" : "primary"}>{recordStatusLabel(record.status)}</Badge></div>
    <div className="muted small">账号：{record.accountName}</div>
    {record.channel === "zhihu" && !success && !failed && <div className="notice"><Clock3 size={16} />请保持浏览器扩展运行，并登录知乎创作中心。</div>}
    {record.error && <div className="notice notice-danger">{record.error}</div>}
    {success && <div className="notice notice-success"><CheckCircle2 size={16} />草稿已保存，请进入平台后台检查并手动发布。</div>}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{record.channel === "wechat" && success && <a className="btn btn-sm" href="https://mp.weixin.qq.com" target="_blank" rel="noreferrer">打开公众号后台<ExternalLink size={14} /></a>}{record.channel === "zhihu" && <a className="btn btn-sm" href="https://zhuanlan.zhihu.com/write" target="_blank" rel="noreferrer">打开知乎创作中心<ExternalLink size={14} /></a>}{canRetryPublishRecord(record) && <Button size="sm" variant="primary" disabled={retrying} onClick={onRetry}><RefreshCw size={14} />{retrying ? "重试中…" : "重试"}</Button>}</div>
  </article>;
}

export function PublishingHistoryView() {
  const brand = useAppStore(currentBrand);
  const [batches, setBatches] = useState<PublishBatch[]>([]);
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!brand?.id) return;
    const controller = new AbortController();
    void fetch(`/api/publishing/batches?brandId=${encodeURIComponent(brand.id)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const payload = await response.json() as { batches?: PublishBatch[]; error?: string }; if (!response.ok) throw new Error(payload.error || "发布记录读取失败"); setBatches(payload.batches || []); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "发布记录读取失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [brand?.id]);
  const filtered = useMemo(() => batches.filter((item) => status === "all" || item.status === status), [batches, status]);
  return <>
    <PageHeader title="发布记录" description="按批次查看公众号和知乎草稿同步结果。" />
    <ModuleNav items={taskNav} />
    <Card>
      <div className="form-row" style={{ marginBottom: 16 }}><label className="field"><span>同步状态</span><select className="select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="running">进行中</option><option value="succeeded">全部成功</option><option value="partial_succeeded">部分成功</option><option value="failed">全部失败</option></select></label></div>
      {loading ? <div className="empty"><span className="status-dot" />正在读取发布记录…</div> : filtered.length ? <div className="table-wrap"><table className="table"><thead><tr><th>内容标题</th><th>同步平台</th><th>发起时间</th><th>成功/失败</th><th>状态</th><th>操作</th></tr></thead><tbody>{filtered.map((batch) => <tr key={batch.id}><td><strong>{batch.records[0]?.title || "未命名内容"}</strong><div className="muted small">内容版本{batch.contentVersion}</div></td><td>{batch.records.map((record) => channelNames[record.channel]).join("、")}</td><td>{new Date(batch.createdAt).toLocaleString("zh-CN")}</td><td>{batch.successCount}/{batch.failureCount}</td><td><Badge tone={batchTone(batch.status)}>{batchStatusLabel(batch.status)}</Badge></td><td><Link className="btn btn-sm" href={`/publish/progress/${batch.id}`}>查看详情</Link></td></tr>)}</tbody></table></div> : <EmptyState title="暂无发布记录" description="内容完成风险检查后，可从内容页发起多平台同步。" action={<Link className="btn btn-primary" href="/tasks">前往任务概览</Link>} />}
      {error && <div className="notice notice-danger" style={{ marginTop: 14 }}>{error}</div>}
    </Card>
  </>;
}

function recordStatusLabel(status: PublishRecord["status"]) {
  return { queued: "排队中", syncing: "同步中", publishing: "处理中", published: "已发布", draft_saved: "已存草稿", failed: "失败" }[status];
}

function batchStatusLabel(status: PublishBatchStatus) {
  return { queued: "等待同步", running: "同步进行中", succeeded: "全部成功", partial_succeeded: "部分成功", failed: "全部失败" }[status];
}

function batchTone(status: PublishBatchStatus): "primary" | "success" | "warning" | "danger" {
  if (status === "succeeded") return "success";
  if (status === "partial_succeeded") return "warning";
  if (status === "failed") return "danger";
  return "primary";
}
