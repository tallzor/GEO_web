import { expect, test, type APIRequestContext } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type PublicDetection = {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  stage?: "queued" | "collecting" | "analyzing" | "aggregating" | "completed" | "failed";
  results: Array<{
    provider: string;
    questionId: string;
    sentimentLabel?: "积极" | "中性" | "需改善";
    reputationTopics?: Array<{ sentimentLabel?: "积极" | "中性" | "需改善" }>;
  }>;
  runErrors?: Array<{ runKey?: string; category?: string; retryable?: boolean }>;
  diagnosis?: {
    suggestions: Array<{
      id: string;
      title: string;
      description: string;
      reason: string;
    }>;
    suggestionStatus?: "not_generated" | "generating" | "generated" | "failed";
  };
};

function detectionBody(id: string, questions: string[], providers = ["doubao"] as const) {
  return {
    id,
    providers,
    brand: {
      id: `brand-${id}`,
      name: "流水线测试品牌",
      shortName: "测试品牌",
      products: [],
      competitors: [],
    },
    questions: questions.map((text, index) => ({ id: `${id}-q${index + 1}`, text })),
  };
}

async function readDetection(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/detections/${id}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json() as { detection: PublicDetection }).detection;
}

async function runWorkerStep(request: APIRequestContext) {
  const response = await request.post("/api/detections/worker/run", {
    headers: { authorization: "Bearer e2e-detection-worker-token" },
  });
  expect(response.ok()).toBeTruthy();
}

async function patchStoredDetection(id: string, patch: Record<string, unknown>) {
  const dataDir = process.env.GEO_DATA_DIR;
  if (!dataDir) throw new Error("测试检测数据目录未配置");
  const storePath = path.join(dataDir, "detection-jobs.json");
  const store = JSON.parse(await readFile(storePath, "utf8")) as {
    version: number;
    tasks: Array<Record<string, unknown> & { id: string }>;
  };
  const index = store.tasks.findIndex((task) => task.id === id);
  if (index < 0) throw new Error(`未找到测试检测任务：${id}`);
  store.tasks[index] = { ...store.tasks[index], ...patch };
  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function waitForStatus(
  request: APIRequestContext,
  id: string,
  expected: PublicDetection["status"],
  timeoutMs = 30_000,
) {
  const deadline = Date.now() + timeoutMs;
  let last: PublicDetection | undefined;
  while (Date.now() < deadline) {
    await runWorkerStep(request);
    last = await readDetection(request, id);
    if (last.status === expected) return last;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`等待检测状态 ${expected} 超时，最后状态：${last?.status || "unknown"}`);
}

test("检测完成不依赖优化建议，建议按需异步生成", async ({ request }) => {
  const id = `pipeline-${Date.now()}`;
  const created = await request.post("/api/detections", {
    data: detectionBody(id, ["普通用户会怎样选择本地服务？"]),
  });
  expect(created.status()).toBe(202);

  const completed = await waitForStatus(request, id, "completed");
  expect(completed.results).toHaveLength(1);
  expect(completed.results[0]).not.toHaveProperty("favorability");
  expect(completed.results[0]?.reputationTopics?.[0]).not.toHaveProperty("sentiment");
  expect(completed.diagnosis?.suggestions).toEqual([]);
  expect(completed.diagnosis?.suggestionStatus).toBe("not_generated");

  const firstRequest = await request.post(`/api/detections/${id}/suggestions`);
  expect(firstRequest.status()).toBe(202);
  const duplicateRequest = await request.post(`/api/detections/${id}/suggestions`);
  expect(duplicateRequest.status()).toBe(202);

  const deadline = Date.now() + 30_000;
  let generated: PublicDetection | undefined;
  while (Date.now() < deadline) {
    await runWorkerStep(request);
    generated = await readDetection(request, id);
    if (generated.diagnosis?.suggestionStatus === "generated") break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  expect(generated?.diagnosis?.suggestionStatus).toBe("generated");
  expect(generated?.diagnosis?.suggestions).toHaveLength(1);
  const suggestion = generated?.diagnosis?.suggestions[0];
  expect(suggestion?.title).toBeTruthy();
  expect(suggestion?.title).not.toMatch(/能见|排名|口碑|情感/);
  expect(suggestion?.reason).toBeTruthy();
  expect(suggestion?.description).toBeTruthy();

  const retryCompleted = await request.post(`/api/detections/${id}/retry`);
  expect(retryCompleted.status()).toBe(409);
});

test("失败重试只补缺失项，已保存结果不会重复", async ({ request }) => {
  const id = `retry-${Date.now()}`;
  const created = await request.post("/api/detections", {
    data: detectionBody(id, [
      "这条采集应当直接成功",
      `[TEST:FAIL_TWICE] 这条采集首次批次失败，重试任务后成功 ${id}`,
    ]),
  });
  expect(created.status()).toBe(202);

  const failed = await waitForStatus(request, id, "failed");
  expect(failed.results).toHaveLength(1);
  expect(failed.runErrors?.length).toBeGreaterThan(0);

  const retried = await request.post(`/api/detections/${id}/retry`);
  expect(retried.status()).toBe(202);
  const completed = await waitForStatus(request, id, "completed");
  expect(completed.results).toHaveLength(2);
  const resultKeys = completed.results.map((item) => `${item.provider}:${item.questionId}`);
  expect(new Set(resultKeys).size).toBe(resultKeys.length);
});

test("检测 Worker 接口拒绝未授权调用", async ({ request }) => {
  const response = await request.post("/api/detections/worker/run", {
    headers: { authorization: "Bearer invalid-token" },
  });
  expect(response.status()).toBe(401);
});

test("检测 Worker 在 Supabase 登录模式下使用独立 Token", async ({ request }) => {
  test.skip(process.env.GEO_TEST_AUTH_MODE !== "supabase", "仅在 Supabase 登录模式专项验证时执行");
  const response = await request.post("/api/detections/worker/run", {
    headers: { authorization: "Bearer e2e-detection-worker-token" },
  });
  expect(response.ok()).toBeTruthy();
});

test("轻量状态查询不返回原始回答，也不触发执行", async ({ request }) => {
  const id = `status-${Date.now()}`;
  const created = await request.post("/api/detections", {
    data: detectionBody(id, ["检查轻量状态快照"]),
  });
  expect(created.status()).toBe(202);

  const response = await request.get(`/api/detections/${id}?view=status`);
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { status: Record<string, unknown> };
  expect(payload.status.id).toBe(id);
  expect(payload.status).not.toHaveProperty("results");
  expect(payload.status).not.toHaveProperty("diagnosis");
});

test("可重试的临时错误自动重试一次后完成", async ({ request }) => {
  const id = `auto-retry-${Date.now()}`;
  const created = await request.post("/api/detections", {
    data: detectionBody(id, ["[TEST:RETRY_ONCE] 第一次调用失败，第二次应完成"]),
  });
  expect(created.status()).toBe(202);

  const completed = await waitForStatus(request, id, "completed");
  expect(completed.results).toHaveLength(1);
  expect(completed.runErrors || []).toHaveLength(0);
});

test("429、5xx和空回答分类失败后只补跑失败单元", async ({ request }) => {
  const id = `classified-retry-${Date.now()}`;
  const created = await request.post("/api/detections", {
    data: detectionBody(id, [
      `正常回答应保留 ${id}`,
      `[TEST:RATE_LIMIT_TWICE] 模拟429限流 ${id}`,
      `[TEST:SERVER_5XX_TWICE] 模拟上游5xx ${id}`,
      `[TEST:EMPTY_TWICE] 模拟空回答 ${id}`,
    ]),
  });
  expect(created.status()).toBe(202);

  const failed = await waitForStatus(request, id, "failed");
  expect(failed.results).toHaveLength(1);
  expect(failed.runErrors?.map((item) => item.category).sort()).toEqual([
    "collection",
    "invalid_response",
    "rate_limit",
  ]);
  expect(failed.runErrors?.every((item) => item.retryable)).toBeTruthy();

  expect((await request.post(`/api/detections/${id}/retry`)).status()).toBe(202);
  const completed = await waitForStatus(request, id, "completed");
  expect(completed.results).toHaveLength(4);
  expect(new Set(completed.results.map((item) => `${item.provider}:${item.questionId}`)).size).toBe(4);
});

test("过期租约可由新Worker接管并从已保存结果继续", async ({ request }) => {
  const id = `lease-recovery-${Date.now()}`;
  const created = await request.post("/api/detections", {
    data: detectionBody(id, ["验证Worker中断恢复"]),
  });
  expect(created.status()).toBe(202);

  await runWorkerStep(request);
  expect((await readDetection(request, id)).results).toHaveLength(1);
  await patchStoredDetection(id, {
    workerId: "stopped-worker",
    heartbeatAt: new Date().toISOString(),
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const blocked = await request.post("/api/detections/worker/run", {
    headers: {
      authorization: "Bearer e2e-detection-worker-token",
      "x-worker-id": "replacement-worker",
    },
  });
  expect((await blocked.json() as { processed: boolean }).processed).toBe(false);

  await patchStoredDetection(id, { leaseExpiresAt: new Date(Date.now() - 1_000).toISOString() });
  const completed = await waitForStatus(request, id, "completed");
  expect(completed.results).toHaveLength(1);
});

test("汇总步骤超过阶段时限后转为失败而不是永久运行", async ({ request }) => {
  test.skip(
    process.env.GEO_RUN_AGGREGATION_TIMEOUT_TEST !== "true",
    "仅在汇总超时专项验证时执行",
  );
  const id = `aggregation-timeout-${Date.now()}`;
  const created = await request.post("/api/detections", {
    data: detectionBody(id, ["验证汇总阶段超时恢复"]),
  });
  expect(created.status()).toBe(202);

  const deadline = Date.now() + 8_000;
  let latest: PublicDetection | undefined;
  while (Date.now() < deadline) {
    await runWorkerStep(request);
    latest = await readDetection(request, id);
    if (latest.status === "completed" || latest.status === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(latest?.status).toBe("failed");
  expect(latest?.stage).toBe("failed");
});

test("底座模型结构错误只修复一次", async ({ request }) => {
  const response = await request.post("/api/test/foundation-repair");
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toEqual({ attempts: 2, repaired: true, repairPromptOnly: true });
});

test("90秒慢响应不会因普通请求生命周期中断", async ({ request }) => {
  test.skip(process.env.GEO_RUN_90S_TEST !== "true", "默认跳过耗时专项；设置GEO_RUN_90S_TEST=true可执行");
  test.setTimeout(150_000);
  const id = `slow-90s-${Date.now()}`;
  const created = await request.post("/api/detections", {
    data: detectionBody(id, ["[TEST:SLOW_90S] 模拟90秒平台响应"]),
  });
  expect(created.status()).toBe(202);
  const completed = await waitForStatus(request, id, "completed", 140_000);
  expect(completed.results).toHaveLength(1);
});
