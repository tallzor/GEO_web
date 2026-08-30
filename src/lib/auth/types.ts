export type AccountContext = {
  userId: string;
  email: string;
  displayName: string;
  phone: string;
  organizationId?: string;
  organizationName?: string;
  role?: "owner" | "admin" | "member" | "viewer";
};

export type SignInResult =
  | { ok: true; mode: "demo" | "supabase" }
  | { ok: false; message: string };

export type SimpleActionResult =
  | { ok: true }
  | { ok: false; message: string };
