import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentAccountContext } from "@/lib/auth/context";
import { isSupabaseAuthEnabled, isSupabaseDataBackendEnabled } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export default async function ProductLayout({ children }: { children: React.ReactNode }) {
  const supabaseEnabled = isSupabaseAuthEnabled();
  const dataBackendEnabled = isSupabaseDataBackendEnabled();
  const account = supabaseEnabled ? await getCurrentAccountContext() : null;

  if (supabaseEnabled && !account) {
    redirect("/login");
  }

  return <AppShell account={account} supabaseEnabled={supabaseEnabled} dataBackendEnabled={dataBackendEnabled}>{children}</AppShell>;
}
