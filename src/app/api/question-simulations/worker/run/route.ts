import { NextResponse } from "next/server";
import { processNextQuestionSimulationWork } from "@/lib/server/question-simulation-task-runner";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const configured = process.env.GEO_WORKER_TOKEN?.trim() || process.env.PUBLISH_WORKER_TOKEN?.trim();
  const authorization = request.headers.get("authorization") || "";
  if (!configured || authorization !== `Bearer ${configured}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const workerId = request.headers.get("x-worker-id")?.trim() || `question-simulation-${process.pid}`;
  try {
    return NextResponse.json(await processNextQuestionSimulationWork(workerId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Worker执行失败" }, { status: 500 });
  }
}
