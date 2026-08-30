import { NextResponse } from "next/server";
import {
  getDetectionTask,
  getDetectionTaskStatus,
  publicDetectionTask,
} from "@/lib/server/detection-task-store";
import { isSupabaseDataBackendEnabled } from "@/lib/supabase/env";
import { requireWorkspaceAccount, WorkspaceAccessError } from "@/lib/server/workspace-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = isSupabaseDataBackendEnabled() ? await requireWorkspaceAccount() : null;
    const { id } = await params;
    if (new URL(request.url).searchParams.get("view") === "status") {
      const status = await getDetectionTaskStatus(id, account?.organizationId);
      if (!status) return NextResponse.json({ error: "检测任务不存在" }, { status: 404 });
      return NextResponse.json(
        { status },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const task = await getDetectionTask(id, account?.organizationId);
    if (!task) return NextResponse.json({ error: "检测任务不存在" }, { status: 404 });
    return NextResponse.json(
      { detection: publicDetectionTask(task) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof WorkspaceAccessError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "检测任务读取失败" }, { status });
  }
}
