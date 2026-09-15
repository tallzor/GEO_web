-- v0.3.0 user question simulator and formal question library.

alter table public.detection_questions
  add column if not exists subject_type text,
  add column if not exists product_id uuid,
  add column if not exists persona text,
  add column if not exists decision_scenario text,
  add column if not exists created_by uuid references auth.users(id) on delete set null;

update public.detection_questions
set subject_type = 'brand',
    persona = coalesce(nullif(persona, ''), '旧数据迁移'),
    decision_scenario = coalesce(nullif(decision_scenario, ''), '历史检测场景'),
    source = 'legacy'
where subject_type is null
   or persona is null
   or decision_scenario is null
   or source in ('industry', 'generated', 'custom');

alter table public.detection_questions
  alter column subject_type set default 'brand',
  alter column subject_type set not null,
  alter column persona set default '用户手动添加',
  alter column persona set not null,
  alter column decision_scenario set default '用户自定义场景',
  alter column decision_scenario set not null,
  drop constraint if exists detection_questions_source_check,
  add constraint detection_questions_source_check
    check (source in ('simulator', 'manual', 'legacy')),
  add constraint detection_questions_subject_type_check
    check (subject_type in ('brand', 'product')),
  add constraint detection_questions_subject_product_check
    check ((subject_type = 'brand' and product_id is null)
      or (subject_type = 'product' and product_id is not null)),
  add constraint detection_questions_product_fkey
    foreign key (organization_id, product_id)
    references public.brand_products(organization_id, id) on delete cascade;

alter table public.detections
  add column if not exists subject_type text not null default 'brand',
  add column if not exists product_id uuid,
  add column if not exists subject_name text;

alter table public.detections
  add constraint detections_subject_type_check
    check (subject_type in ('brand', 'product')),
  add constraint detections_subject_product_check
    check ((subject_type = 'brand' and product_id is null)
      or (subject_type = 'product' and product_id is not null));

alter table public.detection_results
  drop constraint if exists detection_results_organization_id_question_id_fkey;

alter table public.detection_run_errors
  drop constraint if exists detection_run_errors_organization_id_question_id_fkey;

create table public.question_simulation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  subject_type text not null check (subject_type in ('brand', 'product')),
  subject_id uuid not null,
  subject_name text not null,
  cognition_insight_id uuid not null,
  cognition_version integer not null check (cognition_version > 0),
  mode text not null check (mode in ('initial', 'supplement', 'new_batch')),
  status text not null default 'queued'
    check (status in ('queued', 'generating', 'review_required', 'confirmed', 'failed', 'cancelled')),
  stage text check (stage is null or stage in ('persona', 'planning', 'questions', 'validation')),
  input_hash text not null,
  input_snapshot jsonb not null,
  config_hash text not null,
  idempotency_key text not null,
  personas jsonb not null default '[]'::jsonb,
  coverage_plan jsonb not null default '{}'::jsonb,
  coverage_gaps text[] not null default '{}',
  external_references jsonb not null default '[]'::jsonb,
  model text,
  prompt_version text not null,
  quality_rule_version text not null,
  attempt integer not null default 0 check (attempt >= 0),
  error text,
  error_category text,
  error_retryable boolean not null default false,
  generated_count integer not null default 0 check (generated_count >= 0),
  adopted_count integer not null default 0 check (adopted_count >= 0),
  deleted_count integer not null default 0 check (deleted_count >= 0),
  edited_count integer not null default 0 check (edited_count >= 0),
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
    references public.brands(organization_id, id) on delete cascade,
  foreign key (organization_id, cognition_insight_id)
    references public.cognition_insights(organization_id, id) on delete restrict
);

create table public.question_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  run_id uuid not null,
  text text not null check (length(btrim(text)) between 4 and 300),
  persona text not null check (length(btrim(persona)) > 0),
  decision_scenario text not null check (length(btrim(decision_scenario)) > 0),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, brand_id)
    references public.brands(organization_id, id) on delete cascade,
  foreign key (organization_id, run_id)
    references public.question_simulation_runs(organization_id, id) on delete cascade
);

create index question_simulation_runs_subject_idx
  on public.question_simulation_runs(brand_id, subject_type, subject_id, created_at desc);
create unique index question_simulation_runs_active_subject_idx
  on public.question_simulation_runs(organization_id, subject_type, subject_id)
  where status in ('queued', 'generating', 'review_required');
create unique index background_jobs_active_question_simulation_idx
  on public.background_jobs(organization_id, entity_id)
  where type = 'question_simulation' and status in ('pending', 'running');
create index question_candidates_run_idx
  on public.question_candidates(run_id, created_at);
create index detection_questions_subject_idx
  on public.detection_questions(brand_id, subject_type, product_id, updated_at desc);

create trigger question_simulation_runs_set_updated_at
  before update on public.question_simulation_runs
  for each row execute function public.set_updated_at();

alter table public.question_simulation_runs enable row level security;
alter table public.question_simulation_runs force row level security;
alter table public.question_candidates enable row level security;
alter table public.question_candidates force row level security;

create policy question_simulation_runs_select_member
  on public.question_simulation_runs for select to authenticated
  using (private.is_org_member(organization_id));
create policy question_candidates_select_member
  on public.question_candidates for select to authenticated
  using (private.is_org_member(organization_id));

grant select on public.question_simulation_runs, public.question_candidates to authenticated;
grant all privileges on public.question_simulation_runs, public.question_candidates to service_role;

create or replace function public.confirm_question_simulation(
  target_organization_id uuid,
  target_run_id uuid,
  actor_id uuid,
  reviewed_questions jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row record;
  question jsonb;
  stored_candidate record;
  current_count integer;
  addition_count integer;
  matched_count integer := 0;
  v_edited_count integer := 0;
  question_text text;
  question_persona text;
  question_scenario text;
begin
  select * into run_row
  from public.question_simulation_runs
  where organization_id = target_organization_id and id = target_run_id
  for update;

  if run_row.id is null then raise exception '模拟生成批次不存在'; end if;
  if run_row.status = 'confirmed' then return; end if;
  if run_row.status <> 'review_required' then raise exception '当前模拟生成批次不能确认'; end if;
  if jsonb_typeof(reviewed_questions) <> 'array' then raise exception '候选问题格式不正确'; end if;

  addition_count := jsonb_array_length(reviewed_questions);
  if addition_count < 1 or addition_count > 24 then raise exception '一次需要确认1—24道问题'; end if;

  perform 1 from public.brands
  where organization_id = target_organization_id and id = run_row.brand_id and deleted_at is null
  for update;
  if not found then raise exception '品牌不存在'; end if;

  select count(*) into current_count
  from public.detection_questions
  where organization_id = target_organization_id and brand_id = run_row.brand_id;
  if current_count + addition_count > 240 then
    raise exception '问题库容量不足，请先删除%道旧问题', current_count + addition_count - 240;
  end if;

  for question in select value from jsonb_array_elements(reviewed_questions)
  loop
    question_text := btrim(coalesce(question->>'text', ''));
    question_persona := btrim(coalesce(question->>'persona', ''));
    question_scenario := btrim(coalesce(question->>'decisionScenario', ''));
    if length(question_text) < 4 or length(question_text) > 300 then raise exception '问题需为4—300个字符'; end if;
    if question_persona = '' then raise exception '每道问题都需要对应模拟用户角色'; end if;
    if question_scenario = '' then raise exception '每道问题都需要决策场景'; end if;

    select * into stored_candidate
    from public.question_candidates
    where organization_id = target_organization_id
      and run_id = target_run_id
      and id::text = coalesce(question->>'id', '');
    if stored_candidate.id is not null then
      matched_count := matched_count + 1;
      if stored_candidate.text <> question_text
        or stored_candidate.persona <> question_persona
        or stored_candidate.decision_scenario <> question_scenario then
        v_edited_count := v_edited_count + 1;
      end if;
    end if;

    insert into public.detection_questions (
      organization_id, brand_id, subject_type, product_id, text, persona,
      decision_scenario, source, enabled, created_by
    ) values (
      target_organization_id,
      run_row.brand_id,
      run_row.subject_type,
      case when run_row.subject_type = 'product' then run_row.subject_id else null end,
      question_text,
      question_persona,
      question_scenario,
      case when stored_candidate.id is null then 'manual' else 'simulator' end,
      true,
      actor_id
    );
  end loop;

  delete from public.question_candidates
  where organization_id = target_organization_id and run_id = target_run_id;

  update public.question_simulation_runs
  set status = 'confirmed',
      stage = 'validation',
      adopted_count = addition_count,
      deleted_count = greatest(generated_count - matched_count, 0),
      edited_count = v_edited_count,
      confirmed_by = actor_id,
      confirmed_at = now(),
      completed_at = coalesce(completed_at, now()),
      error = null,
      error_category = null,
      error_retryable = false
  where organization_id = target_organization_id and id = target_run_id;
end;
$$;

revoke all on function public.confirm_question_simulation(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.confirm_question_simulation(uuid, uuid, uuid, jsonb) to service_role;

create or replace function public.create_manual_detection_question(
  target_organization_id uuid,
  target_brand_id uuid,
  target_subject_type text,
  target_subject_id uuid,
  question_text text,
  question_persona text,
  question_scenario text,
  actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_count integer;
  new_id uuid := gen_random_uuid();
begin
  perform 1 from public.brands
  where organization_id = target_organization_id and id = target_brand_id and deleted_at is null
  for update;
  if not found then raise exception '品牌不存在'; end if;
  if target_subject_type not in ('brand', 'product') then raise exception '检测对象类型不正确'; end if;
  if target_subject_type = 'brand' and target_subject_id <> target_brand_id then raise exception '品牌检测对象不正确'; end if;
  if target_subject_type = 'product' and not exists (
    select 1 from public.brand_products where organization_id = target_organization_id
      and brand_id = target_brand_id and id = target_subject_id
  ) then raise exception '产品或服务检测对象不存在'; end if;
  select count(*) into current_count from public.detection_questions
  where organization_id = target_organization_id and brand_id = target_brand_id;
  if current_count >= 240 then raise exception '问题库已达240道上限，请先删除旧问题'; end if;
  if length(btrim(question_text)) < 4 or length(btrim(question_text)) > 300 then raise exception '问题需为4—300个字符'; end if;
  if btrim(question_persona) = '' then raise exception '请填写对应用户角色'; end if;
  if btrim(question_scenario) = '' then raise exception '请填写决策场景'; end if;
  insert into public.detection_questions (
    id, organization_id, brand_id, subject_type, product_id, text, persona,
    decision_scenario, source, enabled, created_by
  ) values (
    new_id, target_organization_id, target_brand_id, target_subject_type,
    case when target_subject_type = 'product' then target_subject_id else null end,
    btrim(question_text), btrim(question_persona), btrim(question_scenario), 'manual', true, actor_id
  );
  return new_id;
end;
$$;

revoke all on function public.create_manual_detection_question(uuid, uuid, text, uuid, text, text, text, uuid) from public;
grant execute on function public.create_manual_detection_question(uuid, uuid, text, uuid, text, text, text, uuid) to service_role;

notify pgrst, 'reload schema';
