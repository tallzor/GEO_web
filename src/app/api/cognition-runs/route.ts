import { NextResponse } from "next/server";
import { z } from "zod";
import { CognitionPreflightError } from "@/lib/cognition";
import { getCognitionRun, startCognitionRun } from "@/lib/server/cognition-repository";
import { requireWorkspaceAccount, requireWorkspaceOwner, WorkspaceAccessError } from "@/lib/server/workspace-access";
import { isSupabaseDataBackendEnabled } from "@/lib/supabase/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isSupabaseDataBackendEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const account = await requireWorkspaceAccount();
    const params = new URL(request.url).searchParams;
    const runId = params.get("runId") || undefined;
    const brandId = params.get("brandId") || undefined;
    if (runId) z.uuid().parse(runId);
    if (brandId) z.uuid().parse(brandId);
    const run = await getCognitionRun(account, { runId, brandId });
    if (!run) return NextResponse.json({ error: "尚未建立认知洞察" }, { status: 404 });
    return NextResponse.json({ run }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return cognitionError(error);
  }
}

export async function POST(request: Request) {
  if (!isSupabaseDataBackendEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const account = await requireWorkspaceOwner({ action: "建立品牌认知" });
    const body = z.object({ brandId: z.uuid() }).parse(await request.json());
    const run = await startCognitionRun(account, body.brandId);
    return NextResponse.json({ run }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return cognitionError(error);
  }
}

function cognitionError(error: unknown) {
  if (error instanceof CognitionPreflightError) {
    return NextResponse.json({ error: error.message, issues: error.issues }, { status: 422 });
  }
  if (error instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: "认知分析参数不正确" }, { status: 400 });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : "认知分析操作失败" }, { status: 500 });
}
