import { NextResponse } from "next/server";
import { z } from "zod";
import { BrandLifecycleError, softDeleteBrand } from "@/lib/server/brand-lifecycle";
import { isSupabaseDataBackendEnabled } from "@/lib/supabase/env";
import { requireWorkspaceOwner, WorkspaceAccessError } from "@/lib/server/workspace-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({ brandName: z.string().min(1) });

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseDataBackendEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const account = await requireWorkspaceOwner({ action: "删除品牌" });
    const { id } = await params;
    const body = requestSchema.parse(await request.json());
    const result = await softDeleteBrand(account, z.uuid().parse(id), body.brandName);
    return NextResponse.json({ ok: true, activeBrandId: result.activeBrandId });
  } catch (error) {
    if (error instanceof WorkspaceAccessError || error instanceof BrandLifecycleError) {
      return NextResponse.json(
        { error: error.message, code: error instanceof BrandLifecycleError ? error.code : "FORBIDDEN" },
        { status: error.status },
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "品牌信息不正确" }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "品牌删除失败" },
      { status: 500 },
    );
  }
}
