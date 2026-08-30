"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AccountContext } from "@/lib/auth/types";

const AuthContext = createContext<AccountContext | null>(null);

export function AccountContextProvider({
  account,
  children,
}: {
  account: AccountContext | null;
  children: ReactNode;
}) {
  return <AuthContext.Provider value={account}>{children}</AuthContext.Provider>;
}

export function useAccountContext() {
  return useContext(AuthContext);
}
