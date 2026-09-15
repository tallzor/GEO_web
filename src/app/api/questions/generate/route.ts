import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getQuestionSimulation,
  startQuestionSimulation,
} from "@/lib/server/question-simulation-repository";
import { requireWorkspaceAccount, WorkspaceAccessError } from "@/lib/server/workspace-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startSchema = z.object({
  brandId: z.string().uuid(),
  subjectType: z.enum(["brand", "product"]),
  subjectId: z.string().uuid(),
  mode: z.enum(["initial", "supplement", "new_batch"]).default("initial"),
});

export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams;
    const subjectType = search.get("subjectType");
    const run = await getQuestionSimulation(await requireWorkspaceAccount(), {
      runId: search.get("runId") || undefined,
      brandId: search.get("brandId") || undefined,
      subjectType: subjectType === "brand" || subjectType === "product" ? subjectType : undefined,
      subjectId: search.get("subjectId") || undefined,
    });
    if (!run) return NextResponse.json({ error: "模拟生成批次不存在" }, { status: 404 });
    return NextResponse.json({ run }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return simulationError(error);
  }
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 32_000) return NextResponse.json({ error: "请求内容过大" }, { status: 413 });
  try {
    const parsed = startSchema.parse(await request.json());
    const run = await startQuestionSimulation(await requireWorkspaceAccount({ write: true }), parsed);
    return NextResponse.json({ run }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return simulationError(error);
  }
}

function simulationError(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message || "模拟生成参数不正确" }, { status: 400 });
  }
  if (error instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : "模拟问题生成失败" }, { status: 500 });
}
