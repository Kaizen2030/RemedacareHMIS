-- Dialysis: renal registry (modality, vascular access, hepatitis B status, dry weight, schedule, standing orders),
-- machines (hepatitis B-dedicated machines enforced), sessions with adequacy computed here — URR and single-pool
-- Kt/V (Daugirdas second generation) — and flags for inadequate dialysis, interdialytic weight gain, intradialytic
-- hypotension and access infection. Clinical staff only.
-- Mortuary: body register (automatic body number, one body per chamber), cause of death in the MCCD layout, personal
-- effects, post-mortem, and controlled release: identity verified, next of kin, burial permit, police clearance for
-- medico-legal cases, the mortuary bill cleared at the cashier (or waived by an administrator with a reason) and two
-- different staff (request and approval). Mortuary staff use it without access to clinical records.

-- ================================================================= dialysis
create table if not exists public.dialysis_patients (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null,
  patient_id      uuid not null,
  modality        text not null default 'HD' check (modality in ('HD', 'PD')),
  ckd_cause       text,
  started_on      date,
  dry_weight_kg   numeric,
  access_type     text check (access_type in ('AVF', 'AVG', 'tunneled_cvc', 'temporary_cvc', 'pd_catheter')),
  access_site     text,
  access_created_on date,
  hbsag           text not null default 'unknown' check (hbsag in ('negative', 'positive', 'unknown')),
  anti_hcv        text not null default 'unknown' check (anti_hcv in ('negative', 'positive', 'unknown')),
  hiv             text not null default 'unknown' check (hiv in ('negative', 'positive', 'unknown')),
  hbv_vaccinated  boolean,
  schedule_days   text[] not null default '{}',
  shift           text,
  standing_orders jsonb not null default '{}'::jsonb,   -- dialyser, duration_min, qb, qd, dialysate_k, dialysate_ca, heparin, epo, iron
  nephrologist    text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (hospital_id, patient_id)
);

create table if not exists public.dialysis_machines (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null,
  name          text not null,
  hbv_dedicated boolean not null default false,
  active        boolean not null default true,
  last_disinfected_at timestamptz,
  unique (hospital_id, name)
);

create table if not exists public.dialysis_sessions (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null,
  dialysis_patient_id uuid not null references public.dialysis_patients(id) on delete restrict,
  patient_id      uuid not null,
  session_date    date not null default current_date,
  machine_id      uuid references public.dialysis_machines(id),
  status          text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'completed', 'missed', 'cancelled')),
  started_at      timestamptz,
  ended_at        timestamptz,
  pre_weight_kg   numeric, post_weight_kg numeric,
  pre_sbp numeric, pre_dbp numeric, post_sbp numeric, post_dbp numeric, lowest_sbp numeric,
  pre_pulse numeric, post_pulse numeric, temp_c numeric,
  duration_min    numeric,
  blood_flow      numeric,
  uf_goal_l       numeric,
  uf_achieved_l   numeric,
  heparin         text,
  pre_urea        numeric, post_urea numeric,
  access_check    jsonb not null default '{}'::jsonb,     -- thrill, bruit, infection_signs, cannulation
  complications   text[] not null default '{}',
  medications     text,
  notes           text,
  missed_reason   text,
  urr             numeric,
  ktv             numeric,
  idwg_kg         numeric,                                 -- interdialytic weight gain since last session
  flags           jsonb not null default '[]'::jsonb,
  recorded_by     uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists dialysis_sessions_patient on public.dialysis_sessions(dialysis_patient_id, session_date desc);
create index if not exists dialysis_sessions_day on public.dialysis_sessions(hospital_id, session_date);

-- spKt/V, Daugirdas II: -ln(R - 0.008 t) + (4 - 3.5 R) x UF / W   (t hours, UF litres, W post-weight kg)
create or replace function public.dialysis_adequacy(p_pre numeric, p_post numeric, p_minutes numeric, p_uf numeric, p_weight numeric)
returns jsonb language plpgsql immutable as $$
declare r numeric; t numeric; ktv numeric;
begin
  if p_pre is null or p_post is null or p_pre <= 0 or p_post <= 0 or p_post >= p_pre then return jsonb_build_object('urr', null, 'ktv', null); end if;
  r := p_post / p_pre;
  t := coalesce(p_minutes, 240) / 60.0;
  if r - 0.008 * t > 0 then
    ktv := -ln(r - 0.008 * t) + case when p_weight > 0 then (4 - 3.5 * r) * coalesce(p_uf, 0) / p_weight else 0 end;
  end if;
  return jsonb_build_object('urr', round((1 - r) * 100, 1), 'ktv', round(ktv, 2));
end $$;

create or replace function public.dialysis_sessions_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare dp public.dialysis_patients; m public.dialysis_machines; a jsonb; f jsonb := '[]'; last_post numeric;
begin
  if tg_op = 'UPDATE' and old.status in ('completed', 'missed', 'cancelled') then
    if (to_jsonb(new) - array['notes', 'updated_at']) is distinct from (to_jsonb(old) - array['notes', 'updated_at']) then raise exception 'This session is closed'; end if;
    return new;
  end if;
  select * into dp from public.dialysis_patients where id = new.dialysis_patient_id;
  if dp.id is null then raise exception 'Dialysis patient not found'; end if;
  new.hospital_id := dp.hospital_id; new.patient_id := dp.patient_id; new.updated_at := now();

  if new.machine_id is not null and new.status in ('scheduled', 'in_progress', 'completed') then
    select * into m from public.dialysis_machines where id = new.machine_id and hospital_id = dp.hospital_id;
    if m.id is null then raise exception 'Machine not found'; end if;
    if dp.hbsag = 'positive' and not m.hbv_dedicated then raise exception 'Hepatitis B positive: use a hepatitis B-dedicated machine (in the isolation area)'; end if;
    if dp.hbsag <> 'positive' and m.hbv_dedicated then raise exception '% is dedicated to hepatitis B positive patients', m.name; end if;
    if dp.hbsag = 'unknown' then f := f || '["Hepatitis B status unknown: test HBsAg before the next session"]'; end if;
  end if;

  if new.status = 'in_progress' and (tg_op = 'INSERT' or old.status <> 'in_progress') then
    if new.machine_id is null then raise exception 'Choose the machine'; end if;
    if new.pre_weight_kg is null or new.pre_sbp is null then raise exception 'Record the pre-dialysis weight and blood pressure'; end if;
    new.started_at := coalesce(new.started_at, now());
  end if;
  if new.status = 'missed' and coalesce(trim(new.missed_reason), '') = '' then raise exception 'Give the reason the session was missed'; end if;

  if new.pre_weight_kg is not null then
    select s.post_weight_kg into last_post from public.dialysis_sessions s
     where s.dialysis_patient_id = new.dialysis_patient_id and s.status = 'completed' and s.id <> new.id and s.session_date <= new.session_date and s.post_weight_kg is not null
     order by s.session_date desc, s.ended_at desc nulls last limit 1;
    if last_post is not null then
      new.idwg_kg := round(new.pre_weight_kg - last_post, 1);
      if dp.dry_weight_kg > 0 and new.idwg_kg > dp.dry_weight_kg * 0.04 then f := f || jsonb_build_array('Weight gain since last session ' || new.idwg_kg || ' kg (over 4% of dry weight): fluid and salt counselling'); end if;
    end if;
  end if;

  if new.status = 'completed' then
    if new.post_weight_kg is null or new.post_sbp is null then raise exception 'Record the post-dialysis weight and blood pressure'; end if;
    new.ended_at := coalesce(new.ended_at, now());
    new.duration_min := coalesce(new.duration_min, round(extract(epoch from new.ended_at - new.started_at) / 60));
    if new.uf_achieved_l is null and new.pre_weight_kg is not null then new.uf_achieved_l := round(new.pre_weight_kg - new.post_weight_kg, 1); end if;
    if dp.dry_weight_kg > 0 and new.post_weight_kg > dp.dry_weight_kg + 0.5 then f := f || jsonb_build_array('Finished ' || round(new.post_weight_kg - dp.dry_weight_kg, 1) || ' kg above dry weight: review dry weight / extend time'); end if;
  end if;

  a := public.dialysis_adequacy(new.pre_urea, new.post_urea, new.duration_min, new.uf_achieved_l, new.post_weight_kg);
  new.urr := (a->>'urr')::numeric; new.ktv := (a->>'ktv')::numeric;
  if new.urr is not null and new.urr < 65 then f := f || jsonb_build_array('URR ' || new.urr || '% (target 65% or more): dialysis inadequate'); end if;
  if new.ktv is not null and new.ktv < 1.2 then f := f || jsonb_build_array('Kt/V ' || new.ktv || ' (target 1.2 or more): increase time, blood flow or dialyser size'); end if;
  if least(coalesce(new.lowest_sbp, 999), coalesce(new.post_sbp, 999)) < 90 or 'hypotension' = any(new.complications) then f := f || '["Intradialytic hypotension"]'; end if;
  if coalesce((new.access_check->>'infection_signs')::boolean, false) then f := f || '["Access infection signs: blood cultures and antibiotics per protocol"]'; end if;
  if new.access_check->>'thrill' = 'absent' or new.access_check->>'bruit' = 'absent' then f := f || '["No thrill / bruit: fistula may be thrombosed — urgent vascular review"]'; end if;
  new.flags := f;
  return new;
end $$;
drop trigger if exists trg_dialysis_sessions_before on public.dialysis_sessions;
create trigger trg_dialysis_sessions_before before insert or update on public.dialysis_sessions for each row execute function public.dialysis_sessions_before();

create or replace function public.dialysis_stats(p_hospital uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.clin_can_access(p_hospital) then raise exception 'Only clinical staff can see dialysis statistics'; end if;
  with s as (select * from public.dialysis_sessions where hospital_id = p_hospital and session_date between p_from and p_to)
  select jsonb_build_object(
    'sessions', (select count(*) from s where status = 'completed'),
    'missed', (select count(*) from s where status = 'missed'),
    'patients', (select count(distinct dialysis_patient_id) from s where status = 'completed'),
    'urr_measured', (select count(*) from s where urr is not null),
    'urr_median', (select percentile_cont(0.5) within group (order by urr) from s where urr is not null),
    'urr_65_pct', (select round(100.0 * count(*) filter (where urr >= 65) / nullif(count(*), 0), 0) from s where urr is not null),
    'ktv_median', (select percentile_cont(0.5) within group (order by ktv) from s where ktv is not null),
    'hypotension', (select count(*) from s where flags::text like '%hypotension%'),
    'access', (select coalesce(jsonb_object_agg(coalesce(access_type, 'unknown'), n), '{}'::jsonb) from (select access_type, count(*) n from public.dialysis_patients where hospital_id = p_hospital and active group by 1) x),
    'hbsag_unknown', (select count(*) from public.dialysis_patients where hospital_id = p_hospital and active and hbsag = 'unknown')
  ) into r;
  return r;
end $$;

-- ================================================================= mortuary
create or replace function public.mortuary_can_access(p_hospital uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.clin_can_access(p_hospital) or coalesce((select c.member and c.staff_active and lower(coalesce(c.raw_role, '')) ~ '(mortuary|morgue)'
                                                          from public.pay_user_context(p_hospital, auth.uid()) c), false)
$$;

create sequence if not exists public.mortuary_body_seq;

create table if not exists public.mortuary_bodies (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null,
  body_number        text,
  patient_id         uuid,
  deceased_name      text not null,
  sex                text check (sex in ('male', 'female', 'unknown')),
  age_years          numeric,
  national_id        text,
  died_at            timestamptz,
  place_of_death     text not null check (place_of_death in ('ward', 'emergency', 'theatre', 'brought_in_dead', 'other_facility', 'community')),
  source_ward        text,
  brought_by         text,
  medico_legal       boolean not null default false,
  police_station     text,
  police_ob_number   text,
  cause_of_death     jsonb not null default '{}'::jsonb,   -- MCCD: ia, ib, ic, id (with intervals), ii, manner, icd
  certified_by       text,
  mccd_serial        text,
  chamber            text,
  admitted_at        timestamptz not null default now(),
  identified_by      jsonb not null default '{}'::jsonb,   -- name, relationship, id_number, phone
  identity_verified  boolean not null default false,
  personal_effects   jsonb not null default '[]'::jsonb check (jsonb_typeof(personal_effects) = 'array'),
  embalmed           boolean not null default false,
  post_mortem        text not null default 'not_required' check (post_mortem in ('not_required', 'requested', 'done', 'waived')),
  post_mortem_by     text,
  status             text not null default 'in_storage' check (status in ('in_storage', 'release_requested', 'released', 'transferred')),
  next_of_kin        jsonb not null default '{}'::jsonb,   -- name, relationship, id_number, phone
  burial_permit_no   text,
  police_clearance   text,
  invoice_id         uuid,
  bill_waived_reason text,
  release_requested_by uuid,
  release_requested_at timestamptz,
  released_by        uuid,
  released_at        timestamptz,
  released_to        text,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists mortuary_bodies_number on public.mortuary_bodies(hospital_id, body_number);
create unique index if not exists mortuary_one_per_chamber on public.mortuary_bodies(hospital_id, lower(chamber)) where status in ('in_storage', 'release_requested') and chamber is not null;
create index if not exists mortuary_bodies_status on public.mortuary_bodies(hospital_id, status, admitted_at desc);

-- What still blocks release (empty array = can be released)
create or replace function public.mortuary_release_blockers(b public.mortuary_bodies)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f jsonb := '[]'; inv jsonb;
begin
  if not b.identity_verified then f := f || '["Identity not verified"]'; end if;
  if coalesce(trim(b.next_of_kin->>'name'), '') = '' or coalesce(trim(b.next_of_kin->>'id_number'), '') = '' then f := f || '["Next of kin name and ID number"]'; end if;
  if coalesce(trim(b.burial_permit_no), '') = '' and b.status <> 'transferred' then f := f || '["Burial permit number"]'; end if;
  if b.medico_legal and coalesce(trim(b.police_clearance), '') = '' then f := f || '["Police clearance (medico-legal case)"]'; end if;
  if b.medico_legal and b.post_mortem not in ('done', 'waived') then f := f || '["Post-mortem done or waived by the police"]'; end if;
  if b.post_mortem = 'requested' then f := f || '["Post-mortem requested but not done"]'; end if;
  if coalesce(trim(b.bill_waived_reason), '') = '' then
    if b.invoice_id is null then f := f || '["Mortuary bill: send it to the cashier and link the invoice"]';
    else
      select to_jsonb(i) into inv from public.invoices i where i.id = b.invoice_id;
      if inv is null then f := f || '["Mortuary invoice not found"]';
      elsif coalesce((inv->>'balance_kes')::numeric, 0) > 0 or lower(coalesce(inv->>'status', '')) !~ '^(paid|cleared|waived)$' then
        f := f || jsonb_build_array('Mortuary bill not cleared at the cashier (KES ' || coalesce(inv->>'balance_kes', '?') || ' due)');
      end if;
    end if;
  end if;
  return f;
end $$;

create or replace function public.mortuary_bodies_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare blockers jsonb;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.body_number := coalesce(nullif(trim(new.body_number), ''), 'MRT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.mortuary_body_seq')::text, 4, '0'));
    new.status := 'in_storage'; new.release_requested_by := null; new.released_by := null; new.released_at := null;
    if new.place_of_death = 'brought_in_dead' then new.medico_legal := true; end if;
    if new.medico_legal and coalesce(trim(new.police_ob_number), '') = '' then raise exception 'Medico-legal case: record the police OB number'; end if;
    return new;
  end if;
  if old.status in ('released', 'transferred') then raise exception 'This body has been released; the record is closed'; end if;
  if new.bill_waived_reason is distinct from old.bill_waived_reason and new.bill_waived_reason is not null
     and not coalesce((select c.canonical = 'admin' from public.pay_user_context(new.hospital_id, auth.uid()) c), false) then
    raise exception 'Only an administrator can waive the mortuary bill';
  end if;
  if new.status = 'release_requested' and old.status = 'in_storage' then
    blockers := public.mortuary_release_blockers(new);
    if jsonb_array_length(blockers) > 0 then raise exception 'Cannot request release yet: %', (select string_agg(value #>> '{}', '; ') from jsonb_array_elements(blockers)); end if;
    new.release_requested_by := auth.uid(); new.release_requested_at := now();
  elsif new.status in ('released', 'transferred') then
    if old.status <> 'release_requested' then raise exception 'Request release first; a second staff member then approves it'; end if;
    if new.release_requested_by = auth.uid() then raise exception 'A different staff member must approve the release'; end if;
    blockers := public.mortuary_release_blockers(new);
    if jsonb_array_length(blockers) > 0 then raise exception 'Cannot release: %', (select string_agg(value #>> '{}', '; ') from jsonb_array_elements(blockers)); end if;
    if coalesce(trim(new.released_to), '') = '' then raise exception 'Record who the body was released to'; end if;
    new.released_by := auth.uid(); new.released_at := now();
  elsif new.status = 'in_storage' and old.status = 'release_requested' then
    new.release_requested_by := null; new.release_requested_at := null;
  elsif new.status is distinct from old.status then
    raise exception 'Invalid status change';
  end if;
  if new.release_requested_by is distinct from old.release_requested_by and new.status = old.status then new.release_requested_by := old.release_requested_by; end if;
  return new;
end $$;
drop trigger if exists trg_mortuary_bodies_before on public.mortuary_bodies;
create trigger trg_mortuary_bodies_before before insert or update on public.mortuary_bodies for each row execute function public.mortuary_bodies_before();

create or replace function public.mortuary_blockers(p_body uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b public.mortuary_bodies;
begin
  select * into b from public.mortuary_bodies where id = p_body;
  if b.id is null or not public.mortuary_can_access(b.hospital_id) then raise exception 'Not found'; end if;
  return public.mortuary_release_blockers(b);
end $$;

create or replace function public.mortuary_stats(p_hospital uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.mortuary_can_access(p_hospital) then raise exception 'Not allowed'; end if;
  select jsonb_build_object(
    'admitted', (select count(*) from public.mortuary_bodies where hospital_id = p_hospital and admitted_at >= p_from and admitted_at < p_to + 1),
    'by_place', (select coalesce(jsonb_object_agg(place_of_death, n), '{}'::jsonb) from (select place_of_death, count(*) n from public.mortuary_bodies where hospital_id = p_hospital and admitted_at >= p_from and admitted_at < p_to + 1 group by 1) x),
    'medico_legal', (select count(*) from public.mortuary_bodies where hospital_id = p_hospital and medico_legal and admitted_at >= p_from and admitted_at < p_to + 1),
    'released', (select count(*) from public.mortuary_bodies where hospital_id = p_hospital and status in ('released', 'transferred') and released_at >= p_from and released_at < p_to + 1),
    'median_stay_days', (select round((percentile_cont(0.5) within group (order by extract(epoch from released_at - admitted_at) / 86400))::numeric, 1) from public.mortuary_bodies where hospital_id = p_hospital and released_at >= p_from and released_at < p_to + 1),
    'in_storage', (select count(*) from public.mortuary_bodies where hospital_id = p_hospital and status in ('in_storage', 'release_requested')),
    'unclaimed_14_days', (select count(*) from public.mortuary_bodies where hospital_id = p_hospital and status = 'in_storage' and admitted_at < now() - interval '14 days')
  ) into r;
  return r;
end $$;

-- ================================================================= access
alter table public.dialysis_patients enable row level security;
alter table public.dialysis_machines enable row level security;
alter table public.dialysis_sessions enable row level security;
alter table public.mortuary_bodies enable row level security;
drop policy if exists dialysis_patients_clinical on public.dialysis_patients;
drop policy if exists dialysis_machines_clinical on public.dialysis_machines;
drop policy if exists dialysis_sessions_clinical on public.dialysis_sessions;
drop policy if exists mortuary_bodies_staff on public.mortuary_bodies;
create policy dialysis_patients_clinical on public.dialysis_patients for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
create policy dialysis_machines_clinical on public.dialysis_machines for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
create policy dialysis_sessions_clinical on public.dialysis_sessions for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
create policy mortuary_bodies_staff on public.mortuary_bodies for all to authenticated using (public.mortuary_can_access(hospital_id)) with check (public.mortuary_can_access(hospital_id));
revoke all on public.dialysis_patients, public.dialysis_machines, public.dialysis_sessions, public.mortuary_bodies from anon;
grant select, insert, update on public.dialysis_patients, public.dialysis_machines, public.dialysis_sessions, public.mortuary_bodies to authenticated;
grant all on public.dialysis_patients, public.dialysis_machines, public.dialysis_sessions, public.mortuary_bodies to service_role;
grant usage on sequence public.mortuary_body_seq to authenticated, service_role;
revoke execute on function public.dialysis_sessions_before(), public.mortuary_bodies_before(), public.mortuary_release_blockers(public.mortuary_bodies) from public, anon, authenticated;
revoke execute on function public.dialysis_stats(uuid, date, date), public.mortuary_can_access(uuid), public.mortuary_blockers(uuid), public.mortuary_stats(uuid, date, date) from public, anon;
grant execute on function public.dialysis_stats(uuid, date, date), public.mortuary_can_access(uuid), public.mortuary_blockers(uuid), public.mortuary_stats(uuid, date, date) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['dialysis_patients', 'dialysis_sessions', 'mortuary_bodies'] loop
    if to_regprocedure('public.audit_row_change()') is not null then
      execute format('drop trigger if exists trg_audit_change on public.%I', t);
      execute format('create trigger trg_audit_change after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
    end if;
  end loop;
end $$;
