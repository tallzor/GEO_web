import type { AccountContext } from "./types";

export type WorkspaceOwnerContext = AccountContext & {
  organizationId: string;
  role: "owner";
};

export class WorkspaceAccessError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "WorkspaceAccessError";
  }
}

export function assertWorkspaceOwner(
  account: AccountContext,
  action = "执行此操作",
): WorkspaceOwnerContext {
  if (!account.organizationId || !account.role) {
    throw new WorkspaceAccessError("账号尚未分配可用组织", 403);
  }
  if (account.role !== "owner") {
    throw new WorkspaceAccessError(`仅组织所有者可以${action}`, 403);
  }
  return account as WorkspaceOwnerContext;
}
