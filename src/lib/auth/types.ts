export type AccountContext = {
  userId: string;
  email: string;
  displayName: string;
  phone: string;
  organizationId?: string;
  organizationName?: string;
  role?: "owner" | "admin" | "member" | "viewer";
};

// 已停用：旧服务端 signInAction 的返回类型，当前登录由浏览器端 Supabase Auth 直接处理。
// export type SignInResult =
//   | { ok: true; mode: "demo" | "supabase" }
//   | { ok: false; message: string };

export type SimpleActionResult =
  | { ok: true }
  | { ok: false; message: string };
