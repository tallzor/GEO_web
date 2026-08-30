import { isSupabaseAuthEnabled } from "@/lib/supabase/env";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginForm supabaseEnabled={isSupabaseAuthEnabled()} />;
}
