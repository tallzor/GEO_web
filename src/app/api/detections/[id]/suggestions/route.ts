import { NextResponse } from "next/server";
import { getDetectionTask, publicDetectionTask, updateDetectionTask } from "@/lib/server/detection-task-store";
import { isSupabaseDataBackendEnabled } from "@/lib/supabase/env";
import { requireWorkspaceAccount, WorkspaceAccessError } from "@/lib/server/workspace-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = isSupabaseDataBackendEnabled() ? await requireWorkspaceAccount({ write: true }) : null;
    const { id } = await params;
    const current = await getDetectionTask(id, account?.organizationId);
    if (!current) return NextResponse.json({ error: "检测任务不存在" }, { status: 404 });
    if (current.status !== "completed" || !current.diagnosis) {
      return NextResponse.json({ error: "请先完成检测与分析" }, { status: 409 });
    }
    if (current.diagnosis.suggestionStatus === "generating") {
      return NextResponse.json({ detection: publicDetectionTask(current) }, { status: 202 });
    }
    const task = await updateDetectionTask(id, (item) => ({
      ...item,
      diagnosis: item.diagnosis ? {
        ...item.diagnosis,
        suggestions: [],
        suggestionStatus: "generating",
        suggestionError: undefined,
        suggestionUpdatedAt: new Date().toISOString(),
      } : item.diagnosis,
    }), account?.organizationId);
    return NextResponse.json({ detection: publicDetectionTask(task!) }, { status: 202 });
  } catch (error) {
    const status = error instanceof WorkspaceAccessError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "优化建议任务创建失败" }, { status });
  }
}
