"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Eye,
  EyeOff,
  Sparkles,
} from "lucide-react";
import { Button, Field } from "@/components/ui";
import { useAppStore } from "@/lib/store";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

async function waitForAuthCookie(timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  const hasAuthCookie = () => document.cookie
    .split(";")
    .some((cookie) => /^sb-.*-auth-token(?:\.\d+)?=/.test(cookie.trim()));

  while (!hasAuthCookie() && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 25));
  }

  if (!hasAuthCookie()) {
    throw new Error("AUTH_COOKIE_NOT_READY");
  }
}

export function LoginForm({ supabaseEnabled }: { supabaseEnabled: boolean }) {
  const router = useRouter();
  const hydrated = useAppStore((state) => state.hydrated);
  const loggedIn = useAppStore((state) => state.loggedIn);
  const brands = useAppStore((state) => state.brands);
  const login = useAppStore((state) => state.login);
  const [account, setAccount] = useState(supabaseEnabled ? "" : "demo@geo.cn");
  const [password, setPassword] = useState(supabaseEnabled ? "" : "geo-demo");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!supabaseEnabled && hydrated && loggedIn) {
      router.replace(brands.length ? "/workbench" : "/brands/new");
    }
  }, [brands.length, hydrated, loggedIn, router, supabaseEnabled]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    startTransition(async () => {
      try {
        if (supabaseEnabled) {
          const normalizedAccount = account.trim().toLowerCase();
          if (!normalizedAccount || !password) {
            setError("请输入账号和密码");
            return;
          }
          const email = normalizedAccount.includes("@")
            ? normalizedAccount
            : `${normalizedAccount}@geo.internal`;
          const supabase = createSupabaseBrowserClient();
          const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
          if (signInError || !data.user) {
            const unavailable = signInError?.name === "AuthRetryableFetchError";
            setError(unavailable ? "认证服务暂时无法连接，请稍后重试" : "账号或密码错误");
            return;
          }
          await waitForAuthCookie();
        } else if (!account.trim() || !password) {
          setError("请输入账号和密码");
          return;
        }
        login();
        const destination = brands.length ? "/workbench" : "/brands/new";
        if (supabaseEnabled) {
          window.location.assign("/workbench");
          return;
        }
        router.replace(destination);
      } catch (requestError) {
        const timedOut = requestError instanceof DOMException && requestError.name === "TimeoutError";
        const cookieNotReady = requestError instanceof Error
          && requestError.message === "AUTH_COOKIE_NOT_READY";
        setError(cookieNotReady
          ? "登录状态保存失败，请重试"
          : timedOut
            ? "认证服务连接超时，请检查网络后重试"
            : "登录服务暂时不可用，请稍后重试");
      }
    });
  }

  return <main style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "minmax(320px, 1.05fr) minmax(360px, .95fr)", background: "#fff" }} className="login-layout">
    <section style={{ padding: "clamp(36px, 7vw, 90px)", display: "flex", flexDirection: "column", justifyContent: "space-between", color: "#fff", background: "linear-gradient(145deg, #111827 0%, #312e81 56%, #4f46e5 100%)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 18, fontWeight: 700 }}><span className="brand-mark" style={{ background: "#fff", color: "#4f46e5" }}><Sparkles size={19} /></span>品牌营销助手</div>
      <div style={{ maxWidth: 580, padding: "80px 0" }}><h1 style={{ margin: "24px 0 18px", fontSize: "clamp(36px, 5vw, 64px)", lineHeight: 1.12, letterSpacing: "-.04em" }}>让品牌被更多人<br />听到和看到</h1><p style={{ margin: 0, color: "#c7d2fe", fontSize: 17, lineHeight: 1.8 }}>从AI平台检测、内容诊断，到优化任务、内容生成与多平台发布，一套流程完成品牌营销优化。</p><div style={{ display: "grid", gap: 15, marginTop: 34 }}>{["真实AI平台回答采集与证据分析", "四维分析并输出个性化优化目标", "内容合规检查后多平台发布"].map((item) => <div key={item} style={{ display: "flex", gap: 10, alignItems: "center" }}><CheckCircle2 size={19} color="#a5b4fc" />{item}</div>)}</div></div>
      <span style={{ color: "#a5b4fc", fontSize: 12 }}>{supabaseEnabled ? "内测版本 · 仅限受邀账号" : "演示版本 · 本地登录模式"}</span>
    </section>
    <section style={{ display: "grid", placeItems: "center", padding: 24 }}>
      <form onSubmit={submit} style={{ width: "min(420px, 100%)" }}>
        <div className="brand-mark" style={{ width: 48, height: 48, marginBottom: 22 }}><BarChart3 size={22} /></div>
        <h2 style={{ margin: 0, fontSize: 28 }}>登录工作空间</h2>
        <p className="secondary" style={{ margin: "9px 0 28px" }}>{supabaseEnabled ? "请输入系统为你开通的内测账号和密码" : "使用演示账号体验完整品牌营销优化流程"}</p>
        <div className="stack">
          <Field label="登录账号" required><input className="input" type="text" autoComplete="username" value={account} onChange={(event) => setAccount(event.target.value)} placeholder="请输入登录账号或邮箱" disabled={pending} /></Field>
          <Field label="密码" required><div style={{ position: "relative" }}><input className="input" type={visible ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" style={{ paddingRight: 44 }} disabled={pending} /><button type="button" className="icon-btn" aria-label={visible ? "隐藏密码" : "显示密码"} onClick={() => setVisible(!visible)} style={{ position: "absolute", right: 9, top: 8 }}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></Field>
          {error && <div className="notice notice-danger" role="alert">{error}</div>}
          <Button variant="primary" style={{ width: "100%", minHeight: 44 }} disabled={pending}>{pending ? "正在验证…" : "进入工作台"} {!pending && <ArrowRight size={17} />}</Button>
        </div>
        <p className="muted small" style={{ textAlign: "center", marginTop: 20 }}>{supabaseEnabled ? "当前不开放注册，如需账号请联系管理员" : "演示账号和密码已预填，可直接进入"}</p>
      </form>
    </section>
    <style jsx>{`@media(max-width:767px){.login-layout{grid-template-columns:1fr!important}.login-layout>section:first-child{display:none!important}}`}</style>
  </main>;
}
