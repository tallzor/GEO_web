import { createClient } from "@supabase/supabase-js";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const url = required("NEXT_PUBLIC_SUPABASE_URL");
const publishableKey = required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

function client() {
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function signIn(emailName, passwordName) {
  const supabase = client();
  const { error } = await supabase.auth.signInWithPassword({
    email: required(emailName),
    password: required(passwordName),
  });
  if (error) throw new Error(`${emailName} sign-in failed: ${error.message}`);
  const { data, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("status", "active")
    .limit(1)
    .single();
  if (membershipError || !data) {
    throw new Error(`${emailName} has no active organization membership`);
  }
  return { supabase, organizationId: data.organization_id };
}

const accountA = await signIn("TEST_ORG_A_EMAIL", "TEST_ORG_A_PASSWORD");
const accountB = await signIn("TEST_ORG_B_EMAIL", "TEST_ORG_B_PASSWORD");
if (accountA.organizationId === accountB.organizationId) {
  throw new Error("Isolation test accounts must belong to different organizations");
}

const crossRead = await accountA.supabase.from("brands").select("id")
  .eq("organization_id", accountB.organizationId);
if (crossRead.error) throw new Error(`Cross-organization read check failed: ${crossRead.error.message}`);
if ((crossRead.data || []).length) throw new Error("RLS isolation failed: organization A can read organization B brands");

const crossWrite = await accountA.supabase.from("brands").insert({
  organization_id: accountB.organizationId,
  name: "RLS isolation probe",
});
if (!crossWrite.error) throw new Error("RLS isolation failed: organization A can write organization B brands");

const { data: accountBBrand, error: accountBBrandError } = await accountB.supabase
  .from("brands")
  .select("id")
  .eq("organization_id", accountB.organizationId)
  .limit(1)
  .maybeSingle();
if (accountBBrandError) throw new Error(`Organization B brand lookup failed: ${accountBBrandError.message}`);

for (const table of [
  "detections",
  "detection_results",
  "detection_run_errors",
  "detection_analyses",
  "detection_diagnoses",
  "diagnosis_issues",
  "optimization_suggestions",
]) {
  const { data, error } = await accountA.supabase
    .from(table)
    .select("id")
    .eq("organization_id", accountB.organizationId)
    .limit(1);
  if (error) throw new Error(`${table} cross-organization read check failed: ${error.message}`);
  if ((data || []).length) throw new Error(`RLS isolation failed: organization A can read organization B ${table}`);
}

if (accountBBrand) {
  const forbiddenDetectionWrite = await accountA.supabase.from("detections").insert({
    organization_id: accountB.organizationId,
    brand_id: accountBBrand.id,
    name: "RLS detection isolation probe",
  });
  if (!forbiddenDetectionWrite.error) {
    throw new Error("RLS isolation failed: organization A can create organization B detections");
  }
}

await Promise.all([
  accountA.supabase.auth.signOut({ scope: "local" }),
  accountB.supabase.auth.signOut({ scope: "local" }),
]);
console.log("Cross-organization read isolation passed.");
console.log("Cross-organization write isolation passed.");
console.log("Detection data isolation passed.");
