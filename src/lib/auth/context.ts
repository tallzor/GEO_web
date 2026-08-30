import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseAuthEnabled } from "@/lib/supabase/env";
import type { AccountContext } from "./types";

type ProfileRow = {
  display_name: string;
  email: string | null;
  phone: string | null;
  status: "active" | "disabled";
};

type PreferenceRow = {
  organization_id: string;
};

type MembershipRow = {
  organization_id: string;
  role: AccountContext["role"];
};

export async function getCurrentAccountContext(): Promise<AccountContext | null> {
  if (!isSupabaseAuthEnabled()) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims?.sub) {
    return null;
  }

  const userId = claims.sub;
  const claimEmail = typeof claims.email === "string" ? claims.email : "";
  const metadata = claims.user_metadata && typeof claims.user_metadata === "object"
    ? claims.user_metadata as Record<string, unknown>
    : {};

  const [{ data: profileData }, { data: preferenceData }, { data: membershipsData }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("display_name,email,phone,status")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("user_preferences")
        .select("organization_id")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("organization_members")
        .select("organization_id,role")
        .eq("user_id", userId)
        .eq("status", "active"),
    ]);

  const profile = profileData as ProfileRow | null;
  if (profile?.status === "disabled") {
    return null;
  }

  const preference = preferenceData as PreferenceRow | null;
  const memberships = (membershipsData || []) as MembershipRow[];
  const membership = memberships.find(
    (item) => item.organization_id === preference?.organization_id,
  ) || memberships[0];

  let organizationName: string | undefined;
  if (membership?.organization_id) {
    const { data: organizationData } = await supabase
      .from("organizations")
      .select("name,status")
      .eq("id", membership.organization_id)
      .maybeSingle();
    const organization = organizationData as { name: string; status: string } | null;
    if (organization?.status === "active") {
      organizationName = organization.name;
    }
  }

  const metadataName = typeof metadata.display_name === "string"
    ? metadata.display_name
    : "";

  return {
    userId,
    email: profile?.email || claimEmail,
    displayName: profile?.display_name || metadataName || claimEmail,
    phone: profile?.phone || "",
    organizationId: organizationName ? membership?.organization_id : undefined,
    organizationName,
    role: organizationName ? membership?.role : undefined,
  };
}
