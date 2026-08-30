"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePublicSupabaseConfig } from "./env";
import { fetchWithTimeout } from "./fetch";

let browserClient: SupabaseClient | undefined;

export function createSupabaseBrowserClient() {
  if (browserClient) {
    return browserClient;
  }

  const { url, publishableKey } = requirePublicSupabaseConfig();
  browserClient = createBrowserClient(url, publishableKey, {
    global: { fetch: fetchWithTimeout },
  });
  return browserClient;
}
