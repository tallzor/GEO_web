import { NextResponse } from "next/server";
import { z } from "zod";
import { isSupabaseDataBackendEnabled } from "@/lib/supabase/env";
import { configureWeChatAccount, createZhihuExtensionToken, listPublishingAccounts } from "@/lib/server/publishing-repository";
import { requireWorkspaceAccount, WorkspaceAccessError } from "@/lib/server/workspace-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const brandSchema = z.uuid();

export async function GET(request: Request) {
  if (!isSupabaseDataBackendEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const account = await requireWorkspaceAccount();
    const brandId = brandSchema.parse(new URL(request.url).searchParams.get("brandId"));
    return NextResponse.json({ platforms: await listPublishingAccounts(account, brandId) }, noStore());
  } catch (error) {
    return publishingError(error, "发布账号读取失败");
  }
}

export async function POST(request: Request) {
  if (!isSupabaseDataBackendEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (Number(request.headers.get("content-length") || 0) > 3 * 1024 * 1024) {
    return NextResponse.json({ error: "账号配置请求过大" }, { status: 413 });
  }
  try {
    const account = await requireWorkspaceAccount({ write: true });
    if (!account.role || !["owner", "admin"].includes(account.role)) {
      return NextResponse.json({ error: "只有组织管理员可以配置发布账号" }, { status: 403 });
    }
    const form = await request.formData();
    const channel = String(form.get("channel") || "");
    const brandId = brandSchema.parse(String(form.get("brandId") || ""));
    const accountName = z.string().trim().min(1, "请输入平台账号名称").max(80).parse(String(form.get("accountName") || ""));
    if (channel === "wechat") {
      const appId = z.string().trim().min(6, "请输入正确的 AppID").max(80).parse(String(form.get("appId") || ""));
      const appSecretText = String(form.get("appSecret") || "").trim();
      const coverValue = form.get("cover");
      const platforms = await configureWeChatAccount(account, {
        brandId,
        accountName,
        appId,
        appSecret: appSecretText || undefined,
        cover: coverValue instanceof File && coverValue.size > 0 ? coverValue : undefined,
      });
      return NextResponse.json({ ok: true, platforms }, noStore());
    }
    if (channel === "zhihu") {
      const result = await createZhihuExtensionToken(account, { brandId, accountName });
      return NextResponse.json({ ok: true, extensionToken: result.token, platforms: result.platforms }, noStore());
    }
    return NextResponse.json({ error: "该平台暂不支持配置" }, { status: 400 });
  } catch (error) {
    return publishingError(error, "发布账号配置失败");
  }
}

function noStore() {
  return { headers: { "Cache-Control": "no-store" } };
}

function publishingError(error: unknown, fallback: string) {
  if (error instanceof WorkspaceAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message || "请求参数不正确" }, { status: 400 });
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}
