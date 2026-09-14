import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";

let admin: SupabaseClient;
let userId = "";
let organizationId = "";
let email = "";
let password = "";

test.beforeAll(async () => {
  admin = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const runId = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  email = `geo-workspace-concurrency-${runId}@example.com`;
  password = randomBytes(24).toString("base64url");
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error || new Error("Could not create concurrency user");
  userId = created.data.user.id;
  await mustInsert("profiles", {
    id: userId,
    display_name: "并发验收用户",
    email,
    status: "active",
    invited_at: new Date().toISOString(),
  });
  const organization = await admin.from("organizations").insert({
    name: `workspace-concurrency-${runId}`,
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

test("stale workspace snapshot cannot overwrite a concurrent save", async ({ page }) => {
  await login(page);

  const loaded = await page.request.get("/api/workspace");
  expect(loaded.ok()).toBeTruthy();
  const workspace = await loaded.json() as Record<string, unknown>;
  const snapshot = {
    brands: workspace.brands,
    currentBrandId: workspace.currentBrandId,
    cycles: workspace.cycles,
    contents: workspace.contents,
  };
  const expectedRevision = typeof workspace.workspaceRevision === "string"
    ? workspace.workspaceRevision
    : "legacy-workspace-without-revision";

  const first = await page.request.put("/api/workspace", {
    data: { snapshot, scopes: ["brands"], expectedRevision },
  });
  expect(first.ok()).toBeTruthy();
  const second = await page.request.put("/api/workspace", {
    data: { snapshot, scopes: ["brands"], expectedRevision },
  });
  expect(second.status()).toBe(409);
});

test("new brand snapshot with child rows saves under revision guard", async ({ page }) => {
  await login(page);
  const loaded = await page.request.get("/api/workspace");
  expect(loaded.ok()).toBeTruthy();
  const workspace = await loaded.json() as Record<string, unknown>;
  const now = new Date().toISOString();
  const brandId = randomUUID();
  const response = await page.request.put("/api/workspace", {
    data: {
      expectedRevision: workspace.workspaceRevision,
      scopes: ["brands", "currentBrand"],
      snapshot: {
        brands: [{
          id: brandId,
          name: "并发保护新品牌",
          shortName: "新品牌",
          characteristics: "透明、稳定",
          categoryName: "本地服务",
          trustProof: "真实测试",
          positioningStatement: "验证完整品牌保存",
          industry: "健身",
          website: "",
          intro: "用于验证新品牌与子数据写入。",
          city: "上海",
          serviceArea: "上海",
          targetAudience: "本地用户",
          stores: [],
          products: [{
            id: randomUUID(),
            name: "体验产品",
            type: "服务",
            description: "体验产品说明",
            price: "99元",
            features: "专业指导",
            audience: "新用户",
            updatedAt: now,
          }],
          competitors: [{ id: randomUUID(), name: "测试竞品", description: "竞品说明" }],
          knowledge: [],
          questions: [],
          questionContextUpdatedAt: now,
          createdAt: now,
          updatedAt: now,
        }],
        currentBrandId: brandId,
        cycles: [],
        contents: [],
      },
    },
    timeout: 60_000,
  });
  expect(response.status(), await response.text()).toBe(200);
  expect(await count("brands")).toBe(1);
  expect(await count("brand_products")).toBe(1);
  expect(await count("brand_competitors")).toBe(1);
});

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("登录账号").fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/brands\/new/);
}

async function mustInsert(table: string, value: Record<string, unknown>) {
  const result = await admin.from(table).insert(value);
  if (result.error) throw result.error;
}

async function count(table: string) {
  const result = await admin.from(table).select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  if (result.error) throw result.error;
  return result.count || 0;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
