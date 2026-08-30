import { createClient } from "@supabase/supabase-js";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const url = required("NEXT_PUBLIC_SUPABASE_URL");
const secretKey = required("SUPABASE_SECRET_KEY");
const email = required("INVITE_EMAIL").toLowerCase();
const password = required("INVITE_INITIAL_PASSWORD");
const displayName = required("INVITE_DISPLAY_NAME");
const existingOrganizationId = process.env.INVITE_ORGANIZATION_ID?.trim();
const organizationName = process.env.INVITE_ORGANIZATION_NAME?.trim();
const requestedRole = process.env.INVITE_ROLE?.trim();
const allowedRoles = new Set(["owner", "admin", "member", "viewer"]);

if (password.length < 8) {
  throw new Error("INVITE_INITIAL_PASSWORD must contain at least 8 characters");
}
if (!existingOrganizationId && !organizationName) {
  throw new Error("Set INVITE_ORGANIZATION_NAME when creating a new organization");
}

const role = requestedRole || (existingOrganizationId ? "member" : "owner");
if (!allowedRoles.has(role)) {
  throw new Error("INVITE_ROLE must be owner, admin, member or viewer");
}

const supabase = createClient(url, secretKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

let userId;
let organizationId = existingOrganizationId;
let createdOrganization = false;

try {
  const { data: userData, error: userError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (userError || !userData.user) throw userError || new Error("Failed to create auth user");
  userId = userData.user.id;

  const { error: profileError } = await supabase.from("profiles").insert({
    id: userId,
    display_name: displayName,
    email,
    status: "active",
    invited_at: new Date().toISOString(),
  });
  if (profileError) throw profileError;

  if (!organizationId) {
    const { data: organization, error: organizationError } = await supabase
      .from("organizations")
      .insert({ name: organizationName, status: "active", created_by: userId })
      .select("id")
      .single();
    if (organizationError || !organization) {
      throw organizationError || new Error("Failed to create organization");
    }
    organizationId = organization.id;
    createdOrganization = true;
  } else {
    const { data: organization, error: organizationError } = await supabase
      .from("organizations")
      .select("id,status")
      .eq("id", organizationId)
      .maybeSingle();
    if (organizationError || organization?.status !== "active") {
      throw organizationError || new Error("Target organization is unavailable");
    }
  }

  const now = new Date().toISOString();
  const { error: membershipError } = await supabase.from("organization_members").insert({
    organization_id: organizationId,
    user_id: userId,
    role,
    status: "active",
    invited_at: now,
    activated_at: now,
  });
  if (membershipError) throw membershipError;

  const { error: preferenceError } = await supabase.from("user_preferences").insert({
    user_id: userId,
    organization_id: organizationId,
  });
  if (preferenceError) throw preferenceError;

  const { error: metadataError } = await supabase.auth.admin.updateUserById(userId, {
    app_metadata: {
      organization_id: organizationId,
      organization_role: role,
      access_status: "active",
    },
  });
  if (metadataError) throw metadataError;

  console.log("Internal user provisioned successfully.");
  console.log(`User ID: ${userId}`);
  console.log(`Organization ID: ${organizationId}`);
  console.log(`Role: ${role}`);
} catch (error) {
  if (createdOrganization && organizationId) {
    await supabase.from("organizations").delete().eq("id", organizationId);
  }
  if (userId) {
    await supabase.auth.admin.deleteUser(userId);
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Provisioning failed: ${message}`);
  process.exitCode = 1;
}
