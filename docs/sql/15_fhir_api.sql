-- =============================================================================
-- RemedacareHMS - FHIR R4 API: CLIENT KEYS, CALL LOG, API READS IN THE ACCESS LOG
-- Generated from supabase/migrations/20261125000000_fhir_api.sql - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.priv_is_admin(uuid)') is null then
    raise exception 'Run 11_audit_privacy.sql first. Nothing was changed.';
  end if;
end $$;

create table if not exists public.fhir_clients (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null,
  name               text not null,
  key_prefix         text not null,
  key_hash           text not null unique,
  scopes             text[] not null default '{}',
  allow_confidential boolean not null default false,
  active             boolean not null default true,
  expires_at         timestamptz,
  last_used_at       timestamptz,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  revoked_at         timestamptz
);
create index if not exists fhir_clients_hospital on public.fhir_clients(hospital_id);

create or replace function public.fhir_valid_scopes(p text[]) returns boolean language sql immutable as $$
  select coalesce(bool_and(s = any(array['Patient', 'Encounter', 'Observation', 'Condition', 'MedicationRequest',
    'DiagnosticReport', 'Immunization', 'Organization', 'Practitioner'])), true) from unnest(p) s
$$;

create or replace function public.fhir_client_create(p_hospital uuid, p_name text, p_scopes text[], p_days integer default 365, p_allow_confidential boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_key text; v_id uuid;
begin
  if not public.priv_is_admin(p_hospital) then raise exception 'Only administrators can create API keys'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the system a name'; end if;
  if coalesce(array_length(p_scopes, 1), 0) = 0 or not public.fhir_valid_scopes(p_scopes) then raise exception 'Choose at least one valid resource'; end if;
  v_key := 'rcf_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.fhir_clients(hospital_id, name, key_prefix, key_hash, scopes, allow_confidential, expires_at)
  values (p_hospital, trim(p_name), left(v_key, 12), encode(sha256(convert_to(v_key, 'UTF8')), 'hex'), p_scopes,
          coalesce(p_allow_confidential, false), case when p_days > 0 then now() + make_interval(days => p_days) end)
  returning id into v_id;
  perform public.payments_audit(p_hospital, 'insert:fhir_clients', v_id, jsonb_build_object('name', trim(p_name), 'scopes', p_scopes));
  return jsonb_build_object('id', v_id, 'key', v_key);
end $$;

create or replace function public.fhir_client_by_key(p_key text)
returns table (id uuid, hospital_id uuid, name text, scopes text[], allow_confidential boolean)
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.fhir_clients c set last_used_at = now()
   where c.key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex')
     and c.active and c.revoked_at is null and (c.expires_at is null or c.expires_at > now())
  returning c.id, c.hospital_id, c.name, c.scopes, c.allow_confidential;
end $$;

alter table public.fhir_clients enable row level security;
drop policy if exists fhir_clients_admin_read on public.fhir_clients;
drop policy if exists fhir_clients_admin_revoke on public.fhir_clients;
create policy fhir_clients_admin_read on public.fhir_clients for select to authenticated using (public.priv_is_admin(hospital_id));
create policy fhir_clients_admin_revoke on public.fhir_clients for update to authenticated
  using (public.priv_is_admin(hospital_id)) with check (public.priv_is_admin(hospital_id));
revoke all on public.fhir_clients from anon, authenticated;
grant select on public.fhir_clients to authenticated;
grant update (active, revoked_at) on public.fhir_clients to authenticated;
grant all on public.fhir_clients to service_role;

create table if not exists public.fhir_audit_log (
  id            bigserial primary key,
  hospital_id   text,
  resource_type text,
  resource_id   text,
  action        text,
  caller_ip     text,
  status        text,
  details       jsonb,
  created_at    timestamptz not null default now()
);
alter table public.fhir_audit_log add column if not exists client_id uuid;
alter table public.fhir_audit_log add column if not exists client_name text;
alter table public.fhir_audit_log add column if not exists user_id uuid;
alter table public.fhir_audit_log add column if not exists result_count integer;
alter table public.fhir_audit_log add column if not exists query text;
alter table public.fhir_audit_log add column if not exists created_at timestamptz default now();
alter table public.fhir_audit_log enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'fhir_audit_log' loop
    execute format('drop policy if exists %I on public.fhir_audit_log', p.policyname);
  end loop;
end $$;
create policy fhir_audit_admin_read on public.fhir_audit_log for select to authenticated
  using (public.ref_try_uuid(hospital_id::text) is not null and public.priv_is_admin(public.ref_try_uuid(hospital_id::text)));
revoke all on public.fhir_audit_log from anon, authenticated;
grant select on public.fhir_audit_log to authenticated;
grant all on public.fhir_audit_log to service_role;
do $$ begin
  execute 'grant usage, select on sequence public.fhir_audit_log_id_seq to service_role';
exception when others then null;
end $$;

alter table public.patient_access_log alter column user_id drop not null;
alter table public.patient_access_log add column if not exists api_client_id uuid;
alter table public.patient_access_log add column if not exists api_client_name text;
do $$ begin
  alter table public.patient_access_log add constraint patient_access_log_who check (user_id is not null or api_client_id is not null);
exception when duplicate_object then null;
end $$;

revoke execute on function public.fhir_client_create(uuid, text, text[], integer, boolean), public.fhir_client_by_key(text) from public, anon;
grant execute on function public.fhir_client_create(uuid, text, text[], integer, boolean) to authenticated, service_role;
grant execute on function public.fhir_client_by_key(text) to service_role;

commit;

select 'API keys table' as check_name, case when to_regclass('public.fhir_clients') is not null then 'OK' else 'PROBLEM' end as result
    union all select 'key lookup is server-only', case when has_function_privilege('authenticated', 'public.fhir_client_by_key(text)', 'execute') then 'PROBLEM' else 'OK' end
    union all select 'API call log admin-only', case when exists (select 1 from pg_policies where tablename = 'fhir_audit_log' and policyname = 'fhir_audit_admin_read') then 'OK' else 'PROBLEM' end;
