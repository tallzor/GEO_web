import { NextResponse } from "next/server";
import { z } from "zod";
import { FoundationModelError } from "@/lib/server/foundation-model";
import { planAndCreateOptimizationCycle } from "@/lib/server/optimization-planner";
import { requireWorkspaceAccount, WorkspaceAccessError } from "@/lib/server/workspace-access";
import { isSupabaseDataBackendEnabled } from "@/lib/supabase/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  detectionId: z.uuid(),
  suggestionId: z.uuid(),
});

export async function POST(request: Request) {
  if (!isSupabaseDataBackendEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 32_000) {
    return NextResponse.json({ error: "优化任务请求过大" }, { status: 413 });
  }

  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "优化目标参数不正确" }, { status: 400 });
    }
    const account = await requireWorkspaceAccount({ write: true });
    const result = await planAndCreateOptimizationCycle(
      account,
      parsed.data.detectionId,
      parsed.data.suggestionId,
    );
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof FoundationModelError) {
      return NextResponse.json({
        error: error.message,
        code: error.code,
        category: error.category,
        retryable: error.retryable,
      }, { status: error.status });
    }
    return NextResponse.json({
      error: error instanceof Error ? error.message : "优化目标和7天任务保存失败",
    }, { status: 500 });
  }
}
