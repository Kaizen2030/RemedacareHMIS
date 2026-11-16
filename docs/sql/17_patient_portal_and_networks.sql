-- =============================================================================
-- RemedacareHMS - PATIENT PORTAL SIGN-IN AND MULTI-FACILITY NETWORKS
-- Generated from supabase/migrations/20261128000000_patient_portal.sql + 20261129000000_multi_facility.sql - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.clin_can_access(uuid)') is null then
    raise exception 'Run 08_hiv_tb_maternity.sql first. Nothing was changed.';
  end if;
end $$;

create or replace function public.portal_phone_norm(p text) returns text language sql immutable as $$
  select case
    when d ~ '^254[17][0-9]{8}$' then d
    when d ~ '^0[17][0-9]{8}$' then '254' || substr(d, 2)
    when d ~ '^[17][0-9]{8}$' then '254' || d
  end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x
$$;

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'patients' and column_name = 'phone') then
    execute 'create index if not exists patients_portal_phone on public.patients (public.portal_phone_norm(phone))';
  end if;
end $$;

create table if not exists public.portal_settings (
  hospital_id     uuid primary key,
  enabled         boolean not null default false,
  show_results    boolean not null default true,
  allow_requests  boolean not null default true,
  sensitive_tests text[] not null default array['hiv', 'viral load', 'cd4', 'pregnancy', 'hcg', 'hepatitis b', 'hbsag', 'syphilis', 'vdrl', 'genexpert', 'psa'],
  welcome_note    text,
  updated_at      timestamptz not null default now(),
  updated_by      uuid default auth.uid()
);

create table if not exists public.portal_codes (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null,
  code_hash   text not null,
  source      text not null check (source in ('sms', 'reception')),
  hospital_id uuid,
  patient_id  uuid,
  created_by  uuid,
  attempts    integer not null default 0,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists portal_codes_phone on public.portal_codes(phone, created_at desc);

create table if not exists public.portal_sessions (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null unique,
  phone        text not null,
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists public.portal_events (
  id          bigserial primary key,
  phone       text,
  hospital_id uuid,
  patient_id  uuid,
  event       text not null,
  details     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists portal_events_hospital on public.portal_events(hospital_id, created_at desc);

create or replace function public.portal_hash(p text) returns text language sql immutable as $$
  select encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'hex')
$$;

create or replace function public.portal_new_code() returns text language sql volatile as $$
  select lpad((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 1000000)::text, 6, '0')
$$;

create or replace function public.portal_patients(p_phone text)
returns table (patient_id uuid, hospital_id uuid, full_name text, patient_number text, hospital_name text,
               show_results boolean, allow_requests boolean, sensitive_tests text[], welcome_note text)
language plpgsql stable security definer set search_path = public as $$
declare v_phone text := public.portal_phone_norm(p_phone);
begin
  if v_phone is null then return; end if;
  return query execute
    'select p.id, ps.hospital_id, p.full_name::text, (to_jsonb(p)->>''patient_number'')::text, h.name::text,
            ps.show_results, ps.allow_requests, ps.sensitive_tests, ps.welcome_note
       from public.patients p
       join public.portal_settings ps on ps.enabled and ps.hospital_id = public.ref_try_uuid(p.hospital_id::text)
       left join public.hospitals h on h.id = ps.hospital_id
      where public.portal_phone_norm(p.phone) = $1 and coalesce((to_jsonb(p)->>''confidential'')::boolean, false) = false
      order by h.name, p.full_name'
    using v_phone;
end $$;

create or replace function public.portal_request_code(p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_phone text := public.portal_phone_norm(p_phone); v_code text;
begin
  if v_phone is null then return jsonb_build_object('status', 'invalid_phone'); end if;
  if (select count(*) from public.portal_codes where phone = v_phone and source = 'sms' and created_at > now() - interval '15 minutes') >= 3
     or (select count(*) from public.portal_codes where phone = v_phone and source = 'sms' and created_at > now() - interval '1 day') >= 10 then
    return jsonb_build_object('status', 'rate_limited', 'phone', v_phone);
  end if;
  if not exists (select 1 from public.portal_patients(v_phone)) then
    insert into public.portal_events(phone, event) values (v_phone, 'code_unknown_phone');
    return jsonb_build_object('status', 'unknown', 'phone', v_phone);
  end if;
  v_code := public.portal_new_code();
  insert into public.portal_codes(phone, code_hash, source, expires_at)
  values (v_phone, public.portal_hash(v_phone || ':' || v_code), 'sms', now() + interval '10 minutes');
  insert into public.portal_events(phone, event) values (v_phone, 'code_sms');
  return jsonb_build_object('status', 'ok', 'phone', v_phone, 'code', v_code);
end $$;

create or replace function public.portal_staff_code(p_patient uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_h uuid; v_phone text; v_code text; v_exp timestamptz := now() + interval '24 hours';
begin
  execute 'select public.ref_try_uuid(hospital_id::text), public.portal_phone_norm(phone) from public.patients where id = $1'
    into v_h, v_phone using p_patient;
  if v_h is null then raise exception 'Patient not found'; end if;
  if not public.pay_is_member(v_h) then raise exception 'You do not belong to this hospital'; end if;
  if not exists (select 1 from public.portal_settings where hospital_id = v_h and enabled) then
    raise exception 'The patient portal is switched off for this facility (Settings → Patient portal)';
  end if;
  if v_phone is null then raise exception 'Add a valid Kenyan mobile number to the patient record first'; end if;
  if exists (select 1 from public.patients where id = p_patient and coalesce((to_jsonb(patients)->>'confidential')::boolean, false)) then
    raise exception 'Confidential records are not available in the portal';
  end if;
  v_code := public.portal_new_code();
  insert into public.portal_codes(phone, code_hash, source, hospital_id, patient_id, created_by, expires_at)
  values (v_phone, public.portal_hash(v_phone || ':' || v_code), 'reception', v_h, p_patient, auth.uid(), v_exp);
  insert into public.portal_events(phone, hospital_id, patient_id, event, details) values (v_phone, v_h, p_patient, 'code_reception', jsonb_build_object('by', auth.uid()));
  return jsonb_build_object('code', v_code, 'phone_hint', '07…' || right(v_phone, 3), 'expires_at', v_exp);
end $$;

create or replace function public.portal_verify(p_phone text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_phone text := public.portal_phone_norm(p_phone); c record; v_token text; v_exp timestamptz := now() + interval '12 hours';
begin
  if v_phone is null then return jsonb_build_object('status', 'invalid_phone'); end if;
  select * into c from public.portal_codes
   where phone = v_phone and used_at is null and expires_at > now() order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('status', 'expired'); end if;
  if c.attempts >= 5 then return jsonb_build_object('status', 'locked'); end if;
  if c.code_hash <> public.portal_hash(v_phone || ':' || regexp_replace(coalesce(p_code, ''), '[^0-9]', '', 'g')) then
    update public.portal_codes set attempts = attempts + 1 where id = c.id;
    insert into public.portal_events(phone, event) values (v_phone, 'code_wrong');
    return jsonb_build_object('status', case when c.attempts + 1 >= 5 then 'locked' else 'wrong' end);
  end if;
  update public.portal_codes set used_at = now() where phone = v_phone and used_at is null;
  v_token := 'rcp_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.portal_sessions(token_hash, phone, expires_at) values (public.portal_hash(v_token), v_phone, v_exp);
  insert into public.portal_events(phone, event) values (v_phone, 'signed_in');
  return jsonb_build_object('status', 'ok', 'token', v_token, 'expires_at', v_exp);
end $$;

create or replace function public.portal_session_phone(p_token text)
returns text language plpgsql security definer set search_path = public as $$
declare v_phone text;
begin
  update public.portal_sessions set last_seen_at = now()
   where token_hash = public.portal_hash(p_token) and revoked_at is null and expires_at > now()
  returning phone into v_phone;
  return v_phone;
end $$;

create or replace function public.portal_logout(p_token text)
returns void language sql security definer set search_path = public as $$
  update public.portal_sessions set revoked_at = now() where token_hash = public.portal_hash(p_token) and revoked_at is null
$$;

alter table public.portal_settings enable row level security;
alter table public.portal_codes enable row level security;
alter table public.portal_sessions enable row level security;
alter table public.portal_events enable row level security;
drop policy if exists portal_settings_read on public.portal_settings;
drop policy if exists portal_settings_admin on public.portal_settings;
drop policy if exists portal_events_admin on public.portal_events;
create policy portal_settings_read on public.portal_settings for select to authenticated using (public.pay_is_member(hospital_id));
create policy portal_settings_admin on public.portal_settings for all to authenticated using (public.priv_is_admin(hospital_id)) with check (public.priv_is_admin(hospital_id));
create policy portal_events_admin on public.portal_events for select to authenticated using (hospital_id is not null and public.priv_is_admin(hospital_id));
revoke all on public.portal_settings, public.portal_codes, public.portal_sessions, public.portal_events from anon, authenticated;
grant select, insert, update on public.portal_settings to authenticated;
grant select on public.portal_events to authenticated;
grant all on public.portal_settings, public.portal_codes, public.portal_sessions, public.portal_events to service_role;
grant usage, select on sequence public.portal_events_id_seq to service_role;

revoke execute on function public.portal_patients(text), public.portal_request_code(text), public.portal_verify(text, text),
  public.portal_session_phone(text), public.portal_logout(text), public.portal_staff_code(uuid) from public, anon;
grant execute on function public.portal_patients(text), public.portal_request_code(text), public.portal_verify(text, text),
  public.portal_session_phone(text), public.portal_logout(text) to service_role;
grant execute on function public.portal_staff_code(uuid) to authenticated, service_role;

do $$ begin
  execute 'alter table public.patients add column if not exists mpi_id uuid';
  execute 'create index if not exists patients_mpi on public.patients(mpi_id) where mpi_id is not null';
end $$;

create or replace function public.net_facilities(p_hospital uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select h.id from public.hospitals h
   where h.id = p_hospital
      or (to_jsonb(h)->>'network_id' is not null
          and to_jsonb(h)->>'network_id' = (select to_jsonb(x)->>'network_id' from public.hospitals x where x.id = p_hospital))
$$;

create or replace function public.network_patient_search(p_hospital uuid, p_query text)
returns table (patient_id uuid, hospital_id uuid, hospital_name text, full_name text, gender text, age text,
               national_id_hint text, phone_hint text, already_here boolean)
language plpgsql stable security definer set search_path = public as $$
declare q text := trim(coalesce(p_query, '')); v_phone text := public.portal_phone_norm(p_query);
begin
  if not public.pay_is_member(p_hospital) then raise exception 'You do not belong to this facility'; end if;
  if length(q) < 3 then raise exception 'Type at least 3 characters'; end if;
  return query execute
    'with p as (
       select p.*, to_jsonb(p) as j, public.ref_try_uuid(p.hospital_id::text) as hid from public.patients p
        where public.ref_try_uuid(p.hospital_id::text) in (select public.net_facilities($1))
          and public.ref_try_uuid(p.hospital_id::text) <> $1
          and coalesce((to_jsonb(p)->>''confidential'')::boolean, false) = false
          and (   to_jsonb(p)->>''national_id'' = $2
               or to_jsonb(p)->>''sha_member_no'' = $2
               or to_jsonb(p)->>''patient_number'' = $2
               or ($3 is not null and public.portal_phone_norm(to_jsonb(p)->>''phone'') = $3)
               or (length($2) >= 3 and $2 !~ ''^[0-9 +]+$'' and p.full_name ilike ''%'' || replace(replace($2, ''%'', ''''), ''_'', '''') || ''%''))
        limit 25)
     select p.id, p.hid, h.name::text, p.full_name::text, (p.j->>''gender'')::text,
            coalesce(p.j->>''age'', case when p.j->>''dob'' ~ ''^\d{4}'' then extract(year from age(current_date, (p.j->>''dob'')::date))::int::text end)::text,
            case when p.j->>''national_id'' is not null then ''…'' || right(p.j->>''national_id'', 3) end,
            case when p.j->>''phone'' is not null then ''…'' || right(regexp_replace(p.j->>''phone'', ''[^0-9]'', '''', ''g''), 3) end,
            exists (select 1 from public.patients here where public.ref_try_uuid(here.hospital_id::text) = $1
                     and here.mpi_id is not null and here.mpi_id = coalesce(p.mpi_id, p.id))
       from p left join public.hospitals h on h.id = p.hid
      order by p.full_name'
    using p_hospital, q, v_phone;
end $$;

create or replace function public.network_patient_import(p_hospital uuid, p_source uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare src jsonb; v_src_h uuid; v_mpi uuid; v_existing uuid; v_row jsonb; v_cols text; v_new uuid;
begin
  if not public.pay_is_member(p_hospital) then raise exception 'You do not belong to this facility'; end if;
  select to_jsonb(p), public.ref_try_uuid(p.hospital_id::text) into src, v_src_h from public.patients p where p.id = p_source;
  if src is null or v_src_h = p_hospital or v_src_h not in (select public.net_facilities(p_hospital)) then
    raise exception 'That patient is not registered at a facility in your network';
  end if;
  if coalesce((src->>'confidential')::boolean, false) then raise exception 'Confidential records cannot be copied between facilities'; end if;
  v_mpi := coalesce((src->>'mpi_id')::uuid, p_source);
  update public.patients set mpi_id = v_mpi where id = p_source and mpi_id is null;
  select id into v_existing from public.patients where mpi_id = v_mpi and public.ref_try_uuid(hospital_id::text) = p_hospital limit 1;
  if v_existing is not null then return v_existing; end if;

  v_new := gen_random_uuid();
  v_row := jsonb_strip_nulls(src - array['id', 'hospital_id', 'patient_number', 'created_at', 'updated_at', 'confidential', 'mpi_id'])
           || jsonb_build_object('id', v_new, 'hospital_id', p_hospital, 'mpi_id', v_mpi);
  select string_agg(quote_ident(c.column_name), ', ') into v_cols
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'patients' and c.is_generated = 'NEVER' and coalesce(c.is_identity, 'NO') = 'NO'
     and v_row ? c.column_name;
  execute format('insert into public.patients (%s) select %s from jsonb_populate_record(null::public.patients, $1)', v_cols, v_cols) using v_row;
  perform public.payments_audit(p_hospital, 'insert:patients', v_new, jsonb_build_object('copied_from_facility', v_src_h, 'source_patient', p_source));
  return v_new;
end $$;

create or replace function public.network_patient_history(p_hospital uuid, p_patient uuid)
returns table (hospital_name text, happened_at timestamptz, kind text, summary text)
language plpgsql security definer set search_path = public as $$
declare v_mpi uuid; r record;
begin
  if not public.clin_can_access(p_hospital) then raise exception 'Only clinical staff can view records from other facilities'; end if;
  select coalesce(mpi_id, id) into v_mpi from public.patients where id = p_patient and public.ref_try_uuid(hospital_id::text) = p_hospital;
  if v_mpi is null then raise exception 'Patient not found at this facility'; end if;
  for r in select p.id, public.ref_try_uuid(p.hospital_id::text) as hid from public.patients p
            where (p.mpi_id = v_mpi or p.id = v_mpi) and p.id <> p_patient
              and public.ref_try_uuid(p.hospital_id::text) in (select public.net_facilities(p_hospital))
              and coalesce((to_jsonb(p)->>'confidential')::boolean, false) = false loop
    begin
      insert into public.patient_access_log(hospital_id, patient_id, user_id, user_email, action, context)
      values (r.hid, r.id, auth.uid(), (select email from auth.users where id = auth.uid()), 'view', 'network history from another facility');
    exception when others then null;
    end;
    return query execute
      'select h.name::text, v.created_at::timestamptz, ''Visit''::text, concat_ws('' · '', to_jsonb(v)->>''visit_type'', to_jsonb(v)->>''speciality'', to_jsonb(v)->>''status'')
         from public.visits v left join public.hospitals h on h.id = $2 where v.patient_id::text = $1::text
       union all
       select h.name::text, c.created_at::timestamptz, ''Diagnosis''::text, concat_ws('' '', to_jsonb(c)->>''icd10_code'', to_jsonb(c)->>''diagnosis'')
         from public.consultations c left join public.hospitals h on h.id = $2 where c.patient_id::text = $1::text and coalesce(to_jsonb(c)->>''diagnosis'', to_jsonb(c)->>''icd10_code'') is not null
       union all
       select h.name::text, rx.created_at::timestamptz, ''Medicine''::text, concat_ws('' '', to_jsonb(rx)->>''drug_name'', to_jsonb(rx)->>''dosage'', to_jsonb(rx)->>''frequency'', to_jsonb(rx)->>''duration'')
         from public.prescriptions rx left join public.hospitals h on h.id = $2 where rx.patient_id::text = $1::text'
      using r.id, r.hid;
  end loop;
end $$;

create or replace function public.network_summary(p_hospital uuid)
returns table (hospital_id uuid, hospital_name text, patients bigint, visits_today bigint, visits_month bigint, open_balance numeric)
language plpgsql stable security definer set search_path = public as $$
declare f uuid;
begin
  for f in select public.net_facilities(p_hospital) loop
    if not public.priv_is_admin(f) then continue; end if;
    return query execute
      'select $1, (select name::text from public.hospitals where id = $1),
              (select count(*) from public.patients where public.ref_try_uuid(hospital_id::text) = $1),
              (select count(*) from public.visits where public.ref_try_uuid(hospital_id::text) = $1 and created_at >= date_trunc(''day'', now())),
              (select count(*) from public.visits where public.ref_try_uuid(hospital_id::text) = $1 and created_at >= date_trunc(''month'', now())),
              (select coalesce(sum(coalesce((to_jsonb(i)->>''balance_kes'')::numeric, 0)), 0) from public.invoices i
                where public.ref_try_uuid(i.hospital_id::text) = $1 and coalesce(i.status, '''') not in (''Cancelled'', ''Paid''))'
      using f;
  end loop;
end $$;

revoke execute on function public.net_facilities(uuid), public.network_patient_search(uuid, text), public.network_patient_import(uuid, uuid),
  public.network_patient_history(uuid, uuid), public.network_summary(uuid) from public, anon;
grant execute on function public.network_patient_search(uuid, text), public.network_patient_import(uuid, uuid),
  public.network_patient_history(uuid, uuid), public.network_summary(uuid) to authenticated, service_role;
grant execute on function public.net_facilities(uuid) to service_role;

commit;

select 'portal tables' as check_name, case when to_regclass('public.portal_sessions') is not null and to_regclass('public.portal_settings') is not null then 'OK' else 'PROBLEM' end as result
    union all select 'portal sign-in is server-only', case when has_function_privilege('authenticated', 'public.portal_verify(text, text)', 'execute') then 'PROBLEM' else 'OK' end
    union all select 'Kenyan phone numbers recognised', case when public.portal_phone_norm('0712 345 678') = '254712345678' and public.portal_phone_norm('+254 112 345 678') = '254112345678' then 'OK' else 'PROBLEM' end
    union all select 'facilities in networks', (select count(*) filter (where to_jsonb(h)->>'network_id' is not null) || ' of ' || count(*) from public.hospitals h);
