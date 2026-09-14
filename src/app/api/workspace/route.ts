import { NextResponse } from "next/server";
import { isSupabaseDataBackendEnabled } from "@/lib/supabase/env";
import { loadWorkspaceSnapshot } from "@/lib/server/workspace-read-repository";
import { saveWorkspaceSnapshot, WorkspaceConflictError } from "@/lib/server/workspace-write-repository";
import { requireWorkspaceAccount, WorkspaceAccessError } from "@/lib/server/workspace-access";
import { workspaceSaveScopes, type WorkspaceSaveRequest, type WorkspaceSaveScope } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isSupabaseDataBackendEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const account = await requireWorkspaceAccount();
    const snapshot = await loadWorkspaceSnapshot(account);
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return workspaceError(error);
  }
}

export async function PUT(request: Request) {
  if (!isSupabaseDataBackendEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 10_000_000) return NextResponse.json({ error: "工作空间数据过大" }, { status: 413 });
  try {
    const account = await requireWorkspaceAccount({ write: true });
    const body = await request.json() as unknown;
    if (!isSaveRequest(body)) throw new Error("工作空间保存请求格式不正确");
    const scopes = normalizeScopes(body.scopes);
    const result = await saveWorkspaceSnapshot(
      account,
      body.snapshot,
      scopes,
      body.expectedRevision,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return workspaceError(error);
  }
}

const allowedScopes = new Set<WorkspaceSaveScope>(workspaceSaveScopes);

function isSaveRequest(value: unknown): value is WorkspaceSaveRequest {
  return Boolean(
    value
    && typeof value === "object"
    && "snapshot" in value
    && value.snapshot
    && typeof value.snapshot === "object"
    && "scopes" in value
    && Array.isArray(value.scopes)
    && "expectedRevision" in value
    && typeof value.expectedRevision === "string",
  );
}

function normalizeScopes(scopes: unknown): WorkspaceSaveScope[] {
  if (!Array.isArray(scopes)) throw new Error("工作空间保存范围不正确");
  const normalized = scopes.filter((scope): scope is WorkspaceSaveScope => typeof scope === "string" && allowedScopes.has(scope as WorkspaceSaveScope));
  if (normalized.length !== scopes.length || !normalized.length) throw new Error("工作空间保存范围不正确");
  return [...new Set(normalized)];
}

function workspaceError(error: unknown) {
  if (error instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof WorkspaceConflictError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "工作空间操作失败" },
    { status: 500 },
  );
}
