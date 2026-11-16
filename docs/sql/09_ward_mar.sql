-- =============================================================================
-- RemedacareHMS - WARD MEDICATION CHART (MAR) AND SHIFT HANDOVER
-- Generated from supabase/migrations/20261120000000_ward_mar.sql - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.clin_can_access(uuid)') is null then
    raise exception 'Run 08_hiv_tb_maternity.sql first. Nothing was changed.';
  end if;
end $$;

create table if not exists public.mar_doses (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null,
  visit_id           uuid,
  patient_id         uuid,
  prescription_id    text not null,
  drug_name          text not null,
  dose               text,
  route              text,
  prn                boolean not null default false,
  scheduled_at       timestamptz not null,
  status             text not null default 'due' check (status in ('due', 'given', 'held', 'refused', 'not_available', 'missed', 'entered_in_error')),
  administered_at    timestamptz,
  administered_by    uuid,
  administered_by_name text,
  reason             text,
  witness            text,
  notes              text,
  created_at         timestamptz not null default now(),
  unique (prescription_id, scheduled_at),
  check (status not in ('held', 'refused', 'not_available', 'entered_in_error') or nullif(trim(coalesce(reason, '')), '') is not null)
);
create index if not exists mar_doses_visit on public.mar_doses(visit_id, scheduled_at);
create index if not exists mar_doses_due on public.mar_doses(hospital_id, status, scheduled_at) where status = 'due';

/** Standard ward administration times (Nairobi) for a frequency text. Empty = PRN / not scheduled. */
create or replace function public.mar_times(p_frequency text)
returns time[] language plpgsql immutable as $$
declare f text := lower(coalesce(p_frequency, '')); n int;
begin
  if f ~ '(as needed|prn|when required|sos)' then return '{}'; end if;
  if f ~ '(stat|once only|single dose)' then return array[null::time]; end if;   -- give now
  n := nullif(substring(f from '(?:every|q)\s*(\d{1,2})\s*-?\s*h'), '')::int;
  if n is null then n := nullif(substring(f from '(\d{1,2})\s*-?\s*hourly'), '')::int; end if;
  if n = 4 then return array['02:00', '06:00', '10:00', '14:00', '18:00', '22:00']::time[]; end if;
  if n = 6 then return array['00:00', '06:00', '12:00', '18:00']::time[]; end if;
  if n = 8 then return array['06:00', '14:00', '22:00']::time[]; end if;
  if n = 12 then return array['08:00', '20:00']::time[]; end if;
  if n = 24 then return array['08:00']::time[]; end if;
  if f ~ '(qid|qds|four times)' then return array['06:00', '12:00', '18:00', '22:00']::time[]; end if;
  if f ~ '(tds|tid|three times|thrice)' then return array['06:00', '14:00', '22:00']::time[]; end if;
  if f ~ '(bd|bid|twice)' then return array['08:00', '20:00']::time[]; end if;
  if f ~ '(nocte|at night|bedtime)' then return array['22:00']::time[]; end if;
  if f ~ '(od|once daily|daily|mane|morning|once a day)' then return array['08:00']::time[]; end if;
  return '{}';
end $$;

/** Days from a duration text: "5 days", "2 weeks", "1 month". null = until stopped. */
create or replace function public.mar_duration_days(p_duration text)
returns integer language sql immutable as $$
  select case
    when p_duration ~* '(\d+)\s*(w|wk|week)' then substring(p_duration from '(\d+)')::int * 7
    when p_duration ~* '(\d+)\s*(m|month)' and p_duration !~* 'min' then substring(p_duration from '(\d+)')::int * 30
    when p_duration ~* '(\d+)\s*(d|day)?' then substring(p_duration from '(\d+)')::int
    end
$$;

/** Create the doses for the next p_hours for every active prescription of an admitted visit. */
create or replace function public.mar_generate(p_visit uuid, p_hours integer default 24)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; j jsonb; t time; d date; v_at timestamptz; v_start timestamptz; v_end timestamptz; v_hosp uuid; n int := 0;
  v_now timestamptz := now(); v_until timestamptz := now() + make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 72)));
  v_days int; v_times time[];
begin
  select hospital_id into v_hosp from public.visits where id = p_visit;
  if v_hosp is null then raise exception 'Visit not found'; end if;
  if auth.uid() is not null and not public.clin_can_access(v_hosp) then raise exception 'Clinical access required'; end if;
  for r in select * from public.prescriptions p where p.visit_id = p_visit loop
    j := to_jsonb(r);
    continue when coalesce(j->>'status', 'Pending') in ('Rejected', 'Cancelled', 'Stopped', 'Draft');
    v_times := public.mar_times(j->>'frequency');
    continue when array_length(v_times, 1) is null;
    v_start := coalesce(nullif(j->>'dispensed_at', '')::timestamptz, nullif(j->>'created_at', '')::timestamptz, v_now);
    v_days := public.mar_duration_days(j->>'duration');
    v_end := case when v_days is null then null else v_start + make_interval(days => v_days) end;
    if v_times[1] is null then
      insert into public.mar_doses(hospital_id, visit_id, patient_id, prescription_id, drug_name, dose, route, scheduled_at)
      values (v_hosp, p_visit, nullif(j->>'patient_id', '')::uuid, j->>'id', coalesce(j->>'drug_name', 'Drug'), j->>'dosage', j->>'route', v_start)
      on conflict (prescription_id, scheduled_at) do nothing;
      if found then n := n + 1; end if;
      continue;
    end if;
    d := (greatest(v_start, v_now - interval '12 hours') at time zone 'Africa/Nairobi')::date;
    while (d::timestamp at time zone 'Africa/Nairobi') < v_until loop
      foreach t in array v_times loop
        v_at := (d + t) at time zone 'Africa/Nairobi';
        if v_at >= v_start - interval '30 minutes' and v_at >= v_now - interval '12 hours' and v_at < v_until
           and (v_end is null or v_at < v_end) then
          insert into public.mar_doses(hospital_id, visit_id, patient_id, prescription_id, drug_name, dose, route, scheduled_at)
          values (v_hosp, p_visit, nullif(j->>'patient_id', '')::uuid, j->>'id', coalesce(j->>'drug_name', 'Drug'), j->>'dosage', j->>'route', v_at)
          on conflict (prescription_id, scheduled_at) do nothing;
          if found then n := n + 1; end if;
        end if;
      end loop;
      d := d + 1;
    end loop;
  end loop;
  return n;
end $$;

create or replace function public.mar_doses_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if tg_op = 'UPDATE' and old.status = 'entered_in_error' then raise exception 'A dose marked in error cannot be changed'; end if;
  if tg_op = 'UPDATE' and old.status not in ('due', 'missed') and new.status <> 'entered_in_error'
     and (new.status is distinct from old.status or new.administered_at is distinct from old.administered_at or new.reason is distinct from old.reason) then
    raise exception 'This dose is already documented (%). To correct it, mark it "entered in error" with a reason.', old.status;
  end if;
  if new.status in ('given', 'held', 'refused', 'not_available') and (tg_op = 'INSERT' or old.status in ('due', 'missed')) then
    new.administered_at := coalesce(new.administered_at, now());
    new.administered_by := coalesce(auth.uid(), new.administered_by);
    if new.administered_by_name is null and auth.uid() is not null then
      select s.full_name into v_name from public.staff s join auth.users u on lower(u.email) = lower(s.email)
       where u.id = auth.uid() and s.hospital_id = new.hospital_id limit 1;
      new.administered_by_name := v_name;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_mar_doses_before on public.mar_doses;
create trigger trg_mar_doses_before before insert or update on public.mar_doses
  for each row execute function public.mar_doses_before();

create or replace function public.mar_flag_missed(p_after interval default interval '4 hours')
returns integer language sql security definer set search_path = public as $$
  with u as (update public.mar_doses set status = 'missed', reason = coalesce(reason, 'Not documented within ' || p_after::text)
              where status = 'due' and not prn and scheduled_at < now() - p_after returning 1)
  select count(*)::int from u
$$;

create table if not exists public.ward_handovers (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid not null,
  ward_id          text,
  ward_name        text,
  shift            text not null check (shift in ('day', 'night', 'other')),
  handover_at      timestamptz not null default now(),
  from_nurse       text not null,
  to_nurse         text,
  summary          text,
  patients         jsonb not null default '[]',     -- [{bed, patient, meds_due, meds_missed, notes}]
  created_by       uuid default auth.uid(),
  acknowledged_by  uuid,
  acknowledged_at  timestamptz
);

alter table public.mar_doses enable row level security;
alter table public.ward_handovers enable row level security;
drop policy if exists mar_doses_clinical on public.mar_doses;
create policy mar_doses_clinical on public.mar_doses for all using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
drop policy if exists ward_handovers_clinical on public.ward_handovers;
create policy ward_handovers_clinical on public.ward_handovers for all using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
grant select, insert, update on public.mar_doses, public.ward_handovers to authenticated;
revoke delete on public.mar_doses from authenticated;
grant all on public.mar_doses, public.ward_handovers to service_role;

revoke execute on function public.mar_flag_missed(interval) from public, anon, authenticated;
grant execute on function public.mar_flag_missed(interval) to service_role;
grant execute on function public.mar_generate(uuid, integer), public.mar_times(text), public.mar_duration_days(text) to authenticated, service_role;

commit;

select 'tables' as check_name, case when to_regclass('public.mar_doses') is not null and to_regclass('public.ward_handovers') is not null then 'OK' else 'PROBLEM' end as result
    union all select 'documented doses protected', case when exists (select 1 from pg_trigger where tgname = 'trg_mar_doses_before') then 'OK' else 'PROBLEM' end
    union all select 'TDS → 06:00, 14:00, 22:00', case when public.mar_times('TDS') = array['06:00', '14:00', '22:00']::time[] then 'OK' else 'PROBLEM' end;
