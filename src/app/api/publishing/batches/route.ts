import { NextResponse } from "next/server";
import { z } from "zod";
import { isSupabaseDataBackendEnabled } from "@/lib/supabase/env";
import { createPublishBatch, listPublishBatches } from "@/lib/server/publishing-repository";
import { requireWorkspaceAccount, WorkspaceAccessError } from "@/lib/server/workspace-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  contentId: z.uuid(),
  channels: z.array(z.enum(["wechat", "zhihu", "xiaohongshu"])).min(1).max(3),
  idempotencyKey: z.string().trim().min(12).max(180),
});

export async function GET(request: Request) {
  if (!isSupabaseDataBackendEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const account = await requireWorkspaceAccount();
    const brandId = z.uuid().parse(new URL(request.url).searchParams.get("brandId"));
    return NextResponse.json({ batches: await listPublishBatches(account, brandId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return publishingError(error, "发布批次读取失败");
  }
}

export async function POST(request: Request) {
  if (!isSupabaseDataBackendEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const account = await requireWorkspaceAccount({ write: true });
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "发布参数不正确" }, { status: 400 });
    const batch = await createPublishBatch(account, parsed.data);
    return NextResponse.json({ batch }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return publishingError(error, "多平台同步发起失败");
  }
}

function publishingError(error: unknown, fallback: string) {
  if (error instanceof WorkspaceAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message || "请求参数不正确" }, { status: 400 });
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}
