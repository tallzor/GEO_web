"use server";

import { z } from "zod";
import { isSupabaseAuthEnabled } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SignInResult, SimpleActionResult } from "./types";

const emailSchema = z.string().email();
const internalAccountSchema = z.string().regex(
  /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,39}$/,
  "请输入有效的登录账号或邮箱",
);

const credentialsSchema = z.object({
  account: z.string().trim().min(1, "请输入登录账号").refine(
    (value) => emailSchema.safeParse(value).success || internalAccountSchema.safeParse(value).success,
    "请输入有效的登录账号或邮箱",
  ),
  password: z.string().min(1, "请输入密码"),
});

function resolveLoginEmail(account: string) {
  const normalized = account.trim().toLowerCase();
  return normalized.includes("@") ? normalized : `${normalized}@geo.internal`;
}

export async function signInAction(input: {
  account: string;
  password: string;
}): Promise<SignInResult> {
  if (!isSupabaseAuthEnabled()) {
    return input.account.trim() && input.password
      ? { ok: true, mode: "demo" }
      : { ok: false, message: "请输入账号和密码" };
  }

  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message || "登录信息不完整" };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: resolveLoginEmail(parsed.data.account),
      password: parsed.data.password,
    });

    if (error || !data.user) {
      return { ok: false, message: "账号或密码错误" };
    }

    const [{ data: profile }, { data: membership }] = await Promise.all([
      supabase
        .from("profiles")
        .select("status")
        .eq("id", data.user.id)
        .maybeSingle(),
      supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", data.user.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle(),
    ]);

    if ((profile as { status?: string } | null)?.status !== "active" || !membership) {
      await supabase.auth.signOut({ scope: "local" });
      return { ok: false, message: "账号尚未开通或已停用，请联系管理员" };
    }

    return { ok: true, mode: "supabase" };
  } catch {
    return { ok: false, message: "登录服务暂不可用，请稍后重试" };
  }
}

export async function signOutAction(): Promise<SimpleActionResult> {
  if (!isSupabaseAuthEnabled()) {
    return { ok: true };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    return error
      ? { ok: false, message: "退出登录失败，请重试" }
      : { ok: true };
  } catch {
    return { ok: false, message: "退出登录失败，请重试" };
  }
}

const profileSchema = z.object({
  displayName: z.string().trim().min(1, "请输入用户名称").max(40, "用户名称不能超过40个字"),
  phone: z.string().trim().max(30, "手机号格式不正确"),
});

export async function updateProfileAction(input: {
  displayName: string;
  phone: string;
}) {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, message: parsed.error.issues[0]?.message || "用户信息不完整" };
  }

  if (!isSupabaseAuthEnabled()) {
    return { ok: true as const, mode: "demo" as const };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    const userId = claimsData?.claims?.sub;
    if (claimsError || !userId) {
      return { ok: false as const, message: "登录状态已失效，请重新登录" };
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        display_name: parsed.data.displayName,
        phone: parsed.data.phone || null,
      })
      .eq("id", userId);
    if (profileError) {
      return { ok: false as const, message: "用户信息保存失败，请重试" };
    }

    await supabase.auth.updateUser({
      data: { display_name: parsed.data.displayName },
    });
    return { ok: true as const, mode: "supabase" as const };
  } catch {
    return { ok: false as const, message: "用户信息保存失败，请重试" };
  }
}
