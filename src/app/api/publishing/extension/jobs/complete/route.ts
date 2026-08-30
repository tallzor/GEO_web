import { NextResponse } from "next/server";
import { z } from "zod";
import { completeZhihuExtensionJob, PublishingExtensionError } from "@/lib/server/publishing-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  recordId: z.uuid(),
  success: z.boolean(),
  draftUrl: z.url().max(1000).optional(),
  error: z.string().max(500).optional(),
});

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: Request) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
    if (!token) throw new PublishingExtensionError("缺少扩展连接凭据", 401);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "扩展回执不正确" }, { status: 400, headers: corsHeaders() });
    return NextResponse.json(await completeZhihuExtensionJob(token, parsed.data), { headers: corsHeaders() });
  } catch (error) {
    const status = error instanceof PublishingExtensionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "扩展任务回执失败" }, { status, headers: corsHeaders() });
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
