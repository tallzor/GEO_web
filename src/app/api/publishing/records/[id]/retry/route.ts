import { NextResponse } from "next/server";
import { z } from "zod";
import { isSupabaseDataBackendEnabled } from "@/lib/supabase/env";
import { retryPublishRecord } from "@/lib/server/publishing-repository";
import { requireWorkspaceAccount, WorkspaceAccessError } from "@/lib/server/workspace-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSupabaseDataBackendEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const account = await requireWorkspaceAccount({ write: true });
    const { id } = await context.params;
    const batch = await retryPublishRecord(account, z.uuid().parse(id));
    return NextResponse.json({ batch }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "发布记录ID不正确" }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "发布重试失败" }, { status: 500 });
  }
}
