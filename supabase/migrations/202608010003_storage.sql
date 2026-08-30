-- Private knowledge-file storage. Object paths must follow:
-- {organization_id}/{brand_id}/{generated_file_name}

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'brand-knowledge',
  'brand-knowledge',
  false,
  20971520,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.can_access_brand_storage(
  object_name text,
  require_editor boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.brands brand
    join public.organization_members member
      on member.organization_id = brand.organization_id
    where brand.organization_id::text = (storage.foldername(object_name))[1]
      and brand.id::text = (storage.foldername(object_name))[2]
      and member.user_id = auth.uid()
      and member.status = 'active'
      and (
        not require_editor
        or member.role in ('owner', 'admin', 'member')
      )
  );
$$;

revoke all on function private.can_access_brand_storage(text, boolean) from public;
grant execute on function private.can_access_brand_storage(text, boolean)
  to authenticated, service_role;

create policy brand_knowledge_select_member
  on storage.objects for select to authenticated
  using (
    bucket_id = 'brand-knowledge'
    and private.can_access_brand_storage(name, false)
  );

create policy brand_knowledge_insert_editor
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'brand-knowledge'
    and private.can_access_brand_storage(name, true)
  );

create policy brand_knowledge_update_editor
  on storage.objects for update to authenticated
  using (
    bucket_id = 'brand-knowledge'
    and private.can_access_brand_storage(name, true)
  )
  with check (
    bucket_id = 'brand-knowledge'
    and private.can_access_brand_storage(name, true)
  );

create policy brand_knowledge_delete_editor
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'brand-knowledge'
    and private.can_access_brand_storage(name, true)
  );

comment on function private.can_access_brand_storage(text, boolean) is
  'Validates organization membership and brand ownership encoded in a private object path.';
