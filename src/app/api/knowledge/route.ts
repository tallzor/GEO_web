import { NextResponse } from "next/server";
import { deleteBrandKnowledgeFile, uploadBrandKnowledgeFile } from "@/lib/server/brand-repository";
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

    const bytes = new Uint8Array(await file.arrayBuffer());
    const { objectPath } = await uploadBrandKnowledgeFile(account, {
      brandId,
      attachmentId,
      fileName: file.name,
      extension,
      contentType: file.type,
      size: file.size,
      sizeLabel: formatSize(file.size),
      bytes,
    });
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
    await deleteBrandKnowledgeFile(account, id);
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
