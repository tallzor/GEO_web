alter table public.brands
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'brands_soft_delete_audit_check'
      and conrelid = 'public.brands'::regclass
  ) then
    alter table public.brands
      add constraint brands_soft_delete_audit_check
      check (deleted_at is not null or deleted_by is null);
  end if;
end;
$$;

create index if not exists brands_org_active_updated_idx
  on public.brands (organization_id, updated_at desc)
  where deleted_at is null;

drop policy if exists brands_insert_editor on public.brands;
drop policy if exists brands_insert_owner on public.brands;
create policy brands_insert_owner
  on public.brands for insert to authenticated
  with check (private.has_org_role(organization_id, array['owner']));

-- Brand removal is always a soft delete. There is intentionally no
-- authenticated DELETE policy; service-role maintenance remains possible.
drop policy if exists brands_delete_editor on public.brands;

create or replace function private.enforce_brand_owner_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  -- Internal service-role writes are authorized by the server permission layer.
  if actor_id is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not private.has_org_role(new.organization_id, array['owner']) then
      raise exception 'Only organization owners may create brands'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Brands must be soft deleted'
      using errcode = '42501';
  end if;

  if old.deleted_at is distinct from new.deleted_at
     or old.deleted_by is distinct from new.deleted_by then
    if not private.has_org_role(old.organization_id, array['owner']) then
      raise exception 'Only organization owners may change brand deletion state'
        using errcode = '42501';
    end if;

    if new.deleted_at is null then
      new.deleted_by := null;
    elsif old.deleted_at is null then
      new.deleted_by := actor_id;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_brand_owner_lifecycle() from public;

drop trigger if exists enforce_brand_owner_lifecycle on public.brands;
create trigger enforce_brand_owner_lifecycle
  before insert or update or delete on public.brands
  for each row execute function private.enforce_brand_owner_lifecycle();

comment on column public.brands.deleted_at is
  'Soft-delete timestamp. Null means the brand is active.';
comment on column public.brands.deleted_by is
  'User that initiated soft deletion; may become null if the auth user is removed.';
comment on function private.enforce_brand_owner_lifecycle() is
  'Protects brand creation and soft-deletion state for authenticated database clients.';

notify pgrst, 'reload schema';
