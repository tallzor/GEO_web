import "server-only";

import { createClient } from "@supabase/supabase-js";
import {
  requirePublicSupabaseConfig,
  requireSupabaseSecretKey,
} from "./env";
import { fetchWithTimeout } from "./fetch";

export function createSupabaseAdminClient() {
  const { url } = requirePublicSupabaseConfig();
  const secretKey = requireSupabaseSecretKey();

  return createClient(url, secretKey, {
    global: { fetch: fetchWithTimeout },
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
