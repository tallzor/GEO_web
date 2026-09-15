import { NextResponse } from "next/server";
import { z } from "zod";
import {
  addManualQuestion,
  deleteQuestionPermanently,
  setQuestionEnabled,
} from "@/lib/server/question-library-repository";
import { requireWorkspaceAccount, WorkspaceAccessError } from "@/lib/server/workspace-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  brandId: z.string().uuid(),
  subjectType: z.enum(["brand", "product"]),
  subjectId: z.string().uuid(),
  text: z.string().trim().min(4).max(300),
  persona: z.string().trim().min(1).max(160),
  decisionScenario: z.string().trim().min(1).max(300),
});

const updateSchema = z.object({
  questionId: z.string().uuid(),
  enabled: z.boolean(),
});

export async function POST(request: Request) {
  try {
    const parsed = createSchema.parse(await request.json());
    const question = await addManualQuestion(await requireWorkspaceAccount({ write: true }), parsed);
    return NextResponse.json({ question }, { status: 201 });
  } catch (error) {
    return questionError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const parsed = updateSchema.parse(await request.json());
    const question = await setQuestionEnabled(
      await requireWorkspaceAccount({ write: true }),
      parsed.questionId,
      parsed.enabled,
    );
    return NextResponse.json({ question });
  } catch (error) {
    return questionError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const questionId = z.string().uuid().parse(new URL(request.url).searchParams.get("questionId"));
    await deleteQuestionPermanently(await requireWorkspaceAccount({ write: true }), questionId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return questionError(error);
  }
}

function questionError(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message || "检测问题格式不正确" }, { status: 400 });
  }
  if (error instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : "检测问题操作失败" }, { status: 500 });
}
