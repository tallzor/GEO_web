import { NextResponse } from "next/server";
import { z } from "zod";
import { executeFoundationTask } from "@/lib/server/foundation-model";
import type { FoundationModelAdapter } from "@/lib/server/foundation-model/types";

export const dynamic = "force-dynamic";

const schema = z.object({ status: z.literal("ok") });

export async function POST() {
  if (process.env.GEO_TEST_MOCK_AI !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let calls = 0;
  const prompts: string[] = [];
  const adapter: FoundationModelAdapter = {
    id: "test-repair",
    isReady: () => ({ ready: true, model: "test-repair-model" }),
    async generate(request) {
      calls += 1;
      prompts.push(request.prompt);
      return {
        provider: "test-repair",
        model: "test-repair-model",
        answer: calls === 1 ? "{\"status\":" : "{\"status\":\"ok\"}",
        latencyMs: 1,
      };
    },
  };

  const result = await executeFoundationTask({
    taskType: "connectivity_test",
    promptVersion: "repair-test-v1",
    prompt: "返回结构化结果",
    schema,
    adapter,
  });
  return NextResponse.json({
    attempts: result.attempts,
    repaired: result.data.status === "ok",
    repairPromptOnly: prompts[1]?.includes("待修复输出：") === true,
  });
}
