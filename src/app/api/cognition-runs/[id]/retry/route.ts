import { NextResponse } from "next/server";
import { z } from "zod";
import { retryCognitionRun } from "@/lib/server/cognition-repository";
import { requireWorkspaceOwner, WorkspaceAccessError } from "@/lib/server/workspace-access";
import { isSupabaseDataBackendEnabled } from "@/lib/supabase/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseDataBackendEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const account = await requireWorkspaceOwner({ action: "重试品牌认知分析" });
    const { id } = await params;
    const run = await retryCognitionRun(account, z.uuid().parse(id));
    return NextResponse.json({ run }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "认知分析批次ID不正确" }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "认知分析重试失败" }, { status: 500 });
  }
}
