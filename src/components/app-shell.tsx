"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, BriefcaseBusiness, ChevronDown, LayoutDashboard, LogOut, Plus, SearchCheck, Settings, Target, UserRound } from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";
import { AccountContextProvider } from "@/components/auth-context";
import { signOutAction } from "@/lib/auth/actions";
import type { AccountContext } from "@/lib/auth/types";
import { currentBrand, flushWorkspaceNow, useAppStore } from "@/lib/store";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { fetchWithTimeout } from "@/lib/supabase/fetch";
import type { Detection } from "@/lib/types";
import type { WorkspaceSnapshot } from "@/lib/workspace";

class ApiRequestError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
  }
}

async function requestJsonWithRetry<T>(
  url: string,
  signal: AbortSignal,
  onRetry: () => void,
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, { cache: "no-store", signal }, 15_000);
      const payload = await response.json().catch(() => undefined) as (T & { error?: string }) | undefined;
      if (!response.ok || !payload) {
        throw new ApiRequestError(payload?.error || "数据加载失败", response.status);
      }
      return payload;
    } catch (error) {
      if (signal.aborted) throw error;
      const retryable = !(error instanceof ApiRequestError) || error.status >= 500;
      if (attempt > 0 || !retryable) throw error;
      onRetry();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("数据加载失败");
}

const nav = [
  { href: "/workbench", label: "工作台", icon: LayoutDashboard, match: ["/workbench"] },
  { href: "/brand", label: "品牌档案", icon: BriefcaseBusiness, match: ["/brand", "/brands"] },
  { href: "/geo", label: "检测", icon: SearchCheck, match: ["/geo"] },
  { href: "/analysis/visibility", label: "分析", icon: BarChart3, match: ["/analysis"] },
  { href: "/tasks", label: "内容与任务", icon: Target, match: ["/tasks", "/content", "/publish", "/publishes"] },
  { href: "/settings/profile", label: "系统设置", icon: Settings, match: ["/settings"] },
];

function isActive(pathname: string, item: (typeof nav)[number]) {
  return item.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function AppShell({ children, account, supabaseEnabled = false, dataBackendEnabled = false }: { children: ReactNode; account?: AccountContext | null; supabaseEnabled?: boolean; dataBackendEnabled?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const hydrated = useAppStore((s) => s.hydrated);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const workspaceLoaded = useAppStore((s) => s.workspaceLoaded);
  const workspaceStatus = useAppStore((s) => s.workspaceStatus);
  const workspaceError = useAppStore((s) => s.workspaceError);
  const brands = useAppStore((s) => s.brands);
  const brand = useAppStore(currentBrand);
  const user = useAppStore((s) => s.user);
  const switchBrand = useAppStore((s) => s.setCurrentBrand);
  const configureDataMode = useAppStore((s) => s.configureDataMode);
  const replaceWorkspace = useAppStore((s) => s.replaceWorkspace);
  const setWorkspaceSyncStatus = useAppStore((s) => s.setWorkspaceSyncStatus);
  const clearWorkspace = useAppStore((s) => s.clearWorkspace);
  const mergeServerDetections = useAppStore((s) => s.mergeServerDetections);
  const logout = useAppStore((s) => s.logout);
  const [brandOpen, setBrandOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [workspaceReloadKey, setWorkspaceReloadKey] = useState(0);
  const [detectionReloadKey, setDetectionReloadKey] = useState(0);
  const [detectionLoadStatus, setDetectionLoadStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [detectionLoadError, setDetectionLoadError] = useState("");
  const switcherRef = useRef<HTMLDivElement>(null);
  const authenticated = supabaseEnabled ? Boolean(account) : loggedIn;
  const displayName = account?.displayName || user.name;
  const accountCaption = account?.organizationName || account?.email || user.phone;
  const hasBrands = brands.length > 0;
  const canCreateBrand = !account || account.role === "owner";

  useEffect(() => {
    if (hydrated && !authenticated) router.replace("/login");
  }, [authenticated, hydrated, router]);
  useEffect(() => {
    configureDataMode(dataBackendEnabled ? "supabase" : "local");
    if (!dataBackendEnabled || !hydrated || !authenticated || workspaceLoaded) return;
    const controller = new AbortController();
    setWorkspaceSyncStatus("loading");
    void requestJsonWithRetry<WorkspaceSnapshot>(
      "/api/workspace",
      controller.signal,
      () => setWorkspaceSyncStatus("loading", "连接较慢，正在重新加载工作空间…"),
    )
      .then((payload) => {
        replaceWorkspace(payload);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setWorkspaceSyncStatus("error", error instanceof Error ? error.message : "工作空间数据加载失败");
      });
    return () => controller.abort();
  }, [authenticated, configureDataMode, dataBackendEnabled, hydrated, replaceWorkspace, setWorkspaceSyncStatus, workspaceLoaded, workspaceReloadKey]);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!switcherRef.current?.contains(event.target as Node)) setBrandOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);
  useEffect(() => {
    if (!hydrated || !authenticated || !brand?.id || (dataBackendEnabled && !workspaceLoaded)) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setDetectionLoadStatus("loading");
      setDetectionLoadError("");
    });
    void requestJsonWithRetry<{ detections?: Detection[] }>(
      `/api/detections?brandId=${encodeURIComponent(brand.id)}`,
      controller.signal,
      () => setDetectionLoadError("连接较慢，正在重新加载检测数据…"),
    )
      .then((payload) => {
        if (payload?.detections) mergeServerDetections(payload.detections);
        setDetectionLoadStatus("ready");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setDetectionLoadStatus("error");
        setDetectionLoadError(error instanceof Error ? error.message : "检测数据加载失败");
      });
    return () => controller.abort();
  }, [authenticated, brand?.id, dataBackendEnabled, detectionReloadKey, hydrated, mergeServerDetections, workspaceLoaded]);

  useEffect(() => {
    if (!dataBackendEnabled || !workspaceLoaded || brands.length || pathname.startsWith("/brands/new") || !canCreateBrand) return;
    router.replace("/brands/new");
  }, [brands.length, canCreateBrand, dataBackendEnabled, pathname, router, workspaceLoaded]);

  if (!hydrated || !authenticated || (dataBackendEnabled && !workspaceLoaded)) {
    return <div className="empty"><div className="empty-icon"><span className="status-dot" /></div><h3>{workspaceStatus === "error" ? "工作空间加载失败" : "正在加载工作空间"}</h3>{workspaceError && <p className="muted">{workspaceError}</p>}{workspaceStatus === "error" && <button className="btn btn-primary" onClick={() => setWorkspaceReloadKey((value) => value + 1)}>重新加载</button>}</div>;
  }

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    if (dataBackendEnabled) {
      try {
        await flushWorkspaceNow();
      } catch (error) {
        setSigningOut(false);
        window.alert(error instanceof Error ? error.message : "数据尚未保存，请重试");
        return;
      }
    }
    if (supabaseEnabled) {
      const { error } = await createSupabaseBrowserClient().auth.signOut({ scope: "local" });
      if (error) {
        setSigningOut(false);
        window.alert("退出登录失败，请重试");
        return;
      }
    } else {
      const result = await signOutAction();
      if (!result.ok) {
        setSigningOut(false);
        window.alert(result.message);
        return;
      }
    }
    if (dataBackendEnabled) clearWorkspace();
    logout();
    router.replace("/login");
    router.refresh();
  }

  const brandMenu = <div className="sidebar-popover">
    {brands.map((item) => <button key={item.id} className={`brand-option ${item.id === brand?.id ? "active" : ""}`} onClick={() => { switchBrand(item.id); setBrandOpen(false); router.refresh(); }}><span className="brand-mark">{item.name.slice(0, 1)}</span><div><strong>{item.name}</strong><span>{item.industry || "待完善行业"}</span></div>{item.id === brand?.id && <span className="badge badge-primary">当前</span>}</button>)}
    {canCreateBrand && <Link href="/brands/new" className="brand-option" onClick={() => setBrandOpen(false)}><span className="brand-mark" style={{ background: "#eef2ff", color: "#4f46e5" }}><Plus size={17} /></span><div><strong>新建品牌</strong><span>创建独立品牌档案</span></div></Link>}
  </div>;

  return <AccountContextProvider account={account || null}><div className="app-shell">
    <aside className="sidebar">
      <div ref={switcherRef} style={{ position: "relative" }}>
        <button className="brand-switcher" onClick={() => setBrandOpen(!brandOpen)}><span className="brand-mark">{brand?.name.slice(0, 1) || "G"}</span><span className="brand-switcher-name"><strong>{brand?.name || (canCreateBrand ? "新建品牌" : "暂无品牌")}</strong><span>{brand?.industry || (canCreateBrand ? "请完善品牌档案" : "请联系组织所有者")}</span></span><ChevronDown size={16} /></button>
        {brandOpen && brandMenu}
      </div>
      {hasBrands && <nav className="nav">{nav.map((item) => { const Icon = item.icon; return <Link key={item.href} href={item.href} className={`nav-item ${isActive(pathname, item) ? "active" : ""}`}><Icon size={19} />{item.label}</Link>; })}</nav>}
      <div className="sidebar-bottom">
        <div className="user-card"><span className="avatar"><UserRound size={16} /></span><div><strong>{displayName}</strong><span>{accountCaption}</span></div><button className="icon-btn" title="退出登录" disabled={signingOut} onClick={() => void handleSignOut()}><LogOut size={17} /></button></div>
      </div>
    </aside>
    <header className="mobile-topbar"><button className="mobile-brand" onClick={() => setBrandOpen(!brandOpen)}><span className="brand-mark" style={{ width: 32, height: 32 }}>{brand?.name.slice(0, 1) || "G"}</span>{brand?.name || (canCreateBrand ? "新建品牌" : "暂无品牌")}<ChevronDown size={15} /></button><Link href="/settings/profile"><span className="avatar"><UserRound size={16} /></span></Link>{brandOpen && brandMenu}</header>
    <main className="main"><div className="content-wrap">{dataBackendEnabled && workspaceStatus === "error" && <div className="notice notice-danger" role="alert" style={{ marginBottom: 14 }}><span style={{ flex: 1 }}>数据暂未保存：{workspaceError}</span><button className="btn btn-sm" onClick={() => void flushWorkspaceNow().catch(() => undefined)}>重试保存</button></div>}{dataBackendEnabled && detectionLoadStatus === "loading" && <div className="notice" role="status" style={{ marginBottom: 14 }}><span className="status-dot" /><span>{detectionLoadError || "正在加载当前品牌的检测与分析数据…"}</span></div>}{dataBackendEnabled && detectionLoadStatus === "error" && <div className="notice notice-warning" role="alert" style={{ marginBottom: 14 }}><span style={{ flex: 1 }}>检测数据暂时无法加载：{detectionLoadError}</span><button className="btn btn-sm" onClick={() => setDetectionReloadKey((value) => value + 1)}>重新加载</button></div>}{children}</div></main>
    {hasBrands && <nav className="mobile-nav">{nav.map((item) => { const Icon = item.icon; return <Link key={item.href} href={item.href} className={`mobile-nav-item ${isActive(pathname, item) ? "active" : ""}`}><Icon size={20} /><span>{item.label}</span></Link>; })}</nav>}
  </div></AccountContextProvider>;
}
