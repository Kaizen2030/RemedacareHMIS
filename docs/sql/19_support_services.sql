-- =============================================================================
-- RemedacareHMS - SUPPORT DEPARTMENTS: HOUSEKEEPING, KITCHEN, MAINTENANCE, TRANSPORT, SECURITY, MEDICAL RECORDS, IT, ADMINISTRATION
-- Generated from supabase/migrations/20261201000000_support_services.sql - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.clin_can_access(uuid)') is null then
    raise exception 'Run 08_hiv_tb_maternity.sql first. Nothing was changed.';
  end if;
end $$;

create table if not exists public.service_settings (
  hospital_id            uuid primary key,
  hold_beds_for_cleaning boolean not null default false,
  sla_hours              jsonb not null default '{"emergency": 1, "urgent": 4, "routine": 24, "low": 72}'::jsonb,
  updated_at             timestamptz not null default now()
);

create table if not exists public.service_requests (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid not null,
  department        text not null check (department in ('housekeeping', 'kitchen', 'maintenance', 'transport', 'security', 'records', 'it', 'admin')),
  kind              text not null check (kind ~ '^[a-z_]{2,40}$'),
  title             text not null check (length(title) between 2 and 200),
  description       text,
  priority          text not null default 'routine' check (priority in ('emergency', 'urgent', 'routine', 'low')),
  status            text not null default 'open' check (status in ('open', 'assigned', 'in_progress', 'on_hold', 'done', 'verified', 'cancelled')),
  location          text,
  ward_id           text,
  bed_id            text,
  patient_id        uuid,
  asset_id          uuid,
  assigned_to       text,
  assigned_at       timestamptz,
  started_at        timestamptz,
  completed_at      timestamptz,
  completed_by      uuid,
  verified_at       timestamptz,
  verified_by       uuid,
  due_at            timestamptz,
  checklist         jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array'),
  details           jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  outcome           text,
  source            text not null default 'manual',
  requested_by      uuid default auth.uid(),
  requested_by_name text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists service_requests_board on public.service_requests(hospital_id, department, status, due_at);
create index if not exists service_requests_bed on public.service_requests(hospital_id, bed_id) where bed_id is not null;

create table if not exists public.service_assets (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null,
  department      text not null check (department in ('maintenance', 'it', 'transport', 'admin', 'kitchen', 'housekeeping', 'security', 'records')),
  kind            text not null check (kind ~ '^[a-z_]{2,40}$'),
  name            text not null,
  code            text,
  location        text,
  status          text not null default 'working' check (status in ('working', 'repair', 'out_of_service', 'retired', 'available', 'on_trip', 'active', 'expired')),
  assigned_to     text,
  ppm_every_days  integer check (ppm_every_days is null or ppm_every_days between 1 and 1825),
  last_ppm_on     date,
  expires_on      date,
  details         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists service_assets_dept on public.service_assets(hospital_id, department, kind);

create table if not exists public.service_logs (
  id               bigserial primary key,
  hospital_id      uuid not null,
  department       text not null,
  kind             text not null check (kind ~ '^[a-z_]{2,40}$'),
  subject          text,
  asset_id         uuid,
  patient_id       uuid,
  request_id       uuid,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  value            numeric,
  unit             text,
  details          jsonb not null default '{}'::jsonb,
  recorded_by      uuid default auth.uid(),
  recorded_by_name text,
  created_at       timestamptz not null default now()
);
create index if not exists service_logs_dept on public.service_logs(hospital_id, department, kind, started_at desc);

create or replace function public.service_next_ppm(p_last date, p_every integer, p_created timestamptz)
returns date language sql immutable as $$
  select case when p_every is null then null else coalesce(p_last, p_created::date) + p_every end
$$;

create or replace function public.service_requests_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_hours numeric; v_sla jsonb;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    if new.due_at is null then
      select sla_hours into v_sla from public.service_settings where hospital_id = new.hospital_id;
      v_hours := coalesce((v_sla->>new.priority)::numeric,
                          case new.priority when 'emergency' then 1 when 'urgent' then 4 when 'low' then 72 else 24 end);
      new.due_at := now() + make_interval(mins => (v_hours * 60)::int);
    end if;
    if new.assigned_to is not null and new.status = 'open' then new.status := 'assigned'; end if;
    if new.status = 'assigned' then new.assigned_at := coalesce(new.assigned_at, now()); end if;
    return new;
  end if;

  if old.status in ('verified', 'cancelled') and new.status is distinct from old.status then
    raise exception 'This request is closed (%). Open a new one instead.', old.status;
  end if;
  if new.assigned_to is distinct from old.assigned_to and new.assigned_to is not null then
    new.assigned_at := now();
    if new.status = 'open' then new.status := 'assigned'; end if;
  end if;
  if new.status = 'in_progress' and old.status <> 'in_progress' then new.started_at := coalesce(old.started_at, now()); end if;
  if new.status = 'done' and old.status <> 'done' then
    if exists (select 1 from jsonb_array_elements(new.checklist) i
                where coalesce((i->>'required')::boolean, false) and not coalesce((i->>'done')::boolean, false)) then
      raise exception 'Tick every required checklist item before marking this done';
    end if;
    new.completed_at := now();
    new.completed_by := auth.uid();
    new.started_at := coalesce(new.started_at, old.started_at, now());
  end if;
  if new.status = 'verified' and old.status <> 'verified' then
    if old.status <> 'done' then raise exception 'Only completed work can be verified'; end if;
    if auth.uid() is not null and auth.uid() = old.completed_by then
      raise exception 'Someone other than the person who did the work must verify it';
    end if;
    new.verified_at := now();
    new.verified_by := auth.uid();
  end if;
  if new.status in ('open', 'assigned', 'in_progress', 'on_hold') and old.status = 'done' then
    new.completed_at := null; new.completed_by := null;
  end if;
  return new;
end $$;

create or replace function public.service_requests_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.department = 'housekeeping' and new.bed_id is not null and new.status in ('done', 'verified')
     and old.status not in ('done', 'verified') then
    begin
      execute 'update public.beds set status = ''Free'' where id::text = $1 and status = ''Cleaning'' and patient_id is null' using new.bed_id;
    exception when others then raise warning 'bed release skipped: %', sqlerrm;
    end;
  end if;
  return null;
end $$;

drop trigger if exists trg_service_requests_before on public.service_requests;
create trigger trg_service_requests_before before insert or update on public.service_requests
  for each row execute function public.service_requests_before();
drop trigger if exists trg_service_requests_after on public.service_requests;
create trigger trg_service_requests_after after update on public.service_requests
  for each row execute function public.service_requests_after();

create or replace function public.service_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_service_assets_touch on public.service_assets;
create trigger trg_service_assets_touch before update on public.service_assets for each row execute function public.service_touch();

create or replace function public.service_logs_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Log entries cannot be deleted'; end if;
  if (to_jsonb(new) - array['ended_at', 'details']) is distinct from (to_jsonb(old) - array['ended_at', 'details']) then
    raise exception 'Log entries cannot be changed, only closed';
  end if;
  if old.ended_at is not null and new.ended_at is distinct from old.ended_at then raise exception 'This entry is already closed'; end if;
  return new;
end $$;
drop trigger if exists trg_service_logs_guard on public.service_logs;
create trigger trg_service_logs_guard before update or delete on public.service_logs for each row execute function public.service_logs_guard();

create or replace function public.service_ppm_done(p_asset uuid, p_notes text default null, p_checklist jsonb default '[]'::jsonb)
returns date language plpgsql security definer set search_path = public as $$
declare a public.service_assets%rowtype;
begin
  select * into a from public.service_assets where id = p_asset for update;
  if not found then raise exception 'Asset not found'; end if;
  if not public.pay_is_member(a.hospital_id) then raise exception 'You do not belong to this hospital'; end if;
  if a.ppm_every_days is null then raise exception 'This asset has no maintenance schedule'; end if;
  update public.service_assets set last_ppm_on = current_date, status = case when status = 'repair' then status else 'working' end where id = p_asset;
  insert into public.service_logs(hospital_id, department, kind, subject, asset_id, details)
  values (a.hospital_id, a.department, 'ppm_done', a.name, a.id, jsonb_build_object('notes', p_notes, 'checklist', coalesce(p_checklist, '[]'::jsonb)));
  return current_date + a.ppm_every_days;
end $$;

create or replace function public.service_clean_checklist(p_terminal boolean)
returns jsonb language sql immutable as $$
  select case when p_terminal then '[
    {"label":"Remove all linen and waste as infectious","required":true},
    {"label":"Clean and disinfect bed frame, mattress and rails (chlorine 1:10 / approved disinfectant)","required":true},
    {"label":"Disinfect locker, table, chair, call bell and equipment","required":true},
    {"label":"Clean walls to hand height, curtains changed","required":true},
    {"label":"Floor cleaned and disinfected","required":true},
    {"label":"Hand-wash point and bathroom disinfected","required":true},
    {"label":"Clean linen, PPE disposed of correctly","required":true}]'::jsonb
  else '[
    {"label":"Remove used linen and waste","required":true},
    {"label":"Wipe bed frame, mattress and rails","required":true},
    {"label":"Wipe locker, table and call bell","required":true},
    {"label":"Floor around bed cleaned","required":true},
    {"label":"Bed made with clean linen","required":true}]'::jsonb end
$$;

create or replace function public.beds_turnover()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_h uuid; v_iso boolean; v_hold boolean; v_label text; j jsonb := to_jsonb(new); o jsonb := to_jsonb(old);
begin
  v_h := public.ref_try_uuid(j->>'hospital_id');
  if v_h is null then return null; end if;
  if (o->>'patient_id') is not null and (j->>'patient_id') is null then
    v_iso := coalesce(o->>'isolation', j->>'isolation', '') in ('true', 't')
             or coalesce(o->>'notes', '') ~* 'isolat|infect|TB|cholera|covid';
    v_label := coalesce('Bed ' || (j->>'bed_number'), 'Bed');
    if not exists (select 1 from public.service_requests where hospital_id = v_h and bed_id = j->>'id'
                    and kind in ('discharge_clean', 'terminal_clean') and status not in ('done', 'verified', 'cancelled')) then
      insert into public.service_requests(hospital_id, department, kind, title, priority, ward_id, bed_id, location, checklist, source, requested_by_name)
      values (v_h, 'housekeeping', case when v_iso then 'terminal_clean' else 'discharge_clean' end,
              case when v_iso then 'Terminal clean — ' else 'Discharge clean — ' end || v_label,
              'urgent', j->>'ward_id', j->>'id', v_label, public.service_clean_checklist(v_iso), 'discharge', 'Wards (automatic)');
    end if;
    select hold_beds_for_cleaning into v_hold from public.service_settings where hospital_id = v_h;
    if coalesce(v_hold, false) and coalesce(j->>'status', '') = 'Free' then
      execute 'update public.beds set status = ''Cleaning'' where id::text = $1' using j->>'id';
    end if;
  end if;
  if coalesce(o->>'status', '') = 'Cleaning' and coalesce(j->>'status', '') = 'Free' then
    update public.service_requests set status = 'done', outcome = coalesce(outcome, 'Bed released by ward staff')
     where hospital_id = v_h and bed_id = j->>'id' and kind in ('discharge_clean', 'terminal_clean')
       and status not in ('done', 'verified', 'cancelled')
       and not exists (select 1 from jsonb_array_elements(checklist) i where coalesce((i->>'required')::boolean, false) and not coalesce((i->>'done')::boolean, false));
  end if;
  return null;
exception when others then
  raise warning 'beds_turnover skipped: %', sqlerrm;   -- never block a discharge
  return null;
end $$;

do $$ begin
  if to_regclass('public.beds') is not null then
    execute 'drop trigger if exists trg_beds_turnover on public.beds';
    execute 'create trigger trg_beds_turnover after update on public.beds for each row execute function public.beds_turnover()';
  end if;
end $$;

create or replace function public.exec_kpis(p_hospital uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb := '{}'::jsonb; v numeric; v2 numeric;
begin
  if not public.priv_is_admin(p_hospital) then raise exception 'Only administrators can see the executive dashboard'; end if;
  begin
    execute 'select count(*) filter (where patient_id is not null), count(*) from public.beds where public.ref_try_uuid(hospital_id::text) = $1' into v, v2 using p_hospital;
    r := r || jsonb_build_object('beds_occupied', v, 'beds_total', v2);
  exception when others then null; end;
  begin
    execute 'select count(*) from public.visits where public.ref_try_uuid(hospital_id::text) = $1 and created_at >= date_trunc(''day'', now())' into v using p_hospital;
    r := r || jsonb_build_object('visits_today', v);
  exception when others then null; end;
  begin
    execute 'select coalesce(sum(case when kind = ''refund'' then -amount else amount end), 0) from public.payments
              where hospital_id = $1 and status = ''completed'' and created_at >= date_trunc(''day'', now())' into v using p_hospital;
    r := r || jsonb_build_object('collected_today', v);
  exception when others then null; end;
  begin
    execute 'select coalesce(sum(coalesce((to_jsonb(i)->>''balance_kes'')::numeric, 0)), 0) from public.invoices i
              where public.ref_try_uuid(i.hospital_id::text) = $1 and coalesce(i.status, '''') not in (''Cancelled'', ''Paid'')' into v using p_hospital;
    r := r || jsonb_build_object('unpaid_balances', v);
  exception when others then null; end;
  begin
    execute 'select count(*) filter (where lower(coalesce(to_jsonb(c)->>''status'', '''')) like ''%reject%''), count(*) from public.sha_claims c
              where public.ref_try_uuid(c.hospital_id::text) = $1 and c.created_at >= now() - interval ''90 days''' into v, v2 using p_hospital;
    r := r || jsonb_build_object('claims_rejected_90d', v, 'claims_90d', v2);
  exception when others then null; end;
  r := r || jsonb_build_object(
    'requests_open', (select count(*) from public.service_requests where hospital_id = p_hospital and status not in ('done', 'verified', 'cancelled')),
    'requests_overdue', (select count(*) from public.service_requests where hospital_id = p_hospital and status not in ('done', 'verified', 'cancelled') and due_at < now()),
    'by_department', (select coalesce(jsonb_object_agg(department, n), '{}'::jsonb) from (select department, count(*) n from public.service_requests
                       where hospital_id = p_hospital and status not in ('done', 'verified', 'cancelled') group by department) d),
    'incidents_open', (select count(*) from public.service_requests where hospital_id = p_hospital and department = 'security' and kind = 'incident' and status not in ('done', 'verified', 'cancelled')),
    'complaints_open', (select count(*) from public.service_requests where hospital_id = p_hospital and kind = 'complaint' and status not in ('done', 'verified', 'cancelled')),
    'ppm_overdue', (select count(*) from public.service_assets where hospital_id = p_hospital and status not in ('retired') and public.service_next_ppm(last_ppm_on, ppm_every_days, created_at) < current_date),
    'expiring_60d', (select count(*) from public.service_assets where hospital_id = p_hospital and expires_on between current_date and current_date + 60));
  return r;
end $$;

create or replace function public.service_is_records_staff(p_hospital uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select c.member and c.raw_role ~* '(record|his|coder|coding)' from public.pay_user_context(p_hospital, auth.uid()) c), false)
$$;
revoke execute on function public.service_is_records_staff(uuid) from public, anon;
grant execute on function public.service_is_records_staff(uuid) to authenticated, service_role;

alter table public.service_settings enable row level security;
alter table public.service_requests enable row level security;
alter table public.service_assets enable row level security;
alter table public.service_logs enable row level security;

drop policy if exists service_settings_read on public.service_settings;
drop policy if exists service_settings_admin on public.service_settings;
create policy service_settings_read on public.service_settings for select to authenticated using (public.pay_is_member(hospital_id));
create policy service_settings_admin on public.service_settings for all to authenticated using (public.priv_is_admin(hospital_id)) with check (public.priv_is_admin(hospital_id));

drop policy if exists service_requests_read on public.service_requests;
drop policy if exists service_requests_insert on public.service_requests;
drop policy if exists service_requests_update on public.service_requests;
create policy service_requests_read on public.service_requests for select to authenticated using (
  public.pay_is_member(hospital_id) and (
    department not in ('admin', 'records') or public.priv_is_admin(hospital_id) or requested_by = auth.uid()
    or (department = 'records' and (public.clin_can_access(hospital_id)
        or public.service_is_records_staff(hospital_id)))));
create policy service_requests_insert on public.service_requests for insert to authenticated with check (public.pay_is_member(hospital_id));
create policy service_requests_update on public.service_requests for update to authenticated
  using (public.pay_is_member(hospital_id) and (department <> 'admin' or public.priv_is_admin(hospital_id)))
  with check (public.pay_is_member(hospital_id) and (department <> 'admin' or public.priv_is_admin(hospital_id)));

drop policy if exists service_assets_read on public.service_assets;
drop policy if exists service_assets_write on public.service_assets;
create policy service_assets_read on public.service_assets for select to authenticated using (public.pay_is_member(hospital_id) and (department <> 'admin' or public.priv_is_admin(hospital_id)));
create policy service_assets_write on public.service_assets for all to authenticated
  using (public.pay_is_member(hospital_id) and (department <> 'admin' or public.priv_is_admin(hospital_id)))
  with check (public.pay_is_member(hospital_id) and (department <> 'admin' or public.priv_is_admin(hospital_id)));

drop policy if exists service_logs_read on public.service_logs;
drop policy if exists service_logs_insert on public.service_logs;
drop policy if exists service_logs_close on public.service_logs;
create policy service_logs_read on public.service_logs for select to authenticated using (public.pay_is_member(hospital_id));
create policy service_logs_insert on public.service_logs for insert to authenticated with check (public.pay_is_member(hospital_id));
create policy service_logs_close on public.service_logs for update to authenticated using (public.pay_is_member(hospital_id)) with check (public.pay_is_member(hospital_id));

revoke all on public.service_settings, public.service_requests, public.service_assets, public.service_logs from anon;
grant select, insert, update on public.service_settings, public.service_requests, public.service_logs to authenticated;
grant select, insert, update, delete on public.service_assets to authenticated;
revoke delete on public.service_requests, public.service_logs from authenticated;
grant all on public.service_settings, public.service_requests, public.service_assets, public.service_logs to service_role;
grant usage, select on sequence public.service_logs_id_seq to authenticated, service_role;

revoke execute on function public.service_requests_before(), public.service_requests_after(), public.beds_turnover(),
  public.service_clean_checklist(boolean) from public, anon, authenticated;
revoke execute on function public.service_ppm_done(uuid, text, jsonb), public.exec_kpis(uuid) from public, anon;
grant execute on function public.service_ppm_done(uuid, text, jsonb), public.exec_kpis(uuid) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['service_requests', 'service_assets'] loop
    if to_regprocedure('public.audit_row_change()') is not null then
      execute format('drop trigger if exists trg_audit_change on public.%I', t);
      execute format('create trigger trg_audit_change after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
    end if;
  end loop;
end $$;

commit;

select 'service desk tables' as check_name, case when to_regclass('public.service_requests') is not null and to_regclass('public.service_assets') is not null and to_regclass('public.service_logs') is not null then 'OK' else 'PROBLEM' end as result
    union all select 'discharge creates a clean', case when exists (select 1 from pg_trigger where tgname = 'trg_beds_turnover') then 'OK' else 'SKIPPED - no beds table' end
    union all select 'internal functions server-only', case when has_function_privilege('authenticated', 'public.beds_turnover()', 'execute') then 'PROBLEM' else 'OK' end;
