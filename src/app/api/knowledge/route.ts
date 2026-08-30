import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseDataBackendEnabled } from "@/lib/supabase/env";
import { requireWorkspaceAccount, WorkspaceAccessError } from "@/lib/server/workspace-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedExtensions = new Set(["pdf", "docx", "txt"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  if (!isSupabaseDataBackendEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const account = await requireWorkspaceAccount({ write: true });
    const form = await request.formData();
    const brandId = String(form.get("brandId") || "");
    const attachmentId = String(form.get("attachmentId") || "");
    const file = form.get("file");
    if (!account.organizationId || !uuidPattern.test(brandId) || !uuidPattern.test(attachmentId)) {
      return NextResponse.json({ error: "附件归属信息不正确" }, { status: 400 });
    }
    if (!(file instanceof File)) return NextResponse.json({ error: "请选择上传文件" }, { status: 400 });
    if (file.size <= 0 || file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "文件大小必须在20MB以内" }, { status: 400 });
    }
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (!allowedExtensions.has(extension)) {
      return NextResponse.json({ error: "仅支持PDF、DOCX、TXT文件" }, { status: 400 });
    }

    const supabase = createSupabaseAdminClient();
    const { data: brand, error: brandError } = await supabase.from("brands").select("id")
      .eq("organization_id", account.organizationId).eq("id", brandId).is("deleted_at", null).maybeSingle();
    if (brandError) throw new Error(brandError.message);
    if (!brand) throw new WorkspaceAccessError("品牌不属于当前组织", 403);

    const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(-160) || `attachment.${extension}`;
    const objectPath = `${account.organizationId}/${brandId}/${attachmentId}/${safeName}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const uploaded = await supabase.storage.from("brand-knowledge").upload(objectPath, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (uploaded.error) throw new Error(uploaded.error.message);

    const inserted = await supabase.from("brand_knowledge_files").upsert({
      id: attachmentId,
      organization_id: account.organizationId,
      brand_id: brandId,
      file_name: file.name,
      file_type: extension.toUpperCase(),
      object_path: objectPath,
      size_bytes: file.size,
      size_label: formatSize(file.size),
      // P0 only stores the private source file; no extraction worker is enabled yet.
      status: "active",
      fact_count: 0,
      uploaded_by: account.userId,
    }, { onConflict: "id" });
    if (inserted.error) {
      await supabase.storage.from("brand-knowledge").remove([objectPath]);
      throw new Error(inserted.error.message);
    }
    return NextResponse.json({ ok: true, objectPath });
  } catch (error) {
    return apiError(error, "附件上传失败");
  }
}

export async function DELETE(request: Request) {
  if (!isSupabaseDataBackendEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const account = await requireWorkspaceAccount({ write: true });
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!account.organizationId || !uuidPattern.test(id)) {
      return NextResponse.json({ error: "附件ID不正确" }, { status: 400 });
    }
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.from("brand_knowledge_files").select("object_path")
      .eq("organization_id", account.organizationId).eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "附件不存在" }, { status: 404 });
    const objectPath = typeof data.object_path === "string" ? data.object_path : "";
    if (objectPath) {
      const removed = await supabase.storage.from("brand-knowledge").remove([objectPath]);
      if (removed.error) throw new Error(removed.error.message);
    }
    const deleted = await supabase.from("brand_knowledge_files").delete()
      .eq("organization_id", account.organizationId).eq("id", id);
    if (deleted.error) throw new Error(deleted.error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "附件删除失败");
  }
}

function apiError(error: unknown, fallback: string) {
  const status = error instanceof WorkspaceAccessError ? error.status : 500;
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status });
}

function formatSize(size: number) {
  return `${Math.max(0.1, size / 1024 / 1024).toFixed(1)} MB`;
}
