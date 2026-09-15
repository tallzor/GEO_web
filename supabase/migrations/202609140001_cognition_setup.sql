-- v0.3.0 brand/product cognition setup.

alter table public.brands
  add column if not exists industry_code text,
  add column if not exists industry_path text,
  add column if not exists industry_standard text,
  add column if not exists core_scenarios text,
  add column if not exists value_promise text,
  add column if not exists cognition_boundary text,
  add column if not exists other_info text;

alter table public.brand_products
  add column if not exists scenarios text,
  add column if not exists advantages text,
  add column if not exists problems_solved text,
  add column if not exists quantitative_facts text,
  add column if not exists evidence text,
  add column if not exists limitations text,
  add column if not exists other_info text;

alter table public.brand_knowledge_files
  add column if not exists product_id uuid,
  add column if not exists uploaded_by_name text;

update public.brand_knowledge_files
set status = case status
  when 'active' then 'uploaded'
  when 'parsing' then 'uploading'
  else status
end;

alter table public.brand_knowledge_files
  drop constraint if exists brand_knowledge_files_status_check;

alter table public.brand_knowledge_files
  add constraint brand_knowledge_files_status_check
  check (status in ('uploading', 'uploaded', 'failed'));

alter table public.brand_knowledge_files
  alter column status set default 'uploading';

alter table public.brand_knowledge_files
  add constraint brand_knowledge_files_product_fkey
  foreign key (organization_id, product_id)
  references public.brand_products(organization_id, id) on delete set null (product_id);

create table public.cognition_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  idempotency_key text not null,
  input_hash text not null,
  input_snapshot jsonb not null,
  status text not null default 'queued'
    check (status in ('queued', 'analyzing', 'review_required', 'confirmed', 'failed')),
  attempt integer not null default 0 check (attempt >= 0),
  error text,
  brand_prompt_version text not null,
  product_prompt_version text not null,
  created_by uuid references auth.users(id) on delete set null,
  confirmed_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, brand_id)
    references public.brands(organization_id, id) on delete cascade
);

create table public.cognition_insights (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  run_id uuid not null,
  subject_type text not null check (subject_type in ('brand', 'product')),
  subject_id uuid not null,
  subject_name text not null,
  model_type text not null check (model_type in ('brand_six_elements', 'bfabeww')),
  payload jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'confirmed')),
  version integer not null default 0 check (version >= 0),
  is_current boolean not null default false,
  provider text not null,
  model text not null,
  prompt_version text not null,
  web_search_used boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (run_id, subject_type, subject_id),
  foreign key (organization_id, brand_id)
    references public.brands(organization_id, id) on delete cascade,
  foreign key (organization_id, run_id)
    references public.cognition_runs(organization_id, id) on delete cascade
);

create index cognition_runs_brand_idx
  on public.cognition_runs(brand_id, created_at desc);
create index cognition_runs_status_idx
  on public.cognition_runs(status, updated_at);
create index cognition_insights_run_idx
  on public.cognition_insights(run_id, subject_type, subject_name);
create unique index cognition_insights_current_subject_idx
  on public.cognition_insights(organization_id, brand_id, subject_type, subject_id)
  where is_current;
create unique index background_jobs_active_cognition_idx
  on public.background_jobs(organization_id, entity_id)
  where type = 'cognition_setup' and status in ('pending', 'running');

create trigger cognition_runs_set_updated_at
  before update on public.cognition_runs
  for each row execute function public.set_updated_at();
create trigger cognition_insights_set_updated_at
  before update on public.cognition_insights
  for each row execute function public.set_updated_at();

alter table public.cognition_runs enable row level security;
alter table public.cognition_runs force row level security;
alter table public.cognition_insights enable row level security;
alter table public.cognition_insights force row level security;

create policy cognition_runs_select_member
  on public.cognition_runs for select to authenticated
  using (private.is_org_member(organization_id));
create policy cognition_insights_select_member
  on public.cognition_insights for select to authenticated
  using (private.is_org_member(organization_id));

grant select on public.cognition_runs, public.cognition_insights to authenticated;
grant all privileges on public.cognition_runs, public.cognition_insights to service_role;

create or replace function public.confirm_cognition_run(
  target_organization_id uuid,
  target_run_id uuid,
  actor_id uuid,
  revised_payloads jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_status text;
  insight_row record;
  revision jsonb;
  next_version integer;
begin
  select status into run_status
  from public.cognition_runs
  where organization_id = target_organization_id and id = target_run_id
  for update;

  if run_status is null then
    raise exception '认知分析批次不存在';
  end if;
  if run_status = 'confirmed' then
    return;
  end if;
  if run_status <> 'review_required' then
    raise exception '当前认知分析批次不能确认';
  end if;

  if jsonb_typeof(revised_payloads) <> 'array' then
    raise exception '洞察修订格式不正确';
  end if;
  if jsonb_array_length(revised_payloads) <> (
    select count(*) from public.cognition_insights
    where organization_id = target_organization_id and run_id = target_run_id
  ) then
    raise exception '必须一次确认本批次的全部洞察';
  end if;

  for insight_row in
    select * from public.cognition_insights
    where organization_id = target_organization_id and run_id = target_run_id
    for update
  loop
    select item.value into revision
    from jsonb_array_elements(revised_payloads) as item(value)
    where item.value->>'id' = insight_row.id::text;
    if revision is null or jsonb_typeof(revision->'payload') <> 'array' then
      raise exception '洞察修订不完整';
    end if;

    select coalesce(max(version), 0) + 1 into next_version
    from public.cognition_insights
    where organization_id = target_organization_id
      and brand_id = insight_row.brand_id
      and subject_type = insight_row.subject_type
      and subject_id = insight_row.subject_id
      and status = 'confirmed';

    update public.cognition_insights
    set is_current = false
    where organization_id = target_organization_id
      and brand_id = insight_row.brand_id
      and subject_type = insight_row.subject_type
      and subject_id = insight_row.subject_id
      and is_current = true;

    update public.cognition_insights
    set payload = revision->'payload',
        status = 'confirmed',
        version = next_version,
        is_current = true
    where id = insight_row.id;
  end loop;

  update public.cognition_runs
  set status = 'confirmed',
      confirmed_by = actor_id,
      confirmed_at = now(),
      completed_at = coalesce(completed_at, now()),
      error = null
  where organization_id = target_organization_id and id = target_run_id;
end;
$$;

revoke all on function public.confirm_cognition_run(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.confirm_cognition_run(uuid, uuid, uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
