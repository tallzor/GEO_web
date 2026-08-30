import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const admin = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SECRET_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
);

let userId = "";
let organizationId = "";
let brandId = "";
let email = "";
let password = "";

test.beforeAll(async () => {
  const runId = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  email = `brand-profile-save-${runId}@example.com`;
  password = randomBytes(24).toString("base64url");

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "品牌保存回归测试" },
  });
  if (created.error || !created.data.user) throw created.error || new Error("Could not create test user");
  userId = created.data.user.id;

  await mustInsert("profiles", {
    id: userId,
    display_name: "品牌保存回归测试",
    email,
    status: "active",
    invited_at: new Date().toISOString(),
  });
  const organization = await admin.from("organizations").insert({
    name: `brand-profile-save-${runId}`,
    status: "active",
    created_by: userId,
  }).select("id").single();
  if (organization.error || !organization.data) throw organization.error || new Error("Could not create test organization");
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
  const brand = await admin.from("brands").insert({
    organization_id: organizationId,
    name: "品牌保存回归测试",
    created_by: userId,
    updated_by: userId,
  }).select("id").single();
  if (brand.error || !brand.data) throw brand.error || new Error("Could not create test brand");
  brandId = brand.data.id;
  await mustInsert("user_preferences", {
    user_id: userId,
    organization_id: organizationId,
    active_brand_id: brandId,
  });
});

test.afterAll(async () => {
  if (organizationId) await admin.from("organizations").delete().eq("id", organizationId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

test("brand profile fields persist through the real workspace API", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("登录账号").fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workbench/);

  await page.goto("/brand/basic");
  await page.getByRole("button", { name: "编辑" }).click();
  await page.getByLabel("品牌简称").fill("回归品牌");
  await page.getByLabel("特性").fill("专业、透明、便捷");
  await page.getByLabel("品类名").fill("本地生活服务");
  await page.getByLabel("信任状").fill("十年服务经验");
  await page.getByLabel("定位语").fill("帮助本地商家获得可信推荐");

  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "PUT"
      && new URL(response.url()).pathname === "/api/workspace",
  );
  await page.getByRole("button", { name: "保存信息" }).click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(200);
  await expect(page.getByRole("button", { name: "编辑" })).toBeVisible();
  await expect(page.getByText("专业、透明、便捷", { exact: true })).toBeVisible();

  const saved = await admin.from("brands")
    .select("short_name,characteristics,category_name,trust_proof,positioning_statement")
    .eq("id", brandId)
    .single();
  if (saved.error) throw saved.error;
  expect(saved.data).toMatchObject({
    short_name: "回归品牌",
    characteristics: "专业、透明、便捷",
    category_name: "本地生活服务",
    trust_proof: "十年服务经验",
    positioning_statement: "帮助本地商家获得可信推荐",
  });
});

async function mustInsert(table: string, value: Record<string, unknown>) {
  const result = await admin.from(table).insert(value);
  if (result.error) throw result.error;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
