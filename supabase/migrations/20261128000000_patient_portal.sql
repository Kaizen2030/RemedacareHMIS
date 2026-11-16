-- Patient portal (functions/patient-portal + #/portal in the web app).
--   * Sign-in by phone: a 6-digit code by SMS (Africa's Talking) or a code printed at reception (works without SMS).
--     Codes and session tokens are random and stored only as hashes; 5 wrong codes lock that code; at most 3 SMS
--     codes per phone per 15 minutes and 10 per day.
--   * A phone sees every patient registered with that number at facilities that switched the portal on (a parent sees
--     their children) — never patients marked confidential.
--   * Each facility chooses whether results are shown and which tests are never released online (HIV, viral load …).
--   * Everything here is server-only: the browser talks to the edge function, which calls these functions.

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
  -- 6 digits from a random UUID (gen_random_uuid is cryptographically random in PostgreSQL 13+)
  select lpad((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 1000000)::text, 6, '0')
$$;

-- Patients this phone may see
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

-- SMS sign-in: returns the code for the edge function to send, or null (unknown number / too many requests).
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

-- Reception: a printed code for a patient (works without SMS), valid 24 hours
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

-- Check a code; returns a session token (12 hours) or an error status
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
  -- a successful sign-in uses up every outstanding code for this phone
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

-- Access: everything server-only except settings (admins) and the reception code
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
