import "server-only";

import { getCurrentAccountContext } from "@/lib/auth/context";
import {
  assertWorkspaceOwner,
  WorkspaceAccessError,
} from "@/lib/auth/workspace-permissions";

export { WorkspaceAccessError } from "@/lib/auth/workspace-permissions";

export async function requireWorkspaceAccount(options?: { write?: boolean }) {
  const account = await getCurrentAccountContext();
  if (!account) throw new WorkspaceAccessError("登录状态已失效，请重新登录", 401);
  if (!account.organizationId || !account.role) {
    throw new WorkspaceAccessError("账号尚未分配可用组织", 403);
  }
  if (options?.write && account.role === "viewer") {
    throw new WorkspaceAccessError("当前账号只有查看权限", 403);
  }
  return account;
}

export async function requireWorkspaceOwner(options?: { action?: string }) {
  const account = await requireWorkspaceAccount({ write: true });
  return assertWorkspaceOwner(account, options?.action);
}
