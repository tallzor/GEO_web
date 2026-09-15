import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmQuestionSimulation } from "@/lib/server/question-simulation-repository";
import { requireWorkspaceAccount, WorkspaceAccessError } from "@/lib/server/workspace-access";

const bodySchema = z.object({
  questions: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    text: z.string().trim().min(4).max(300),
    persona: z.string().trim().min(1).max(160),
    decisionScenario: z.string().trim().min(1).max(300),
  })).min(1).max(24),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = bodySchema.parse(await request.json());
    const result = await confirmQuestionSimulation(await requireWorkspaceAccount({ write: true }), id, body.questions);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message || "候选问题格式不正确" }, { status: 400 });
    if (error instanceof WorkspaceAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "候选问题确认失败" }, { status: 500 });
  }
}
