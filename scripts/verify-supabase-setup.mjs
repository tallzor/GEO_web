import { createClient } from "@supabase/supabase-js";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const supabase = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SECRET_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
);

const tables = [
  "profiles",
  "organizations",
  "organization_members",
  "user_preferences",
  "brands",
  "brand_stores",
  "brand_products",
  "brand_competitors",
  "brand_knowledge_files",
  "cognition_runs",
  "cognition_insights",
  "detection_questions",
  "detections",
  "detection_results",
  "detection_run_errors",
  "detection_analyses",
  "detection_diagnoses",
  "diagnosis_issues",
  "optimization_suggestions",
  "optimization_cycles",
  "optimization_tasks",
  "contents",
  "content_versions",
  "publishing_accounts",
  "publish_batches",
  "publish_records",
  "background_jobs",
  "audit_logs",
];

for (const table of tables) {
  const { error } = await supabase.from(table).select("*").limit(1);
  if (error) throw new Error(`Table ${table} is unavailable: ${error.message}`);
}

const requiredBrandFields = [
  "short_name",
  "characteristics",
  "category_name",
  "trust_proof",
  "positioning_statement",
];
const { error: brandFieldsError } = await supabase
  .from("brands")
  .select(["id", ...requiredBrandFields].join(","))
  .limit(1);
if (brandFieldsError) {
  throw new Error(`Brand profile fields are unavailable: ${brandFieldsError.message}`);
}

const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
if (bucketError) throw new Error(`Storage verification failed: ${bucketError.message}`);
const knowledgeBucket = buckets.find((bucket) => bucket.id === "brand-knowledge");
if (!knowledgeBucket) throw new Error("Storage bucket brand-knowledge is missing");
if (knowledgeBucket.public) throw new Error("Storage bucket brand-knowledge must be private");
const publishingBucket = buckets.find((bucket) => bucket.id === "publishing-assets");
if (!publishingBucket) throw new Error("Storage bucket publishing-assets is missing");
if (publishingBucket.public) throw new Error("Storage bucket publishing-assets must be private");

console.log(`Verified ${tables.length} database tables.`);
console.log(`Verified ${requiredBrandFields.length} brand profile fields.`);
console.log("Verified private Storage bucket: brand-knowledge.");
console.log("Verified private Storage bucket: publishing-assets.");
console.log("Supabase data foundation is ready.");
