import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processNextWeChatJob } from "@/lib/server/publishing-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const expected = process.env.PUBLISH_WORKER_TOKEN?.trim();
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!expected || !provided || !safeEqual(expected, provided)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const workerId = request.headers.get("x-worker-id")?.slice(0, 80) || "publishing-worker";
    return NextResponse.json(await processNextWeChatJob(workerId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "发布任务执行失败" }, { status: 500 });
  }
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
