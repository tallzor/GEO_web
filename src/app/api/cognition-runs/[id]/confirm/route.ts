import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmCognitionRun } from "@/lib/server/cognition-repository";
import { requireWorkspaceOwner, WorkspaceAccessError } from "@/lib/server/workspace-access";
import { isSupabaseDataBackendEnabled } from "@/lib/supabase/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  revisions: z.array(z.object({
    insightId: z.uuid(),
    items: z.array(z.object({
      key: z.string().min(1).max(80),
      conclusion: z.string().trim().min(1).max(2_000),
    })).length(6),
  })).min(2).max(51),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseDataBackendEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const account = await requireWorkspaceOwner({ action: "确认品牌认知" });
    const { id } = await params;
    const body = requestSchema.parse(await request.json());
    const run = await confirmCognitionRun(account, z.uuid().parse(id), body.revisions);
    return NextResponse.json({ run }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "认知洞察审核内容不正确" }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "认知洞察确认失败" }, { status: 500 });
  }
}
