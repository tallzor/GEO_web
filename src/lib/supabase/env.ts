export type PublicSupabaseConfig = {
  url: string;
  publishableKey: string;
};

function missingVariable(name: string) {
  return new Error(`Missing required environment variable: ${name}`);
}

export function getPublicSupabaseConfig(): PublicSupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) {
    return null;
  }

  return { url, publishableKey };
}

export function requirePublicSupabaseConfig(): PublicSupabaseConfig {
  const config = getPublicSupabaseConfig();

  if (!config) {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) {
      throw missingVariable("NEXT_PUBLIC_SUPABASE_URL");
    }
    throw missingVariable("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }

  return config;
}

export function requireSupabaseSecretKey() {
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();

  if (!secretKey) {
    throw missingVariable("SUPABASE_SECRET_KEY");
  }

  return secretKey;
}

export function isSupabaseDataBackendEnabled() {
  return process.env.GEO_DATA_BACKEND?.trim().toLowerCase() === "supabase";
}

export function isSupabaseAuthEnabled() {
  return process.env.GEO_AUTH_MODE?.trim().toLowerCase() === "supabase";
}
