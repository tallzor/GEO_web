const baseUrl = (process.env.GEO_INTERNAL_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const token = process.env.PUBLISH_WORKER_TOKEN?.trim();
const workerId = `publishing-${process.pid}`;
let running = true;

if (!token) {
  console.error("[publishing-worker] Missing PUBLISH_WORKER_TOKEN");
  process.exit(1);
}

process.on("SIGINT", () => { running = false; });
process.on("SIGTERM", () => { running = false; });

console.log(`[publishing-worker] started as ${workerId}`);

while (running) {
  try {
    const response = await fetch(`${baseUrl}/api/publishing/worker/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Worker-Id": workerId,
      },
      signal: AbortSignal.timeout(45_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if (payload.processed) {
      console.log(`[publishing-worker] ${payload.recordId} -> ${payload.status}`);
      await wait(250);
    } else {
      await wait(3_000);
    }
  } catch (error) {
    console.error(`[publishing-worker] ${error instanceof Error ? error.message : String(error)}`);
    await wait(5_000);
  }
}

console.log("[publishing-worker] stopped");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
