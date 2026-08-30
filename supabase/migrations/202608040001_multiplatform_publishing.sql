-- Multi-platform draft synchronization foundation.
-- P0 supports WeChat official account drafts and Zhihu browser-extension drafts.
-- Xiaohongshu remains a visible but unavailable platform.

alter table public.publishing_accounts
  add column brand_id uuid,
  add column connection_mode text not null default 'server_api'
    check (connection_mode in ('server_api', 'browser_extension', 'unavailable')),
  add column default_cover_object_path text,
  add column default_cover_media_id text,
  add column extension_token_hash text,
  add column extension_version text,
  add column last_connected_at timestamptz;

update public.publishing_accounts account
set brand_id = (
  select brand.id
  from public.brands brand
  where brand.organization_id = account.organization_id
  order by brand.created_at
  limit 1
)
where account.brand_id is null;

do $$
begin
  if exists (select 1 from public.publishing_accounts where brand_id is null) then
    raise exception 'Publishing accounts without a brand must be assigned before applying this migration';
  end if;
end;
$$;

alter table public.publishing_accounts
  alter column brand_id set not null,
  add constraint publishing_accounts_brand_fk
    foreign key (organization_id, brand_id)
    references public.brands(organization_id, id) on delete cascade;

alter table public.publishing_accounts
  drop constraint publishing_accounts_channel_check,
  add constraint publishing_accounts_channel_check
    check (channel in ('wechat', 'zhihu', 'xiaohongshu'));

alter table public.publishing_accounts
  drop constraint publishing_accounts_organization_id_channel_account_name_key,
  add constraint publishing_accounts_brand_channel_key
    unique (organization_id, brand_id, channel);

create table public.publish_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  task_id uuid not null,
  content_id uuid not null,
  content_version integer not null check (content_version > 0),
  idempotency_key text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'partial_succeeded', 'failed')),
  success_count integer not null default 0 check (success_count >= 0),
  failure_count integer not null default 0 check (failure_count >= 0),
  created_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, brand_id)
    references public.brands(organization_id, id) on delete cascade,
  foreign key (organization_id, task_id)
    references public.optimization_tasks(organization_id, id) on delete restrict,
  foreign key (organization_id, content_id)
    references public.contents(organization_id, id) on delete restrict
);

alter table public.publish_records
  add column batch_id uuid,
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column external_draft_id text,
  add column external_draft_url text,
  add column error_code text,
  add column started_at timestamptz;

alter table public.publish_records
  drop constraint publish_records_channel_check,
  add constraint publish_records_channel_check
    check (channel in ('wechat', 'zhihu', 'xiaohongshu')),
  drop constraint publish_records_status_check,
  add constraint publish_records_status_check
    check (status in ('queued', 'syncing', 'publishing', 'published', 'draft_saved', 'failed')),
  add constraint publish_records_batch_fk
    foreign key (organization_id, batch_id)
    references public.publish_batches(organization_id, id) on delete cascade;

create unique index publish_records_batch_channel_key
  on public.publish_records(batch_id, channel)
  where batch_id is not null;

alter table public.optimization_tasks
  drop constraint optimization_tasks_delivery_check,
  add constraint optimization_tasks_delivery_check
    check (delivery in ('material', 'copy', 'wechat_draft', 'zhihu_draft', 'xiaohongshu_publish', 'multi_platform')),
  drop constraint optimization_tasks_channel_check,
  add constraint optimization_tasks_channel_check
    check (channel is null or channel in ('wechat', 'zhihu', 'xiaohongshu'));

alter table public.contents
  drop constraint contents_selected_channel_check,
  add constraint contents_selected_channel_check
    check (selected_channel in ('wechat', 'zhihu', 'xiaohongshu'));

create index publishing_accounts_brand_idx
  on public.publishing_accounts(brand_id, channel);
create index publish_batches_brand_idx
  on public.publish_batches(brand_id, created_at desc);
create index publish_records_batch_idx
  on public.publish_records(batch_id, created_at);

create trigger publish_batches_set_updated_at
  before update on public.publish_batches
  for each row execute function public.set_updated_at();

alter table public.publish_batches enable row level security;
alter table public.publish_batches force row level security;

create policy publish_batches_select_member
  on public.publish_batches for select to authenticated
  using (private.is_org_member(organization_id));

grant select on public.publish_batches to authenticated;

revoke select on public.publishing_accounts from authenticated;
grant select (
  id, organization_id, brand_id, channel, name, account_name, mode, status,
  app_id_masked, draft_enabled, connection_status, connection_mode,
  default_cover_object_path, extension_version, last_connected_at,
  verified_at, error, created_at, updated_at
) on public.publishing_accounts to authenticated;

grant all privileges on public.publish_batches to service_role;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'publishing-assets', 'publishing-assets', false, 2097152,
  array['image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table public.publish_batches is
  'One user synchronization action. Child publish_records run independently.';
comment on column public.publishing_accounts.credentials_ciphertext is
  'Server-only encrypted credential payload. Never grant browser read access.';
comment on column public.publishing_accounts.extension_token_hash is
  'SHA-256 hash of the one-time browser extension token. Never return it to the browser.';
