import { NextResponse } from "next/server";
import { cancelQuestionSimulation } from "@/lib/server/question-simulation-repository";
import { requireWorkspaceAccount, WorkspaceAccessError } from "@/lib/server/workspace-access";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const run = await cancelQuestionSimulation(await requireWorkspaceAccount({ write: true }), id);
    return NextResponse.json({ run });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "模拟生成批次放弃失败" }, { status: 500 });
  }
}
