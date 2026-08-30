-- GEO Web P0 data foundation
-- This migration creates the formal multi-tenant data model without switching
-- the current demo runtime away from localStorage/JSON.

create extension if not exists pgcrypto;
create schema if not exists private;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  email text,
  phone text,
  status text not null default 'active'
    check (status in ('active', 'disabled')),
  invited_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active'
    check (status in ('active', 'disabled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member'
    check (role in ('owner', 'admin', 'member', 'viewer')),
  status text not null default 'active'
    check (status in ('active', 'disabled')),
  invited_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  industry text,
  website text,
  intro text,
  city text,
  service_area text,
  target_audience text,
  question_context_updated_at timestamptz,
  questions_generated_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  organization_id uuid not null,
  active_brand_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, user_id)
    references public.organization_members(organization_id, user_id) on delete cascade,
  foreign key (organization_id, active_brand_id)
    references public.brands(organization_id, id) on delete restrict
);

create table public.brand_stores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  name text not null,
  address text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, brand_id)
    references public.brands(organization_id, id) on delete cascade
);

create table public.brand_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  name text not null,
  type text,
  description text,
  price text,
  features text,
  audience text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, brand_id)
    references public.brands(organization_id, id) on delete cascade
);

create table public.brand_competitors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  name text not null,
  description text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, brand_id)
    references public.brands(organization_id, id) on delete cascade
);

create table public.brand_knowledge_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  file_name text not null,
  file_type text,
  object_path text not null,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  size_label text,
  status text not null default 'parsing'
    check (status in ('parsing', 'active', 'failed')),
  fact_count integer not null default 0 check (fact_count >= 0),
  error text,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, object_path),
  foreign key (organization_id, brand_id)
    references public.brands(organization_id, id) on delete cascade
);

create table public.detection_questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  text text not null check (length(btrim(text)) > 0),
  source text not null default 'generated'
    check (source in ('industry', 'generated', 'custom')),
  category text,
  enabled boolean not null default true,
  context_version integer not null default 1 check (context_version > 0),
  prompt_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, brand_id)
    references public.brands(organization_id, id) on delete cascade
);

create table public.detections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  name text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'partial', 'completed', 'failed')),
  stage text not null default 'queued'
    check (stage in ('queued', 'collecting', 'analyzing', 'completed', 'failed')),
  providers text[] not null default '{}',
  question_ids uuid[] not null default '{}',
  total_runs integer not null default 0 check (total_runs >= 0),
  completed_runs integer not null default 0 check (completed_runs >= 0),
  failed_runs integer not null default 0 check (failed_runs >= 0),
  source_detection_id uuid references public.detections(id) on delete set null,
  data_source text not null default 'live_api'
    check (data_source in ('mock', 'live_api')),
  collection_method text not null default 'model_api',
  analysis_model text,
  attempt integer not null default 1 check (attempt > 0),
  brand_snapshot jsonb not null default '{}'::jsonb,
  question_snapshots jsonb not null default '[]'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, brand_id)
    references public.brands(organization_id, id) on delete cascade,
  check (completed_runs + failed_runs <= total_runs)
);

create table public.detection_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  detection_id uuid not null,
  question_id uuid,
  provider text not null check (provider in ('doubao', 'deepseek', 'yuanbao')),
  question_snapshot text not null,
  sample_no integer not null default 1 check (sample_no = 1),
  answer text not null,
  model text,
  request_id text,
  data_source text not null default 'live_api'
    check (data_source in ('mock', 'live_api')),
  collection_method text not null default 'model_api',
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  total_tokens integer check (total_tokens is null or total_tokens >= 0),
  web_search_enabled boolean not null default false,
  search_queries text[] not null default '{}',
  web_search_unavailable_reason text,
  citations jsonb not null default '[]'::jsonb,
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (detection_id, provider, question_id, sample_no),
  foreign key (organization_id, brand_id)
    references public.brands(organization_id, id) on delete cascade,
  foreign key (organization_id, detection_id)
    references public.detections(organization_id, id) on delete cascade,
  foreign key (organization_id, question_id)
    references public.detection_questions(organization_id, id) on delete restrict
);

create table public.detection_run_errors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  detection_id uuid not null,
  provider text,
  question_id uuid,
  run_key text not null,
  message text not null,
  category text not null,
  retryable boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (detection_id, run_key),
  foreign key (organization_id, brand_id)
    references public.brands(organization_id, id) on delete cascade,
  foreign key (organization_id, detection_id)
    references public.detections(organization_id, id) on delete cascade,
  foreign key (organization_id, question_id)
    references public.detection_questions(organization_id, id) on delete restrict
);

create table public.detection_analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  detection_id uuid not null,
  result_id uuid not null,
  brand_mentioned boolean not null default false,
  mention_count integer not null default 0 check (mention_count >= 0),
  first_mention_index integer check (first_mention_index is null or first_mention_index >= 0),
  recommended boolean not null default false,
  recommendation_type text not null default 'not_mentioned'
    check (recommendation_type in ('top_pick', 'recommended', 'conditional', 'mentioned_only', 'discouraged', 'not_mentioned')),
  recommendation_position integer check (recommendation_position is null or recommendation_position > 0),
  rank integer check (rank is null or rank > 0),
  competitor_mentions text[] not null default '{}',
  sentiment_label text
    check (sentiment_label is null or sentiment_label in ('积极', '中性', '需改善')),
  sentiment_score numeric(5,2),
  accuracy_status text,
  accuracy_score numeric(5,2),
  conclusion text,
  evidences jsonb not null default '[]'::jsonb,
  fact_claims jsonb not null default '[]'::jsonb,
  ranked_brands jsonb not null default '[]'::jsonb,
  reputation_topics jsonb not null default '[]'::jsonb,
  analysis_model text not null,
  prompt_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (detection_id, result_id),
  foreign key (organization_id, brand_id)
    references public.brands(organization_id, id) on delete cascade,
  foreign key (organization_id, detection_id)
    references public.detections(organization_id, id) on delete cascade,
  foreign key (organization_id, result_id)
    references public.detection_results(organization_id, id) on delete cascade
);

create table public.detection_diagnoses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  detection_id uuid not null,
  version integer not null default 1 check (version > 0),
  is_current boolean not null default true,
  visibility_score numeric(5,2) check (visibility_score between 0 and 100),
  ranking_score numeric(5,2) check (ranking_score between 0 and 100),
  reputation_score numeric(5,2) check (reputation_score between 0 and 100),
  sentiment_score numeric(5,2) check (sentiment_score between 0 and 100),
  score_availability jsonb not null default '{}'::jsonb,
  summary text not null default '',
  analysis_model text not null,
  calculation_version text not null,
  prompt_version text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (detection_id, version),
  foreign key (organization_id, brand_id)
    references public.brands(organization_id, id) on delete cascade,
  foreign key (organization_id, detection_id)
    references public.detections(organization_id, id) on delete cascade
);

create unique index detection_diagnoses_one_current_idx
  on public.detection_diagnoses(detection_id)
  where is_current;

create table public.diagnosis_issues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  diagnosis_id uuid not null,
  dimension text not null check (dimension in ('visibility', 'ranking', 'reputation', 'sentiment')),
  severity text not null check (severity in ('high', 'medium', 'low')),
  title text not null,
  evidence text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, brand_id)
    references public.brands(organization_id, id) on delete cascade,
  foreign key (organization_id, diagnosis_id)
    references public.detection_diagnoses(organization_id, id) on delete cascade
);

create table public.optimization_suggestions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  detection_id uuid not null,
  diagnosis_id uuid not null,
  dimension text not null check (dimension in ('visibility', 'ranking', 'reputation', 'sentiment')),
  title text not null,
  description text not null,
  reason text not null,
  selected boolean not null default false,
  selected_at timestamptz,
  generated_by text not null default 'foundation_model',
  generation_model text not null,
  prompt_version text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, brand_id)
    references public.brands(organization_id, id) on delete cascade,
  foreign key (organization_id, detection_id)
    references public.detections(organization_id, id) on delete cascade,
  foreign key (organization_id, diagnosis_id)
    references public.detection_diagnoses(organization_id, id) on delete cascade
);

create table public.optimization_cycles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  detection_id uuid not null,
  suggestion_id uuid not null,
  dimension text not null check (dimension in ('visibility', 'ranking', 'reputation', 'sentiment')),
  target_snapshot text not null,
  description_snapshot text not null,
  reason_snapshot text not null,
  status text not null default 'active'
    check (status in ('active', 'completed', 'terminated')),
  current_day integer not null default 1 check (current_day between 1 and 7),
  start_date date not null,
  end_date date not null,
  terminated_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, brand_id)
    references public.brands(organization_id, id) on delete cascade,
  foreign key (organization_id, detection_id)
    references public.detections(organization_id, id) on delete restrict,
  foreign key (organization_id, suggestion_id)
    references public.optimization_suggestions(organization_id, id) on delete restrict,
  check (end_date = start_date + 6)
);

create unique index optimization_cycles_one_active_brand_idx
  on public.optimization_cycles(brand_id)
  where status = 'active';

create table public.optimization_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  cycle_id uuid not null,
  day integer not null check (day between 1 and 7),
  sort_order integer not null default 0,
  title text not null,
  description text not null,
  type text not null check (type in ('profile', 'content', 'review', 'publish', 'retest')),
  delivery text not null check (delivery in ('material', 'copy', 'wechat_draft', 'xiaohongshu_publish')),
  channel text check (channel is null or channel in ('wechat', 'xiaohongshu')),
  content_title text,
  required_fields text[] not null default '{}',
  material_route text,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'void')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (cycle_id, day, sort_order),
  foreign key (organization_id, brand_id)
    references public.brands(organization_id, id) on delete cascade,
  foreign key (organization_id, cycle_id)
    references public.optimization_cycles(organization_id, id) on delete cascade
);

create table public.contents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  cycle_id uuid not null,
  task_id uuid not null,
  title text not null,
  body text not null,
  selected_channel text not null check (selected_channel in ('wechat', 'xiaohongshu')),
  current_version integer not null default 1 check (current_version > 0),
  status text not null default 'draft'
    check (status in ('draft', 'checking', 'blocked', 'publishable', 'publishing', 'published', 'failed')),
  risk_status text not null default 'unchecked'
    check (risk_status in ('unchecked', 'blocked', 'warning', 'passed')),
  risk_issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, brand_id)
    references public.brands(organization_id, id) on delete cascade,
  foreign key (organization_id, cycle_id)
    references public.optimization_cycles(organization_id, id) on delete cascade,
  foreign key (organization_id, task_id)
    references public.optimization_tasks(organization_id, id) on delete cascade
);

create table public.content_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  content_id uuid not null,
  version integer not null check (version > 0),
  title text not null,
  body text not null,
  channels jsonb not null default '{}'::jsonb,
  generated_by text not null default 'foundation_model',
  generation_model text,
  prompt_version text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (content_id, version),
  foreign key (organization_id, brand_id)
    references public.brands(organization_id, id) on delete cascade,
  foreign key (organization_id, content_id)
    references public.contents(organization_id, id) on delete cascade
);

create table public.publishing_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null check (channel in ('wechat', 'xiaohongshu')),
  name text not null,
  account_name text not null,
  mode text not null default 'demo'
    check (mode in ('demo', 'real')),
  status text not null default 'unconfigured'
    check (status in ('unconfigured', 'configured', 'error')),
  app_id_masked text,
  draft_enabled boolean not null default false,
  connection_status text not null default 'disconnected'
    check (connection_status in ('connected', 'disconnected', 'error')),
  credentials_ciphertext text,
  verified_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, channel, account_name)
);

create table public.publish_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  cycle_id uuid not null,
  task_id uuid not null,
  content_id uuid not null,
  content_version integer not null,
  title_snapshot text not null,
  body_snapshot text not null,
  channel text not null check (channel in ('wechat', 'xiaohongshu')),
  publishing_account_id uuid,
  account_name_snapshot text not null,
  status text not null default 'publishing'
    check (status in ('publishing', 'published', 'draft_saved', 'failed')),
  error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, brand_id)
    references public.brands(organization_id, id) on delete cascade,
  foreign key (organization_id, cycle_id)
    references public.optimization_cycles(organization_id, id) on delete restrict,
  foreign key (organization_id, task_id)
    references public.optimization_tasks(organization_id, id) on delete restrict,
  foreign key (organization_id, content_id)
    references public.contents(organization_id, id) on delete restrict,
  foreign key (organization_id, publishing_account_id)
    references public.publishing_accounts(organization_id, id) on delete restrict
);

create table public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  brand_id uuid,
  type text not null,
  entity_type text not null,
  entity_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  attempt integer not null default 0 check (attempt >= 0),
  max_attempts integer not null default 2 check (max_attempts > 0),
  error text,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, brand_id)
    references public.brands(organization_id, id) on delete cascade
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

create index organization_members_user_idx on public.organization_members(user_id, status);
create index brands_org_idx on public.brands(organization_id, updated_at desc);
create index products_brand_idx on public.brand_products(brand_id, sort_order);
create index competitors_brand_idx on public.brand_competitors(brand_id, sort_order);
create index knowledge_brand_idx on public.brand_knowledge_files(brand_id, created_at desc);
create index questions_brand_idx on public.detection_questions(brand_id, updated_at desc);
create index detections_brand_idx on public.detections(brand_id, created_at desc);
create index detection_results_detection_idx on public.detection_results(detection_id, provider);
create index detection_analyses_detection_idx on public.detection_analyses(detection_id);
create index suggestions_detection_idx on public.optimization_suggestions(detection_id, sort_order);
create index cycles_brand_idx on public.optimization_cycles(brand_id, created_at desc);
create index tasks_cycle_day_idx on public.optimization_tasks(cycle_id, day, sort_order);
create index contents_brand_idx on public.contents(brand_id, updated_at desc);
create index publish_records_brand_idx on public.publish_records(brand_id, created_at desc);
create index background_jobs_ready_idx on public.background_jobs(status, available_at);
create index audit_logs_org_idx on public.audit_logs(organization_id, created_at desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'organizations', 'organization_members', 'brands', 'user_preferences',
    'brand_stores', 'brand_products', 'brand_competitors',
    'brand_knowledge_files', 'detection_questions', 'detections',
    'detection_analyses', 'optimization_cycles', 'optimization_tasks',
    'contents', 'publishing_accounts', 'publish_records', 'background_jobs'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      table_name || '_set_updated_at',
      table_name
    );
  end loop;
end;
$$;

comment on table public.organizations is 'Tenant boundary. One organization can own multiple brands.';
comment on table public.organization_members is 'Many-to-many relation between users and organizations with role and status.';
comment on table public.detection_results is 'Immutable raw provider response. P0 sampling count is fixed to one.';
comment on table public.detection_diagnoses is 'Versioned four-dimension diagnosis: visibility, ranking, reputation and sentiment.';
comment on table public.optimization_cycles is 'Selected target snapshot and its fixed seven-day execution cycle.';
