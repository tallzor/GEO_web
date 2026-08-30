import { spawn } from "node:child_process";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const mock = args.has("--mock");
const portArgument = process.argv.find((item) => item.startsWith("--port="));
const port = Number.parseInt(portArgument?.split("=")[1] || "3100", 10);
const baseUrl = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  GEO_INTERNAL_BASE_URL: baseUrl,
  GEO_WORKER_TOKEN: process.env.GEO_WORKER_TOKEN || process.env.PUBLISH_WORKER_TOKEN || (mock ? "e2e-detection-worker-token" : ""),
};

if (mock) {
  env.GEO_TEST_MOCK_AI = "true";
  env.ENABLE_LOCAL_AI_API = "true";
  env.GEO_DATA_BACKEND = "local";
  env.GEO_AUTH_MODE = "demo";
  env.GEO_DATA_DIR = process.env.GEO_DATA_DIR || path.resolve("test-results/server-data");
  env.GEO_TEST_SLOW_MS = process.env.GEO_TEST_SLOW_MS || "0";
}

if (!env.GEO_WORKER_TOKEN) {
  console.error("[test-stack] GEO_WORKER_TOKEN 或 PUBLISH_WORKER_TOKEN 未配置");
  process.exit(1);
}

const web = spawn(process.execPath, [
  path.resolve("node_modules/next/dist/bin/next"),
  "start",
  "--hostname",
  "127.0.0.1",
  "--port",
  String(port),
], { env, stdio: "inherit" });

const worker = spawn(process.execPath, [path.resolve("scripts/detection-worker.mjs")], {
  env,
  stdio: "inherit",
});

let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  web.kill();
  worker.kill();
  setTimeout(() => process.exit(exitCode), 250).unref();
}

web.on("exit", (code, signal) => {
  if (!shuttingDown) {
    console.error(`[test-stack] 网站进程退出：${signal || code || 0}`);
    shutdown(code || 1);
  }
});

worker.on("exit", (code, signal) => {
  if (!shuttingDown) {
    console.error(`[test-stack] 检测 Worker 退出：${signal || code || 0}`);
    shutdown(code || 1);
  }
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
