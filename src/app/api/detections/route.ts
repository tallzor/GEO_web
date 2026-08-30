import { NextResponse } from "next/server";
import { z } from "zod";
import { isProviderReady } from "@/lib/server/detection-task-runner";
import {
  createDetectionTask,
  listDetectionTasks,
  makeServerDetectionTask,
  publicDetectionTask,
} from "@/lib/server/detection-task-store";
import { requireWorkspaceAccount, WorkspaceAccessError } from "@/lib/server/workspace-access";
import { isSupabaseDataBackendEnabled } from "@/lib/supabase/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const optionalLegacyText = (maxLength: number) =>
  z.string().max(maxLength).optional().default("");

const requestSchema = z.object({
  id: z.string().trim().min(1).max(120),
  sourceDetectionId: z.string().trim().min(1).max(120).optional(),
  providers: z.array(z.enum(["doubao", "deepseek", "yuanbao"])).min(1).max(3)
    .refine((items) => new Set(items).size === items.length, "AI平台不能重复"),
  brand: z.object({
    id: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1, "请先填写品牌名称").max(100),
    shortName: optionalLegacyText(100),
    characteristics: optionalLegacyText(500),
    categoryName: optionalLegacyText(100),
    trustProof: optionalLegacyText(500),
    positioningStatement: optionalLegacyText(300),
    industry: optionalLegacyText(100),
    intro: optionalLegacyText(3_000),
    serviceArea: optionalLegacyText(500),
    targetAudience: optionalLegacyText(1_000),
    products: z.array(z.object({
      id: z.string().max(120),
      name: z.string().max(100),
      type: optionalLegacyText(100),
      description: optionalLegacyText(1_000),
      price: optionalLegacyText(300),
      features: optionalLegacyText(1_000),
      audience: optionalLegacyText(1_000),
      updatedAt: optionalLegacyText(100),
    })).max(50).optional().default([]),
    competitors: z.array(z.object({
      id: z.string().max(120),
      name: z.string().trim().min(1).max(100),
      description: optionalLegacyText(1_000),
    })).max(50).optional().default([]),
  }),
  questions: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    text: z.string().trim().min(2, "检测问题不能为空").max(500),
  })).min(1, "请至少选择1个检测问题").max(10, "最多选择10个检测问题")
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "检测问题不能重复")
    .refine((items) => new Set(items.map((item) => item.text)).size === items.length, "存在重复的检测问题"),
});

export async function GET(request: Request) {
  try {
    const account = isSupabaseDataBackendEnabled() ? await requireWorkspaceAccount() : null;
    const brandId = new URL(request.url).searchParams.get("brandId")?.trim();
    if (!brandId) return NextResponse.json({ error: "缺少品牌ID" }, { status: 400 });
    const tasks = await listDetectionTasks(brandId, account?.organizationId);
    return NextResponse.json(
      { detections: tasks.map(publicDetectionTask) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return detectionError(error);
  }
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 256_000) return NextResponse.json({ error: "请求内容过大" }, { status: 413 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.length ? issue.path.join(".") : "";
    const message = issue?.message && issue.message !== "Invalid input: expected string, received undefined"
      ? issue.message
      : "字段格式不正确";
    return NextResponse.json(
      { error: field ? `检测参数 ${field}：${message}` : message || "请求参数不正确" },
      { status: 400 },
    );
  }
  for (const provider of parsed.data.providers) {
    const readiness = isProviderReady(provider);
    if (!readiness.ready) {
      return NextResponse.json(
        { error: readiness.message, provider, category: "configuration", retryable: false },
        { status: 503 },
      );
    }
  }

  try {
    const account = isSupabaseDataBackendEnabled()
      ? await requireWorkspaceAccount({ write: true })
      : null;
    if (account?.organizationId) {
      await validateDetectionOwnership(
        account.organizationId,
        parsed.data.brand.id,
        parsed.data.questions.map((item) => item.id),
      );
    }
    const task = await createDetectionTask(makeServerDetectionTask({
      ...parsed.data,
      organizationId: account?.organizationId,
      createdBy: account?.userId,
    }));
    return NextResponse.json(
      { detection: publicDetectionTask(task) },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return detectionError(error);
  }
}

async function validateDetectionOwnership(organizationId: string, brandId: string, questionIds: string[]) {
  const supabase = createSupabaseAdminClient();
  const [{ data: brand, error: brandError }, { data: questions, error: questionError }] = await Promise.all([
    supabase.from("brands").select("id").eq("organization_id", organizationId).eq("id", brandId).is("deleted_at", null).maybeSingle(),
    supabase.from("detection_questions").select("id").eq("organization_id", organizationId).eq("brand_id", brandId).in("id", questionIds),
  ]);
  if (brandError || questionError) {
    throw new Error(brandError?.message || questionError?.message || "检测数据校验失败");
  }
  if (!brand) throw new WorkspaceAccessError("品牌不属于当前组织", 403);
  if ((questions || []).length !== questionIds.length) {
    throw new WorkspaceAccessError("检测问题不属于当前品牌", 403);
  }
}

function detectionError(error: unknown) {
  if (error instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "检测任务操作失败" },
    { status: 500 },
  );
}
