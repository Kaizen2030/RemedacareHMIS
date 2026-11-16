-- =============================================================================
-- RemedacareHMS - SERVER-ONLY CREDENTIALS, HASHED ADMIN PIN, REFERRAL LETTER LINKS
-- Generated from supabase/migrations/20261126000000_hospital_secrets.sql + 20261127000000_referral_shares.sql - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.clin_can_access(uuid)') is null then
    raise exception 'Run 08_hiv_tb_maternity.sql first. Nothing was changed.';
  end if;
end $$;

create table if not exists public.hospital_secrets (
  hospital_id uuid not null,
  name        text not null check (name ~ '^[a-z0-9_]{2,60}$'),
  value       text,
  vault_id    uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid(),
  primary key (hospital_id, name)
);
alter table public.hospital_secrets enable row level security;
revoke all on public.hospital_secrets from anon, authenticated;
grant all on public.hospital_secrets to service_role;

create table if not exists public.admin_pin_attempts (
  id          bigserial primary key,
  hospital_id uuid not null,
  user_id     uuid,
  ok          boolean not null,
  at          timestamptz not null default now()
);
alter table public.admin_pin_attempts enable row level security;
revoke all on public.admin_pin_attempts from anon, authenticated;
grant all on public.admin_pin_attempts to service_role;

create or replace function public.secret_store(p_hospital uuid, p_name text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
declare v_vault uuid; v_use_vault boolean := to_regprocedure('vault.create_secret(text,text,text)') is not null;
begin
  if coalesce(p_value, '') = '' then
    select vault_id into v_vault from public.hospital_secrets where hospital_id = p_hospital and name = p_name;
    if v_vault is not null then
      begin execute 'delete from vault.secrets where id = $1' using v_vault; exception when others then null; end;
    end if;
    delete from public.hospital_secrets where hospital_id = p_hospital and name = p_name;
    return;
  end if;
  if v_use_vault then
    begin
      select vault_id into v_vault from public.hospital_secrets where hospital_id = p_hospital and name = p_name;
      if v_vault is not null then
        execute 'select vault.update_secret($1, $2)' using v_vault, p_value;
      else
        execute 'select vault.create_secret($1, $2, $3)' into v_vault
          using p_value, 'rc_' || p_hospital || '_' || p_name || '_' || replace(gen_random_uuid()::text, '-', ''), 'RemedacareHMS ' || p_name;
      end if;
      insert into public.hospital_secrets(hospital_id, name, value, vault_id, updated_at)
      values (p_hospital, p_name, null, v_vault, now())
      on conflict (hospital_id, name) do update set value = null, vault_id = excluded.vault_id, updated_at = now(), updated_by = auth.uid();
      return;
    exception when others then
      raise notice 'Vault unavailable (%), keeping % server-only', sqlerrm, p_name;
    end;
  end if;
  insert into public.hospital_secrets(hospital_id, name, value, vault_id, updated_at)
  values (p_hospital, p_name, p_value, null, now())
  on conflict (hospital_id, name) do update set value = excluded.value, vault_id = null, updated_at = now(), updated_by = auth.uid();
end $$;

create or replace function public.hospital_secret_set(p_hospital uuid, p_name text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.priv_is_admin(p_hospital) then raise exception 'Only administrators can change credentials'; end if;
  if p_name !~ '^[a-z0-9_]{2,60}$' or p_name = 'admin_pin_hash' then raise exception 'Invalid credential name'; end if;
  perform public.secret_store(p_hospital, p_name, p_value);
  perform public.payments_audit(p_hospital, case when coalesce(p_value, '') = '' then 'delete:hospital_secrets' else 'update:hospital_secrets' end, null,
    jsonb_build_object('name', p_name));   -- the name only, never the value
end $$;

create or replace function public.hospital_secret_status(p_hospital uuid)
returns table (name text, updated_at timestamptz, encrypted boolean) language sql stable security definer set search_path = public as $$
  select s.name, s.updated_at, s.vault_id is not null from public.hospital_secrets s
   where s.hospital_id = p_hospital and public.priv_is_admin(p_hospital) and s.name <> 'admin_pin_hash' order by s.name
$$;

create or replace function public.hospital_secret_get(p_hospital uuid, p_name text)
returns text language plpgsql stable security definer set search_path = public as $$
declare r record; v text;
begin
  select * into r from public.hospital_secrets where hospital_id = p_hospital and name = p_name;
  if not found then return null; end if;
  if r.vault_id is null then return r.value; end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where id = $1' into v using r.vault_id;
  return v;
end $$;

create or replace function public.admin_pin_set(p_hospital uuid, p_pin text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.priv_is_admin(p_hospital) then raise exception 'Only administrators can change the PIN'; end if;
  if coalesce(p_pin, '') = '' then perform public.secret_store(p_hospital, 'admin_pin_hash', null); return; end if;
  if p_pin !~ '^[0-9]{4,6}$' then raise exception 'The PIN must be 4 to 6 digits'; end if;
  perform public.secret_store(p_hospital, 'admin_pin_hash', encode(sha256(convert_to(p_hospital::text || ':' || p_pin, 'UTF8')), 'hex'));
  perform public.payments_audit(p_hospital, 'update:admin_pin', null, '{}'::jsonb);
end $$;

create or replace function public.admin_pin_check(p_hospital uuid, p_pin text)
returns text language plpgsql security definer set search_path = public as $$
declare v_hash text; v_fails int;
begin
  if not public.pay_is_member(p_hospital) then return 'not_member'; end if;
  select count(*) into v_fails from public.admin_pin_attempts
   where hospital_id = p_hospital and user_id = auth.uid() and not ok and at > now() - interval '15 minutes';
  if v_fails >= 5 then return 'locked'; end if;
  v_hash := public.hospital_secret_get(p_hospital, 'admin_pin_hash');
  if v_hash is null then return 'not_set'; end if;
  if v_hash = encode(sha256(convert_to(p_hospital::text || ':' || coalesce(p_pin, ''), 'UTF8')), 'hex') then
    insert into public.admin_pin_attempts(hospital_id, user_id, ok) values (p_hospital, auth.uid(), true);
    return 'ok';
  end if;
  insert into public.admin_pin_attempts(hospital_id, user_id, ok) values (p_hospital, auth.uid(), false);
  return 'wrong';
end $$;

revoke execute on function public.secret_store(uuid, text, text), public.hospital_secret_get(uuid, text) from public, anon, authenticated;
grant execute on function public.secret_store(uuid, text, text), public.hospital_secret_get(uuid, text) to service_role;
revoke execute on function public.hospital_secret_set(uuid, text, text), public.hospital_secret_status(uuid),
  public.admin_pin_set(uuid, text), public.admin_pin_check(uuid, text) from public, anon;
grant execute on function public.hospital_secret_set(uuid, text, text), public.hospital_secret_status(uuid),
  public.admin_pin_set(uuid, text), public.admin_pin_check(uuid, text) to authenticated, service_role;

do $$
declare
  h record; k text; v text;
  secret_keys text[] := array['etims_secret', 'sha_api_key', 'sha_fhir_client_secret', 'mpesa_consumer_key', 'mpesa_consumer_sec', 'mpesa_passkey', 'sms_api_key', 'nhif_password'];
  ss jsonb; cfg jsonb; saved jsonb;
begin
  for h in select id, system_settings from public.hospitals where system_settings is not null loop
    ss := h.system_settings;
    cfg := coalesce(ss->'integrations_config', '{}'::jsonb);
    saved := coalesce(ss->'integrations_secrets_saved', '[]'::jsonb);
    foreach k in array secret_keys loop
      v := cfg->>k;
      if coalesce(v, '') <> '' then
        perform public.secret_store(h.id, k, v);
        if not saved ? k then saved := saved || to_jsonb(k); end if;
      end if;
      cfg := cfg - k;
    end loop;
    if coalesce(ss->>'admin_pin', '') <> '' then
      perform public.secret_store(h.id, 'admin_pin_hash', encode(sha256(convert_to(h.id::text || ':' || (ss->>'admin_pin'), 'UTF8')), 'hex'));
    end if;
    ss := (ss - 'admin_pin') || jsonb_build_object('integrations_config', cfg, 'integrations_secrets_saved', saved,
            'admin_pin_set', coalesce(ss->>'admin_pin', '') <> '' or coalesce((ss->>'admin_pin_set')::boolean, false));
    if ss is distinct from h.system_settings then
      update public.hospitals set system_settings = ss where id = h.id;
    end if;
  end loop;

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hospitals' and column_name = 'sha_fhir_client_secret') then
    for h in execute 'select id, sha_fhir_client_secret as v from public.hospitals where coalesce(sha_fhir_client_secret, '''') <> ''''' loop
      perform public.secret_store(h.id, 'sha_fhir_client_secret', h.v);
    end loop;
    execute 'update public.hospitals set sha_fhir_client_secret = null where sha_fhir_client_secret is not null';
  end if;
end $$;

create or replace function public.hospitals_move_secrets()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  k text; v text; ss jsonb := new.system_settings; cfg jsonb; saved jsonb;
  secret_keys text[] := array['etims_secret', 'sha_api_key', 'sha_fhir_client_secret', 'mpesa_consumer_key', 'mpesa_consumer_sec', 'mpesa_passkey', 'sms_api_key', 'nhif_password'];
begin
  if ss is null then return new; end if;
  cfg := coalesce(ss->'integrations_config', '{}'::jsonb);
  saved := coalesce(ss->'integrations_secrets_saved', case when tg_op = 'UPDATE' then old.system_settings->'integrations_secrets_saved' end, '[]'::jsonb);
  foreach k in array secret_keys loop
    v := cfg->>k;
    if coalesce(v, '') <> '' then
      perform public.secret_store(new.id, k, v);
      if not saved ? k then saved := saved || to_jsonb(k); end if;
    end if;
    cfg := cfg - k;
  end loop;
  if coalesce(ss->>'admin_pin', '') <> '' then
    perform public.secret_store(new.id, 'admin_pin_hash', encode(sha256(convert_to(new.id::text || ':' || (ss->>'admin_pin'), 'UTF8')), 'hex'));
    ss := ss || '{"admin_pin_set": true}'::jsonb;
  end if;
  new.system_settings := (ss - 'admin_pin') || jsonb_build_object('integrations_config', cfg, 'integrations_secrets_saved', saved);
  return new;
end $$;
revoke execute on function public.hospitals_move_secrets() from public, anon, authenticated;
drop trigger if exists trg_hospitals_move_secrets on public.hospitals;
create trigger trg_hospitals_move_secrets before insert or update of system_settings on public.hospitals
  for each row execute function public.hospitals_move_secrets();

create table if not exists public.referral_shares (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null,
  referral_id  text not null,
  visit_id     text not null,
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  max_uses     integer not null default 100,
  use_count    integer not null default 0,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists referral_shares_referral on public.referral_shares(hospital_id, referral_id);

create or replace function public.referral_share_create(p_referral text, p_days integer default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_token text; v_id uuid; v_exp timestamptz;
begin
  execute 'select ref_try_uuid(hospital_id::text) as hospital_id, visit_id::text as visit_id from public.referrals where id::text = $1'
    into r using p_referral;
  if r.hospital_id is null then raise exception 'Referral not found'; end if;
  if not public.clin_can_access(r.hospital_id) then raise exception 'Only clinical staff can share referral records'; end if;
  if r.visit_id is null then raise exception 'Link the referral to a visit first'; end if;
  v_token := 'rcs_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_exp := now() + make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90));
  insert into public.referral_shares(hospital_id, referral_id, visit_id, token_hash, expires_at)
  values (r.hospital_id, p_referral, r.visit_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_exp)
  returning id into v_id;
  perform public.payments_audit(r.hospital_id, 'insert:referral_shares', v_id, jsonb_build_object('referral_id', p_referral, 'expires_at', v_exp));
  return jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_exp);
end $$;

create or replace function public.referral_share_resolve(p_token text)
returns table (id uuid, hospital_id uuid, referral_id text, visit_id text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.referral_shares s set use_count = s.use_count + 1, last_used_at = now()
   where s.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
     and s.revoked_at is null and s.expires_at > now() and s.use_count < s.max_uses
  returning s.id, s.hospital_id, s.referral_id, s.visit_id, s.expires_at;
end $$;

alter table public.referral_shares enable row level security;
drop policy if exists referral_shares_clinical_read on public.referral_shares;
drop policy if exists referral_shares_clinical_revoke on public.referral_shares;
create policy referral_shares_clinical_read on public.referral_shares for select to authenticated using (public.clin_can_access(hospital_id));
create policy referral_shares_clinical_revoke on public.referral_shares for update to authenticated
  using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
revoke all on public.referral_shares from anon, authenticated;
grant select (id, hospital_id, referral_id, visit_id, expires_at, max_uses, use_count, last_used_at, revoked_at, created_by, created_at) on public.referral_shares to authenticated;
grant update (revoked_at) on public.referral_shares to authenticated;
grant all on public.referral_shares to service_role;

revoke execute on function public.referral_share_create(text, integer), public.referral_share_resolve(text) from public, anon;
grant execute on function public.referral_share_create(text, integer) to authenticated, service_role;
grant execute on function public.referral_share_resolve(text) to service_role;

commit;

select 'credentials left in readable settings' as check_name, case when count(*) = 0 then 'OK' else count(*) || ' hospitals - send me this' end as result
      from public.hospitals where system_settings::text ~ '"(etims_secret|sha_api_key|mpesa_consumer_key|mpesa_consumer_sec|mpesa_passkey|sms_api_key|nhif_password|admin_pin)": ?"[^"]'
    union all select 'credentials moved', (select count(*) || ' saved, ' || count(*) filter (where vault_id is not null) || ' encrypted in Vault' from public.hospital_secrets)
    union all select 'referral links', case when to_regprocedure('public.referral_share_resolve(text)') is not null then 'OK' else 'PROBLEM' end;
