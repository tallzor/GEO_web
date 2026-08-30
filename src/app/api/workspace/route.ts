import { NextResponse } from "next/server";
import { isSupabaseDataBackendEnabled } from "@/lib/supabase/env";
import { loadWorkspaceSnapshot, saveWorkspaceSnapshot } from "@/lib/server/workspace-repository";
import { requireWorkspaceAccount, WorkspaceAccessError } from "@/lib/server/workspace-access";
import type { WorkspaceSaveRequest, WorkspaceSaveScope, WorkspaceSnapshot } from "@/lib/workspace";

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
    const body = await request.json() as WorkspaceSnapshot | WorkspaceSaveRequest;
    const wrapped = isSaveRequest(body);
    const snapshot = wrapped ? body.snapshot : body;
    const scopes = wrapped ? normalizeScopes(body.scopes) : undefined;
    await saveWorkspaceSnapshot(account, snapshot, scopes);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return workspaceError(error);
  }
}

const allowedScopes = new Set<WorkspaceSaveScope>([
  "user", "brands", "currentBrand", "cycles", "contents", "publishRecords", "platforms",
]);

function isSaveRequest(value: WorkspaceSnapshot | WorkspaceSaveRequest): value is WorkspaceSaveRequest {
  return Boolean(value && typeof value === "object" && "snapshot" in value && "scopes" in value);
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
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "工作空间操作失败" },
    { status: 500 },
  );
}
