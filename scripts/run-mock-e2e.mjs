import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const port = 3100;
const baseUrl = `http://127.0.0.1:${port}`;
const temporaryDataDir = process.env.GEO_DATA_DIR ? "" : mkdtempSync(path.join(tmpdir(), "geo-web-e2e-"));
const dataDir = process.env.GEO_DATA_DIR || temporaryDataDir;
const env = {
  ...process.env,
  GEO_TEST_MOCK_AI: "true",
  ENABLE_LOCAL_AI_API: "true",
  GEO_DATA_BACKEND: "local",
  GEO_AUTH_MODE: process.env.GEO_TEST_AUTH_MODE || "demo",
  GEO_DATA_DIR: dataDir,
  GEO_TEST_SLOW_MS: process.env.GEO_TEST_SLOW_MS || "0",
  GEO_INTERNAL_BASE_URL: baseUrl,
  GEO_WORKER_TOKEN: "e2e-detection-worker-token",
};

const server = spawn(process.execPath, [
  path.resolve("node_modules/next/dist/bin/next"),
  "start",
  "--hostname",
  "127.0.0.1",
  "--port",
  String(port),
], { env, stdio: "inherit" });

let tests;
let stopping = false;

async function stopProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      killer.once("exit", resolve);
      killer.once("error", resolve);
    });
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function shutdown(exitCode) {
  if (stopping) return;
  stopping = true;
  await stopProcessTree(tests);
  await stopProcessTree(server);
  if (temporaryDataDir) rmSync(temporaryDataDir, { recursive: true, force: true });
  process.exit(exitCode);
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`测试网站启动失败，退出码 ${server.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/login`);
      if (response.ok) return;
    } catch {
      // 网站仍在启动。
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("等待测试网站启动超时");
}

process.on("SIGINT", () => { void shutdown(130); });
process.on("SIGTERM", () => { void shutdown(143); });

try {
  await waitForServer();
  tests = spawn(process.execPath, [
    path.resolve("node_modules/@playwright/test/cli.js"),
    "test",
    ...process.argv.slice(2),
  ], { env, stdio: "inherit" });
  const exitCode = await new Promise((resolve) => {
    tests.once("exit", (code) => resolve(code ?? 1));
    tests.once("error", () => resolve(1));
  });
  await shutdown(exitCode);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  await shutdown(1);
}
