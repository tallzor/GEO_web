"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  CircleAlert,
  Copy,
  Download,
  Eye,
  EyeOff,
  LogOut,
  Plus,
  Puzzle,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useAccountContext } from "@/components/auth-context";
import { ModuleNav } from "@/components/module-nav";
import { Badge, Button, Card, Field, Modal, PageHeader, Progress, Toast } from "@/components/ui";
import { signOutAction, updateProfileAction } from "@/lib/auth/actions";
import { brandCompleteness } from "@/lib/engine";
import { currentBrand, useAppStore } from "@/lib/store";
import { Brand, ChannelId, PublishingPlatform } from "@/lib/types";

const settingsNav = [
  { href: "/settings/profile", label: "用户信息" },
  { href: "/settings/brands", label: "品牌管理" },
  { href: "/settings/platforms", label: "发布平台" },
  { href: "/settings/subscription", label: "账号与订阅" },
];

function SettingsFrame({ title, description, actions, children }: { title: string; description: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return <><PageHeader title={title} description={description} actions={actions} /><ModuleNav items={settingsNav} />{children}</>;
}

export function ProfileView() {
  const router = useRouter();
  const account = useAccountContext();
  const user = useAppStore((state) => state.user);
  const update = useAppStore((state) => state.updateUser);
  const logout = useAppStore((state) => state.logout);
  const dataMode = useAppStore((state) => state.dataMode);
  const clearWorkspace = useAppStore((state) => state.clearWorkspace);
  const [form, setForm] = useState(account ? {
    id: account.userId,
    name: account.displayName,
    phone: account.phone,
    email: account.email,
  } : user);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    startTransition(async () => {
      const result = await updateProfileAction({ displayName: form.name, phone: form.phone });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      update(form);
      setToast("用户信息已保存");
      router.refresh();
    });
  }

  function signOut() {
    if (!confirm("确认退出登录？")) return;
    startTransition(async () => {
      const result = await signOutAction();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (dataMode === "supabase") clearWorkspace();
      logout();
      router.replace("/login");
      router.refresh();
    });
  }

  return <SettingsFrame title="用户信息" description="维护当前账号的基础信息。">
    <div className="split-layout">
      <Card title="基础信息">
        <form className="stack" onSubmit={saveProfile}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span className="avatar" style={{ width: 56, height: 56 }}><UserRound size={24} /></span>
            <div><strong>{form.name}</strong><div className="muted small" style={{ marginTop: 4 }}>账号状态：正常</div></div>
          </div>
          <Field label="用户名称" required><input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="手机号"><input className="input" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field>
          <Field label="登录邮箱"><input className="input" value={form.email} readOnly={Boolean(account)} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
          {account && <div className="muted small">内测一期暂不支持修改登录邮箱和密码。</div>}
          {error && <div className="notice notice-danger" role="alert">{error}</div>}
          <div className="form-actions"><Button variant="primary" disabled={pending}>{pending ? "保存中…" : "保存信息"}</Button></div>
        </form>
      </Card>
      <Card title="账号操作">
        <div className="notice notice-success"><ShieldCheck size={18} />账号当前状态正常{account?.organizationName ? `，所属组织：${account.organizationName}` : ""}。</div>
        <Button variant="danger" style={{ width: "100%", marginTop: 16 }} disabled={pending} onClick={signOut}><LogOut size={16} />退出登录</Button>
      </Card>
    </div>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </SettingsFrame>;
}

export function BrandsSettingsView() {
  const router = useRouter();
  const account = useAccountContext();
  const brands = useAppStore((state) => state.brands);
  const current = useAppStore(currentBrand);
  const setCurrent = useAppStore((state) => state.setCurrentBrand);
  const removeBrand = useAppStore((state) => state.removeBrand);
  const [deleteTarget, setDeleteTarget] = useState<Brand | null>(null);
  const [confirmedName, setConfirmedName] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState("");
  const isOwner = account?.role === "owner";
  const nameMatches = Boolean(deleteTarget && confirmedName === deleteTarget.name);

  const closeDeleteModal = () => {
    if (deleting) return;
    setDeleteTarget(null);
    setConfirmedName("");
    setDeleteError("");
  };

  const deleteBrand = async () => {
    if (!deleteTarget || !nameMatches || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch(`/api/brands/${encodeURIComponent(deleteTarget.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandName: confirmedName }),
      });
      const payload = await response.json() as { activeBrandId?: string | null; error?: string };
      if (!response.ok) throw new Error(payload.error || "品牌删除失败");
      removeBrand(deleteTarget.id, payload.activeBrandId);
      setDeleteTarget(null);
      setConfirmedName("");
      setToast(`品牌“${deleteTarget.name}”已删除`);
      router.replace(payload.activeBrandId ? "/workbench" : "/settings/brands");
      router.refresh();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "品牌删除失败");
    } finally {
      setDeleting(false);
    }
  };

  return <SettingsFrame title="品牌管理与切换" description="查看可管理的品牌并切换当前业务数据上下文。" actions={isOwner ? <Link className="btn btn-primary" href="/brands/new"><Plus size={16} />新建品牌</Link> : undefined}>
    <div className="grid grid-3">{brands.map((brand) => {
      const completeness = brandCompleteness(brand);
      return <Card key={brand.id} title={brand.name} description={`${brand.industry || "行业待完善"} · ${brand.city || "城市待完善"}`} action={brand.id === current?.id ? <Badge tone="primary">当前品牌</Badge> : undefined}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><span className="secondary">档案完整度</span><strong>{completeness}%</strong></div>
        <Progress value={completeness} />
        <div className="muted small" style={{ margin: "8px 0 17px" }}>最近更新：{new Date(brand.updatedAt).toLocaleString("zh-CN")}</div>
        <div style={{ display: "flex", gap: 8 }}>
          {brand.id !== current?.id && <Button size="sm" variant="primary" onClick={() => { setCurrent(brand.id); router.push("/workbench"); }}>切换品牌</Button>}
          <Button size="sm" onClick={() => { setCurrent(brand.id); router.push("/brand/basic"); }}>编辑档案</Button>
          {isOwner && <Button size="sm" variant="danger" onClick={() => { setDeleteTarget(brand); setConfirmedName(""); setDeleteError(""); }}><Trash2 size={15} />删除品牌</Button>}
        </div>
      </Card>;
    })}</div>
    <Modal
      open={Boolean(deleteTarget)}
      title="删除品牌"
      description="删除后品牌将不再显示，后台数据会保留。如需恢复，请联系系统管理员。"
      onClose={closeDeleteModal}
      dismissible={!deleting}
      footer={<><Button onClick={closeDeleteModal} disabled={deleting}>取消</Button><Button variant="danger" disabled={!nameMatches || deleting} onClick={() => void deleteBrand()}>{deleting ? "正在删除…" : "确认删除"}</Button></>}
    >
      <div className="notice notice-warning" style={{ marginBottom: 16 }}>删除前请确认该品牌没有正在进行的优化任务、检测分析或内容发布。</div>
      <Field label={`请输入完整品牌名称“${deleteTarget?.name || ""}”`} required>
        <input className="input" value={confirmedName} onChange={(event) => { setConfirmedName(event.target.value); setDeleteError(""); }} autoComplete="off" />
      </Field>
      {confirmedName && !nameMatches && <p className="field-error">名称输入错误，不可删除</p>}
      {deleteError && <div className="notice notice-danger" role="alert" style={{ marginTop: 14 }}>{deleteError}</div>}
    </Modal>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </SettingsFrame>;
}

export function PlatformsView() {
  const brand = useAppStore(currentBrand);
  const [platforms, setPlatforms] = useState<PublishingPlatform[]>([]);
  const [activeChannel, setActiveChannel] = useState<ChannelId | null>(null);
  const [accountName, setAccountName] = useState("");
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState("");
  const [extensionToken, setExtensionToken] = useState("");
  const coverRef = useRef<HTMLInputElement>(null);
  const [cover, setCover] = useState<File | null>(null);
  const wechat = platforms.find((item) => item.channel === "wechat");
  const zhihu = platforms.find((item) => item.channel === "zhihu");

  useEffect(() => {
    if (!brand?.id) return;
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) setLoading(true); });
    void fetch(`/api/publishing/accounts?brandId=${encodeURIComponent(brand.id)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { platforms?: PublishingPlatform[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "发布账号读取失败");
        setPlatforms(payload.platforms || []);
      })
      .catch((error) => { if (!controller.signal.aborted) setFormError(error instanceof Error ? error.message : "发布账号读取失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [brand?.id]);

  const openWechat = () => {
    setActiveChannel("wechat");
    setAccountName(wechat?.accountName || "");
    setAppId("");
    setSecret("");
    setCover(null);
    setFormError("");
  };
  const openZhihu = () => {
    setActiveChannel("zhihu");
    setAccountName(zhihu?.accountName || "");
    setExtensionToken("");
    setFormError("");
  };
  const closeModal = () => {
    setActiveChannel(null);
    setSecret("");
    setAppId("");
    setCover(null);
    setFormError("");
  };
  const saveWechat = async () => {
    if (!brand?.id) return;
    if (!accountName.trim() || !appId.trim() || (!wechat?.configured && !secret.trim())) { setFormError("请完整填写公众号名称、AppID和AppSecret"); return; }
    if (!/^wx[a-zA-Z0-9]{6,}$/.test(appId.trim())) { setFormError("请输入以 wx 开头的公众号 AppID"); return; }
    if (!wechat?.configured && !cover) { setFormError("首次配置需要上传公众号默认封面"); return; }
    if (secret.trim() && secret.trim().length < 8) { setFormError("AppSecret格式不完整，请检查后重试"); return; }
    setSaving(true);
    setFormError("");
    try {
      const form = new FormData();
      form.set("channel", "wechat"); form.set("brandId", brand.id); form.set("accountName", accountName.trim()); form.set("appId", appId.trim()); form.set("appSecret", secret.trim());
      if (cover) form.set("cover", cover);
      const response = await fetch("/api/publishing/accounts", { method: "POST", body: form });
      const payload = await response.json() as { platforms?: PublishingPlatform[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "公众号配置失败");
      setPlatforms(payload.platforms || []);
      setToast("公众号连接成功，草稿箱能力已就绪");
      closeModal();
    } catch (error) { setFormError(error instanceof Error ? error.message : "公众号配置失败"); }
    finally { setSaving(false); }
  };
  const createZhihuToken = async () => {
    if (!brand?.id || !accountName.trim()) { setFormError("请输入知乎账号名称"); return; }
    setSaving(true); setFormError("");
    try {
      const form = new FormData();
      form.set("channel", "zhihu"); form.set("brandId", brand.id); form.set("accountName", accountName.trim());
      const response = await fetch("/api/publishing/accounts", { method: "POST", body: form });
      const payload = await response.json() as { platforms?: PublishingPlatform[]; extensionToken?: string; error?: string };
      if (!response.ok || !payload.extensionToken) throw new Error(payload.error || "知乎扩展连接码生成失败");
      setPlatforms(payload.platforms || []);
      setExtensionToken(payload.extensionToken);
      setToast("知乎扩展连接码已生成，请立即复制保存");
    } catch (error) { setFormError(error instanceof Error ? error.message : "知乎扩展配置失败"); }
    finally { setSaving(false); }
  };

  return <SettingsFrame title="发布平台配置" description="每个品牌每个平台连接一个账号，内容只同步到平台草稿，不会自动公开发布。">
    <div className="notice" style={{ marginBottom: 16 }}><ShieldCheck size={18} />公众号凭证加密保存在服务端，页面不会回显AppSecret；知乎连接码只展示一次。</div>
    {loading ? <Card><div className="empty"><span className="status-dot" />正在读取发布账号…</div></Card> : <div className="grid grid-3">
      <PublishingAccountCard name="微信公众号" mark="微" color="#07c160" platform={wechat} description="通过官方接口存入公众号草稿箱" onManage={openWechat} />
      <PublishingAccountCard name="知乎" mark="知" color="#056de8" platform={zhihu} description="通过浏览器扩展填入编辑器并保存草稿" onManage={openZhihu} />
      <PublishingAccountCard name="小红书" mark="红" color="#ff2442" description="平台同步能力正在建设" disabled />
    </div>}

    <Modal open={activeChannel === "wechat"} title={wechat?.configured ? "重新配置公众号" : "连接微信公众号"} description="验证成功后，系统可将内容存入该公众号草稿箱。" onClose={closeModal} footer={<><Button onClick={closeModal}>取消</Button><Button variant="primary" disabled={saving} onClick={() => { void saveWechat(); }}>{saving ? "正在验证…" : "验证并保存"}</Button></>}>
      <div className="stack">
        <div className="notice">请先在微信开发者平台将服务器固定出口IP（47.107.155.42）加入白名单</div>
        <Field label="公众号名称" required><input className="input" value={accountName} onChange={(event) => setAccountName(event.target.value)} /></Field>
        <Field label="AppID" required><input className="input" value={appId} onChange={(event) => setAppId(event.target.value.trim())} placeholder="以wx开头" /></Field>
        <Field label="AppSecret" required={!wechat?.configured} hint={wechat?.configured ? "不修改可留空；填写后会替换原凭证。" : "仅提交到服务端加密保存，不会回显。"}><div style={{ position: "relative" }}><input className="input" type={showSecret ? "text" : "password"} value={secret} onChange={(event) => setSecret(event.target.value.trim())} style={{ paddingRight: 44 }} /><button type="button" className="icon-btn" aria-label="切换密文显示" onClick={() => setShowSecret(!showSecret)} style={{ position: "absolute", right: 9, top: 8 }}>{showSecret ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></Field>
        <Field label="默认封面" required={!wechat?.configured} hint="JPG或PNG，不超过2MB。后续同步公众号内容时默认使用。"><div className="input" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}><span className="muted">{cover?.name || (wechat?.defaultCoverObjectPath ? "已配置默认封面" : "请选择封面")}</span><input ref={coverRef} hidden type="file" accept="image/jpeg,image/png" onChange={(event) => setCover(event.target.files?.[0] || null)} /><Button size="sm" onClick={() => coverRef.current?.click()}><Upload size={14} />选择图片</Button></div></Field>
        {formError && <div className="notice notice-danger">{formError}</div>}
      </div>
    </Modal>

    <Modal open={activeChannel === "zhihu"} title="连接知乎浏览器扩展" description="扩展只负责填入知乎编辑器并保存草稿，不会自动发布。" onClose={closeModal}>
      <div className="stack">
        <div className="grid grid-3">{["下载并解压", "开发者模式加载", "填写连接码"].map((label, index) => <div key={label} className="notice"><Badge tone="primary">{index + 1}</Badge>{label}</div>)}</div>
        <a className="btn" href="/downloads/geo-zhihu-publisher.zip" download><Download size={16} />下载知乎同步扩展</a>
        <div className="muted small" style={{ lineHeight: 1.7 }}>打开Chrome或Edge扩展管理页，开启“开发者模式”，点击“加载已解压的扩展程序”，选择解压后的文件夹。安装完成后保持知乎创作中心登录状态。</div>
        <Field label="知乎账号名称" required><input className="input" value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="用于识别同步目标账号" /></Field>
        {!extensionToken && <Button variant="primary" disabled={saving} onClick={() => { void createZhihuToken(); }}><Puzzle size={16} />{saving ? "正在生成…" : zhihu?.configured ? "重新生成连接码" : "生成扩展连接码"}</Button>}
        {extensionToken && <div className="notice notice-warning"><div style={{ flex: 1 }}><strong>请立即复制，此连接码不会再次显示</strong><div style={{ overflowWrap: "anywhere", marginTop: 8 }}>{extensionToken}</div></div><Button size="sm" onClick={() => { void copyText(extensionToken).then(() => setToast("连接码已复制")); }}><Copy size={14} />复制</Button></div>}
        {formError && <div className="notice notice-danger">{formError}</div>}
      </div>
    </Modal>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </SettingsFrame>;
}

async function copyText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // HTTP 内测环境可能不开放 Clipboard API，继续使用兼容方案。
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

function PublishingAccountCard({ name, mark, color, platform, description, disabled = false, onManage }: { name: string; mark: string; color: string; platform?: PublishingPlatform; description: string; disabled?: boolean; onManage?: () => void }) {
  const ready = Boolean(platform?.configured && platform.availability !== "coming_soon");
  return <Card title={name} description={description} action={<Badge tone={disabled ? "default" : ready ? "success" : "warning"}>{disabled ? "能力建设中" : ready ? "已连接" : "未配置"}</Badge>}>
    <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 18 }}>
      <span className="brand-mark" style={{ background: color }}>{mark}</span>
      <div>
        <strong>{platform?.configured ? platform.accountName : "尚未配置账号"}</strong>
        <div className="muted small" style={{ marginTop: 4 }}>{platform?.configured && platform.verifiedAt ? `最近验证：${new Date(platform.verifiedAt).toLocaleString("zh-CN")}` : disabled ? "暂不提供同步功能" : "配置后可使用"}</div>
      </div>
    </div>
    <Button size="sm" variant={ready ? "default" : "primary"} disabled={disabled} onClick={onManage}>{disabled ? "能力建设中" : ready ? "管理连接" : "连接账号"}</Button>
  </Card>;
}

export function SubscriptionView() {
  const reset = useAppStore((state) => state.resetDemo);
  const dataMode = useAppStore((state) => state.dataMode);
  const isDemo = dataMode === "local";
  const [toast, setToast] = useState("");
  return <SettingsFrame title="账号与订阅" description="查看当前账号的使用状态和可用权益。">
    <div className="split-layout">
      <Card title="当前套餐" action={<Badge tone="success"><span className="status-dot" />有效</Badge>}>
        <div style={{ display: "flex", alignItems: "end", gap: 9 }}><strong style={{ fontSize: 30 }}>{isDemo ? "GEO演示版" : "GEO内测版"}</strong><span className="muted" style={{ paddingBottom: 4 }}>内部体验</span></div>
        <p className="secondary">{isDemo ? "当前使用本地演示数据，不涉及真实计费。" : "当前为受邀内测账号，暂不展示模拟计费周期。"}</p>
        <div className="notice"><CircleAlert size={18} />订阅商业模式尚未最终确定，本页只体现已确认的账号与订阅信息结构。</div>
      </Card>
      {isDemo && <Card title="演示数据">
        <p className="secondary" style={{ lineHeight: 1.7 }}>可一键恢复为初始健身行业演示数据，用于重新体验完整流程。</p>
        <Button onClick={() => { if (confirm("确认重置演示数据？当前浏览器中新增的品牌和操作记录将被替换。")) { reset(); setToast("演示数据已重置"); } }}><RotateCcw size={16} />重置演示数据</Button>
      </Card>}
    </div>
    <Card title="套餐权益" className="section-gap"><div className="grid grid-3">{["国内AI平台检测与四维诊断", "1—3项优化目标与7天任务", "内容生成、风险检查与多平台同步"].map((item) => <div className="notice notice-success" key={item}><Check size={18} />{item}</div>)}</div></Card>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </SettingsFrame>;
}
