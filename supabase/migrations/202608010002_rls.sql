-- Tenant isolation and least-privilege access policies.

create or replace function private.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members member
    join public.organizations organization
      on organization.id = member.organization_id
    where member.organization_id = target_organization_id
      and member.user_id = auth.uid()
      and member.status = 'active'
      and organization.status = 'active'
  );
$$;

create or replace function private.has_org_role(
  target_organization_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members member
    join public.organizations organization
      on organization.id = member.organization_id
    where member.organization_id = target_organization_id
      and member.user_id = auth.uid()
      and member.status = 'active'
      and organization.status = 'active'
      and member.role = any(allowed_roles)
  );
$$;

revoke all on function private.is_org_member(uuid) from public;
revoke all on function private.has_org_role(uuid, text[]) from public;
grant execute on function private.is_org_member(uuid) to authenticated, service_role;
grant execute on function private.has_org_role(uuid, text[]) to authenticated, service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'organizations', 'organization_members', 'brands', 'user_preferences',
    'brand_stores', 'brand_products', 'brand_competitors',
    'brand_knowledge_files', 'detection_questions', 'detections',
    'detection_results', 'detection_run_errors', 'detection_analyses',
    'detection_diagnoses', 'diagnosis_issues', 'optimization_suggestions',
    'optimization_cycles', 'optimization_tasks', 'contents',
    'content_versions', 'publishing_accounts', 'publish_records',
    'background_jobs', 'audit_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end;
$$;

create policy profiles_select_self
  on public.profiles for select to authenticated
  using (id = auth.uid());

create policy profiles_update_self
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy user_preferences_select_self
  on public.user_preferences for select to authenticated
  using (user_id = auth.uid() and private.is_org_member(organization_id));

create policy user_preferences_insert_self
  on public.user_preferences for insert to authenticated
  with check (user_id = auth.uid() and private.is_org_member(organization_id));

create policy user_preferences_update_self
  on public.user_preferences for update to authenticated
  using (user_id = auth.uid() and private.is_org_member(organization_id))
  with check (user_id = auth.uid() and private.is_org_member(organization_id));

create policy organizations_select_member
  on public.organizations for select to authenticated
  using (private.is_org_member(id));

create policy organizations_update_admin
  on public.organizations for update to authenticated
  using (private.has_org_role(id, array['owner', 'admin']))
  with check (private.has_org_role(id, array['owner', 'admin']));

create policy organization_members_select_member
  on public.organization_members for select to authenticated
  using (private.is_org_member(organization_id));

create policy organization_members_insert_admin
  on public.organization_members for insert to authenticated
  with check (private.has_org_role(organization_id, array['owner', 'admin']));

create policy organization_members_update_admin
  on public.organization_members for update to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']))
  with check (private.has_org_role(organization_id, array['owner', 'admin']));

create policy organization_members_delete_admin
  on public.organization_members for delete to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'brands', 'brand_stores', 'brand_products', 'brand_competitors',
    'brand_knowledge_files', 'detection_questions', 'detections',
    'detection_results', 'detection_run_errors', 'detection_analyses',
    'detection_diagnoses', 'diagnosis_issues', 'optimization_suggestions',
    'optimization_cycles', 'optimization_tasks', 'contents',
    'content_versions', 'publishing_accounts', 'publish_records'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.is_org_member(organization_id))',
      table_name || '_select_member',
      table_name
    );
  end loop;
end;
$$;

-- Human-maintained brand data may be edited directly by organization editors.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'brands', 'brand_stores', 'brand_products', 'brand_competitors',
    'brand_knowledge_files', 'detection_questions'
  ]
  loop
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (private.has_org_role(organization_id, array[''owner'', ''admin'', ''member'']))',
      table_name || '_insert_editor',
      table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (private.has_org_role(organization_id, array[''owner'', ''admin'', ''member''])) with check (private.has_org_role(organization_id, array[''owner'', ''admin'', ''member'']))',
      table_name || '_update_editor',
      table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (private.has_org_role(organization_id, array[''owner'', ''admin'', ''member'']))',
      table_name || '_delete_editor',
      table_name
    );
  end loop;
end;
$$;

-- Users may edit generated content and mark a task complete, but creation of
-- detection, diagnosis, target, cycle and publishing data remains server-only.
create policy contents_update_editor
  on public.contents for update to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin', 'member']))
  with check (private.has_org_role(organization_id, array['owner', 'admin', 'member']));

create policy optimization_tasks_update_editor
  on public.optimization_tasks for update to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin', 'member']))
  with check (private.has_org_role(organization_id, array['owner', 'admin', 'member']));

create policy audit_logs_select_admin
  on public.audit_logs for select to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']));

create policy audit_logs_insert_member
  on public.audit_logs for insert to authenticated
  with check (
    private.is_org_member(organization_id)
    and user_id = auth.uid()
  );

revoke all on all tables in schema public from anon;
grant usage on schema public, private to authenticated, service_role;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.brands,
  public.brand_stores,
  public.brand_products,
  public.brand_competitors,
  public.brand_knowledge_files,
  public.detection_questions
  to authenticated;
grant update (title, body, selected_channel, status, risk_status, risk_issues, updated_at)
  on public.contents to authenticated;
grant update (status, completed_at, updated_at)
  on public.optimization_tasks to authenticated;
grant insert on public.audit_logs to authenticated;
grant update on public.profiles, public.organizations, public.organization_members
  to authenticated;
grant insert, delete on public.organization_members to authenticated;
grant select, insert, update on public.user_preferences to authenticated;

-- Publishing credentials are deliberately excluded from browser-readable data.
revoke select on public.publishing_accounts from authenticated;
grant select (
  id, organization_id, channel, name, account_name, mode, status,
  app_id_masked, draft_enabled, connection_status, verified_at, error,
  created_at, updated_at
) on public.publishing_accounts to authenticated;

grant all privileges on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public grant all on tables to service_role;

comment on function private.is_org_member(uuid) is 'RLS helper: true only for active organization members.';
comment on function private.has_org_role(uuid, text[]) is 'RLS helper: active membership with one of the allowed roles.';
