import { NextResponse } from "next/server";
import { claimZhihuExtensionJob, PublishingExtensionError } from "@/lib/server/publishing-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: Request) {
  try {
    const token = bearer(request);
    const result = await claimZhihuExtensionJob(token, request.headers.get("x-extension-version") || undefined);
    return NextResponse.json(result, { headers: { ...corsHeaders(), "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof PublishingExtensionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "扩展任务领取失败" }, { status, headers: corsHeaders() });
  }
}

function bearer(request: Request) {
  const value = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!value) throw new PublishingExtensionError("缺少扩展连接凭据", 401);
  return value;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
