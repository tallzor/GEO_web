import { expect, test } from "@playwright/test";
import {
  assertWorkspaceOwner,
  WorkspaceAccessError,
} from "../src/lib/auth/workspace-permissions";
import type { AccountContext } from "../src/lib/auth/types";

function account(role?: AccountContext["role"], organizationId = "org-1"): AccountContext {
  return {
    userId: "user-1",
    email: "owner@example.com",
    displayName: "测试用户",
    phone: "",
    organizationId,
    organizationName: "测试组织",
    role,
  };
}

test.describe("组织所有者权限", () => {
  test("owner 可以通过校验", () => {
    expect(assertWorkspaceOwner(account("owner"), "创建品牌").role).toBe("owner");
  });

  for (const role of ["admin", "member", "viewer"] as const) {
    test(`${role} 不能通过校验`, () => {
      expect(() => assertWorkspaceOwner(account(role), "创建品牌")).toThrow(
        "仅组织所有者可以创建品牌",
      );
    });
  }

  test("未分配组织时返回明确的 403 错误", () => {
    try {
      assertWorkspaceOwner(account("owner", ""));
      throw new Error("expected owner assertion to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceAccessError);
      expect((error as WorkspaceAccessError).status).toBe(403);
      expect((error as WorkspaceAccessError).message).toBe("账号尚未分配可用组织");
    }
  });
});
