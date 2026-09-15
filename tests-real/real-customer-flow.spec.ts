import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const UI = {
  loginAccount: "\u767b\u5f55\u8d26\u53f7",
  password: "\u5bc6\u7801",
  enterWorkbench: "\u8fdb\u5165\u5de5\u4f5c\u53f0",
  brandName: "\u54c1\u724c\u540d\u79f0",
  industry: "\u6240\u5c5e\u884c\u4e1a",
  serviceMarket: "\u670d\u52a1\u5e02\u573a",
  brandDescription: "\u54c1\u724c\u63cf\u8ff0",
  targetAudience: "\u76ee\u6807\u4eba\u7fa4",
  next: "\u4e0b\u4e00\u6b65",
  addProduct: "\u65b0\u589e\u4ea7\u54c1",
  productName: "\u4ea7\u54c1\u540d\u79f0",
  productDescription: "\u4ea7\u54c1\u7b80\u4ecb",
  price: "\u4ef7\u683c\u8bf4\u660e",
  audience: "\u9002\u7528\u4eba\u7fa4",
  features: "\u6838\u5fc3\u7279\u70b9",
  addCompetitor: "\u65b0\u589e\u7ade\u54c1",
  competitorName: "\u7ade\u54c1\u540d\u79f0",
  competitorDescription: "\u7ade\u54c1\u63cf\u8ff0",
  finish: "\u5b8c\u6210",
  enterDetection: "\u8fdb\u5165AI\u68c0\u6d4b",
  deepSeek: "DeepSeek",
  hunyuan: "\u6df7\u5143\uff08\u817e\u8baf\u5143\u5b9d\uff09",
  startDetection: "\u5f00\u59cb\u68c0\u6d4b",
  resultDetail: "\u68c0\u6d4b\u7ed3\u679c\u660e\u7ec6",
  getSuggestions: "\u83b7\u53d6\u5efa\u8bae",
  chooseGoal: "\u9009\u62e9\u76ee\u6807",
  confirmTasks: "\u786e\u8ba4\u5e76\u521b\u5efa7\u5929\u4efb\u52a1",
  logout: "\u9000\u51fa\u767b\u5f55",
};

let admin: SupabaseClient;
let userId = "";
let organizationId = "";
let email = "";
let password = "";
let brandName = "";

test.beforeAll(async () => {
  admin = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const runId = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  email = `geo-real-acceptance-${runId}@example.com`;
  password = randomBytes(24).toString("base64url");
  brandName = `\u6f84\u5149\u666e\u62c9\u63d0\u9a8c\u6536\u54c1\u724c-${runId.slice(-6)}`;

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "\u771f\u5b9e\u5ba2\u6237\u9a8c\u6536\u5458" },
  });
  if (created.error || !created.data.user) throw created.error || new Error("Could not create acceptance user");
  userId = created.data.user.id;

  await mustInsert("profiles", {
    id: userId,
    display_name: "\u771f\u5b9e\u5ba2\u6237\u9a8c\u6536\u5458",
    email,
    status: "active",
    invited_at: new Date().toISOString(),
  });
  const organization = await admin.from("organizations").insert({
    name: `real-acceptance-org-${runId}`,
    status: "active",
    created_by: userId,
  }).select("id").single();
  if (organization.error || !organization.data) throw organization.error || new Error("Could not create organization");
  organizationId = organization.data.id;
  const now = new Date().toISOString();
  await mustInsert("organization_members", {
    organization_id: organizationId,
    user_id: userId,
    role: "owner",
    status: "active",
    invited_at: now,
    activated_at: now,
  });
  await mustInsert("user_preferences", { user_id: userId, organization_id: organizationId });
});

test.afterAll(async () => {
  if (organizationId) await admin.from("organizations").delete().eq("id", organizationId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

test("real customer core flow uses live APIs and persists through relogin", async ({ page }, testInfo) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/")) apiRequests.push(`${request.method()} ${pathname}`);
  });

  await test.step("invited account creates a complete brand", async () => {
    await page.goto("/login");
    await page.getByLabel(UI.loginAccount).fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: UI.enterWorkbench }).click();
    await expect(page).toHaveURL(/brands\/new/);

    await page.getByLabel(UI.brandName).fill(brandName);
    await page.getByLabel(UI.industry).selectOption({ label: "\u5065\u8eab" });
    await page.getByLabel(UI.serviceMarket).fill("\u4e0a\u6d77\u5e02\u5f90\u6c47\u533a");
    await page.getByLabel(UI.brandDescription).fill("\u9762\u5411\u9644\u8fd1\u4e0a\u73ed\u65cf\u4e0e\u96f6\u57fa\u7840\u5973\u6027\u7684\u672c\u5730\u666e\u62c9\u63d0\u5de5\u4f5c\u5ba4\u3002");
    await page.getByLabel(UI.targetAudience).fill("\u4e45\u5750\u4e0a\u73ed\u65cf\u3001\u666e\u62c9\u63d0\u96f6\u57fa\u7840\u7528\u6237\u3001\u5e0c\u671b\u6539\u5584\u4f53\u6001\u7684\u5973\u6027\u3002");
    await page.getByRole("button", { name: UI.next, exact: true }).click();

    await page.getByRole("button", { name: UI.addProduct, exact: true }).click();
    await page.getByLabel(UI.productName).fill("\u96f6\u57fa\u7840\u666e\u62c9\u63d0\u4f53\u9a8c\u8bfe");
    await page.getByLabel(UI.productDescription).fill("\u5305\u542b\u4f53\u6001\u8bc4\u4f30\u3001\u5668\u68b0\u57fa\u7840\u6559\u5b66\u548c\u4e00\u5bf9\u4e00\u52a8\u4f5c\u5efa\u8bae\u3002");
    await page.getByLabel(UI.price).fill("\u9996\u6b21\u4f53\u9a8c99\u5143");
    await page.getByLabel(UI.audience).fill("\u4e45\u5750\u4e0a\u73ed\u65cf\u548c\u666e\u62c9\u63d0\u96f6\u57fa\u7840\u7528\u6237");
    await page.getByLabel(UI.features).fill("\u5c0f\u73ed\u9884\u7ea6\u5236\u3001\u6301\u8bc1\u6559\u7ec3\u3001\u5148\u8bc4\u4f30\u540e\u8bad\u7ec3");
    await page.getByRole("button", { name: UI.next, exact: true }).click();

    await page.getByRole("button", { name: UI.addCompetitor, exact: true }).click();
    await page.getByLabel(UI.competitorName).fill("\u8d85\u7ea7\u7338\u7338");
    await page.getByLabel(UI.competitorDescription).fill("\u4e0a\u6d77\u8fde\u9501\u56e2\u4f53\u5065\u8eab\u54c1\u724c");
    await page.getByRole("button", { name: UI.finish, exact: true }).click();
    await expect(page).toHaveURL(/workbench/);
    await expect(page.getByRole("heading", { name: brandName, exact: true })).toBeVisible();

    await expect.poll(() => count("brands"), { timeout: 30_000 }).toBe(1);
    await expect.poll(() => count("brand_products"), { timeout: 30_000 }).toBe(1);
    await expect.poll(() => count("brand_competitors"), { timeout: 30_000 }).toBe(1);
    await page.reload();
    await expect(page.getByRole("heading", { name: brandName, exact: true })).toBeVisible();
  });

  await test.step("confirmed cognition drives candidate review before questions enter the library", async () => {
    await page.goto("/brand/cognition");
    await page.getByRole("button", { name: "开始认知分析" }).click();
    await expect(page.getByRole("button", { name: "一次确认全部洞察" })).toBeVisible({ timeout: 180_000 });
    await page.getByRole("button", { name: "一次确认全部洞察" }).click();
    await expect(page.getByText("已确认", { exact: true }).first()).toBeVisible();
    await page.getByRole("link", { name: "模拟品牌问题" }).click();
    await page.getByRole("button", { name: "开始模拟" }).click();
    await expect(page.getByText(/候选问题审核/)).toBeVisible({ timeout: 180_000 });
    await page.getByRole("button", { name: /确认 \d+ 道并加入问题库/ }).click();
    await expect(page).toHaveURL(/geo\/questions/);
    await expect.poll(async () => {
      const questionCount = await count("detection_questions");
      return questionCount >= 1 && questionCount <= 24;
    }, { timeout: 30_000 }).toBe(true);
    await page.goto("/geo/new");
  });

  await test.step("a live model provider collects an answer and foundation model analyses it", async () => {
    await page.getByRole("button", { name: UI.next }).click();
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: UI.startDetection }).click();
    await expect(page).toHaveURL(/geo\/progress/);
    await expect(page).toHaveURL(/geo\/results/, { timeout: 8 * 60_000 });
    await expect(page.getByRole("heading", { name: UI.resultDetail })).toBeVisible();
    await page.goto("/analysis/visibility");
    await expect(page.getByRole("region", { name: "\u5206\u6790\u603b\u89c8" })).toBeVisible();
  });

  await test.step("customer selects a personalized goal and receives seven tasks", async () => {
    const suggestionRequest = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && /\/api\/detections\/[^/]+\/suggestions$/.test(new URL(response.url()).pathname),
    { timeout: 30_000 });
    await page.getByRole("button", { name: UI.getSuggestions }).click();
    expect((await suggestionRequest).status()).toBe(202);
    const goalButton = page.getByRole("button", { name: UI.chooseGoal }).first();
    await expect(goalButton).toBeVisible({ timeout: 200_000 });
    await goalButton.click();
    const cycleResponsePromise = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/optimization/cycles",
    { timeout: 200_000 });
    await page.getByRole("button", { name: UI.confirmTasks }).click();
    const cycleResponse = await cycleResponsePromise;
    if (!cycleResponse.ok()) {
      throw new Error(`Seven-day planning failed (${cycleResponse.status()}): ${await cycleResponse.text()}`);
    }
    await expect(page).toHaveURL(/tasks/, { timeout: 30_000 });
    await expect(page.locator(".task-plan-row")).toHaveCount(7);
    // Goal/task creation currently reaches the UI before the debounced save.
    await expect.poll(() => count("optimization_cycles"), { timeout: 30_000 }).toBe(1);
    await expect.poll(() => count("optimization_tasks"), { timeout: 30_000 }).toBe(7);
  });

  await test.step("refresh and relogin preserve the goal and seven tasks", async () => {
    await page.reload();
    await expect(page.locator(".task-plan-row")).toHaveCount(7);
    await page.getByTitle(UI.logout).click();
    await expect(page).toHaveURL(/login/);
    await page.getByLabel(UI.loginAccount).fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: UI.enterWorkbench }).click();
    await expect(page.getByRole("heading", { name: brandName, exact: true })).toBeVisible();
    await page.goto("/tasks");
    await expect(page.locator(".task-plan-row")).toHaveCount(7);
  });

  await test.step("database contains a complete live-data loop", async () => {
    await expect.poll(() => Promise.all([
      count("brands"), count("detection_questions"), count("detections"), count("detection_results"),
      count("detection_analyses"), count("detection_diagnoses"), count("optimization_cycles"),
      count("optimization_tasks"),
    ]), { timeout: 30_000 }).toEqual([1, 15, 1, 1, 1, 1, 1, 7]);

    const detections = await admin.from("detections").select("data_source,analysis_model").eq("organization_id", organizationId);
    if (detections.error) throw detections.error;
    expect(detections.data.every((item) => item.data_source === "live_api")).toBe(true);
    expect(detections.data.every((item) => item.analysis_model && item.analysis_model !== "test-model")).toBe(true);

    const results = await admin.from("detection_results").select("data_source,model,request_id").eq("organization_id", organizationId);
    if (results.error) throw results.error;
    expect(results.data.every((item) => item.data_source === "live_api")).toBe(true);
    expect(results.data.every((item) => item.model !== "test-model" && !String(item.request_id).startsWith("mock-"))).toBe(true);
    expect(apiRequests.every((item) => !item.includes("/api/dev/"))).toBe(true);
    await testInfo.attach("core-live-api-requests", {
      body: Buffer.from(JSON.stringify(apiRequests, null, 2)),
      contentType: "application/json",
    });
  });
});

async function mustInsert(table: string, value: Record<string, unknown>) {
  const result = await admin.from(table).insert(value);
  if (result.error) throw result.error;
}

async function count(table: string) {
  const result = await admin.from(table).select("id", { count: "exact", head: true }).eq("organization_id", organizationId);
  if (result.error) throw result.error;
  return result.count || 0;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
