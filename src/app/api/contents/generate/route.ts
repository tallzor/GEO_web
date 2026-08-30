import { NextResponse } from "next/server";
import { z } from "zod";
import { generateOptimizationContent } from "@/lib/server/content-generator";
import { FoundationModelError } from "@/lib/server/foundation-model";
import { requireWorkspaceAccount, WorkspaceAccessError } from "@/lib/server/workspace-access";
import { isSupabaseDataBackendEnabled } from "@/lib/supabase/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  cycleId: z.uuid(),
  taskId: z.uuid(),
  contentId: z.uuid().optional(),
});

export async function POST(request: Request) {
  if (!isSupabaseDataBackendEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 32_000) {
    return NextResponse.json({ error: "内容生成请求过大" }, { status: 413 });
  }
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "内容生成参数不正确" }, { status: 400 });
    }
    const account = await requireWorkspaceAccount({ write: true });
    const result = await generateOptimizationContent(account, parsed.data);
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
      error: error instanceof Error ? error.message : "内容生成失败",
    }, { status: 500 });
  }
}
