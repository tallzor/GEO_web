alter table public.detections
  add column if not exists collection_total integer not null default 0,
  add column if not exists collection_completed integer not null default 0,
  add column if not exists analysis_total integer not null default 0,
  add column if not exists analysis_completed integer not null default 0,
  add column if not exists progress_message text,
  add column if not exists worker_id text,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists collection_model_versions jsonb not null default '{}'::jsonb,
  add column if not exists analysis_prompt_version text,
  add column if not exists analysis_rule_version text;

alter table public.detections drop constraint if exists detections_stage_check;
alter table public.detections add constraint detections_stage_check
  check (stage in ('queued','collecting','analyzing','aggregating','completed','failed'));

alter table public.detection_diagnoses
  add column if not exists suggestion_status text not null default 'not_generated',
  add column if not exists suggestion_error text,
  add column if not exists suggestion_updated_at timestamptz;

alter table public.detection_diagnoses drop constraint if exists detection_diagnoses_suggestion_status_check;
alter table public.detection_diagnoses add constraint detection_diagnoses_suggestion_status_check
  check (suggestion_status in ('not_generated','generating','generated','failed'));

create index if not exists detections_worker_queue_idx
  on public.detections (status, lease_expires_at, created_at)
  where status in ('pending','running');

create or replace function public.claim_next_detection_task(p_worker_id text, p_lease_seconds integer default 180)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  select id into v_id from public.detections
  where status in ('pending','running')
    and (lease_expires_at is null or lease_expires_at <= now())
  order by created_at
  for update skip locked limit 1;
  if v_id is null then return null; end if;
  update public.detections set
    status = 'running',
    stage = case when stage = 'queued' then 'collecting' else stage end,
    worker_id = p_worker_id,
    heartbeat_at = now(),
    lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
    started_at = coalesce(started_at, now()),
    completed_at = null,
    updated_at = now()
  where id = v_id;
  return v_id;
end;
$$;

create or replace function public.heartbeat_detection_task(p_detection_id uuid, p_worker_id text, p_lease_seconds integer default 180)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.detections set
    heartbeat_at = now(),
    lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
    updated_at = now()
  where id = p_detection_id and worker_id = p_worker_id;
  return found;
end;
$$;

create or replace function public.release_detection_task_lease(p_detection_id uuid, p_worker_id text)
returns void language sql security definer set search_path = public as $$
  update public.detections set worker_id = null, heartbeat_at = null, lease_expires_at = null, updated_at = now()
  where id = p_detection_id and worker_id = p_worker_id;
$$;

create or replace function public.claim_next_detection_suggestion(p_worker_id text, p_lease_seconds integer default 180)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  select d.id into v_id
  from public.detections d
  join public.detection_diagnoses dd on dd.detection_id = d.id and dd.is_current = true
  where d.status = 'completed' and dd.suggestion_status = 'generating'
    and (d.lease_expires_at is null or d.lease_expires_at <= now())
  order by dd.suggestion_updated_at nulls first, d.updated_at
  for update of d skip locked limit 1;
  if v_id is null then return null; end if;
  update public.detections set worker_id = p_worker_id, heartbeat_at = now(),
    lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)), updated_at = now()
  where id = v_id;
  return v_id;
end;
$$;

revoke all on function public.claim_next_detection_task(text, integer) from public;
revoke all on function public.heartbeat_detection_task(uuid, text, integer) from public;
revoke all on function public.release_detection_task_lease(uuid, text) from public;
revoke all on function public.claim_next_detection_suggestion(text, integer) from public;
grant execute on function public.claim_next_detection_task(text, integer) to service_role;
grant execute on function public.heartbeat_detection_task(uuid, text, integer) to service_role;
grant execute on function public.release_detection_task_lease(uuid, text) to service_role;
grant execute on function public.claim_next_detection_suggestion(text, integer) to service_role;
