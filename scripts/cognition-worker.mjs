const baseUrl = (process.env.GEO_INTERNAL_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const token = process.env.GEO_WORKER_TOKEN || process.env.PUBLISH_WORKER_TOKEN;
const workerId = `cognition-${process.pid}`;

if (!token) {
  console.error("[cognition-worker] GEO_WORKER_TOKEN 或 PUBLISH_WORKER_TOKEN 未配置");
  process.exit(1);
}

console.log(`[cognition-worker] started as ${workerId}`);
let failures = 0;
for (;;) {
  try {
    const response = await fetch(`${baseUrl}/api/cognition-runs/worker/run`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "x-worker-id": workerId },
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    failures = 0;
    await wait(body.processed ? 250 : 3_000);
  } catch (error) {
    failures += 1;
    console.error(`[cognition-worker] ${error instanceof Error ? error.message : String(error)}`);
    await wait(Math.min(30_000, 2_000 * 2 ** Math.min(failures, 4)));
  }
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
