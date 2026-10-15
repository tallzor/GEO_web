import { NextResponse } from "next/server";
import {
  getDetectionTask,
  publicDetectionTask,
  updateDetectionTask,
} from "@/lib/server/detection-task-store";
import { isSupabaseDataBackendEnabled } from "@/lib/supabase/env";
import { requireWorkspaceAccount, WorkspaceAccessError } from "@/lib/server/workspace-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = isSupabaseDataBackendEnabled() ? await requireWorkspaceAccount({ write: true }) : null;
    const { id } = await params;
    const existing = await getDetectionTask(id, account?.organizationId);
    if (!existing) return NextResponse.json({ error: "检测任务不存在" }, { status: 404 });
    if (existing.status === "completed") {
      return NextResponse.json({ error: "已完成的检测无需重试" }, { status: 409 });
    }
    const collectionTotal = existing.collectionTotal || existing.providers.length * existing.questionSnapshots.length;
    const hasMissingCollection = existing.results.length < collectionTotal;
    const hasMissingAnalysis = existing.results.some((result) => !result.analysisModel);
    const task = await updateDetectionTask(id, (current) => ({
      ...current,
      status: "pending",
      stage: hasMissingCollection ? "collecting" : hasMissingAnalysis ? "analyzing" : "aggregating",
      completedAt: undefined,
      resultSummary: undefined,
      runErrors: [],
      failedRuns: 0,
      progressMessage: hasMissingCollection ? "正在重试失败的采集项" : hasMissingAnalysis ? "正在重试失败的分析项" : "正在重新汇总检测结果",
      attempt: (current.attempt || 1) + 1,
    }), account?.organizationId);
    if (!task) return NextResponse.json({ error: "检测任务不存在" }, { status: 404 });
    return NextResponse.json(
      { detection: publicDetectionTask(task) },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof WorkspaceAccessError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "检测任务重试失败" }, { status });
  }
}
