-- Blood transfusion closed loop: the doctor's request -> patient grouping (two samples confirm; any disagreement blocks
-- issue) -> crossmatch reserves the unit -> issue only against the request (component-specific ABO rules; emergency
-- group-O release) -> bedside two-person check (bag number and patient number must match the issue) with baseline and
-- 15-minute observations -> completion or reaction (haemovigilance) -> donors with deferral and TTI screening.
-- Self-contained: creates the original blood bank tables if they are missing and replaces their safety triggers.

alter table public.patients add column if not exists blood_group text;

create table if not exists public.blood_bank_units (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  unit_reference text not null,
  blood_group text not null check (blood_group in ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+')),
  component text not null,
  status text not null default 'Pending' check (status in ('Pending', 'Quarantine', 'Available', 'Reserved', 'Issued', 'Discarded')),
  screening_status text not null default 'pending' check (screening_status in ('pending', 'recheck', 'clear')),
  expiry_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hospital_id, unit_reference)
);
alter table public.blood_bank_units add column if not exists created_by uuid;
alter table public.blood_bank_units add column if not exists issued_to_patient_id uuid;
alter table public.blood_bank_units add column if not exists issued_by uuid;
alter table public.blood_bank_units add column if not exists issued_at timestamptz;
do $$ begin
  alter table public.blood_bank_units add constraint blood_bank_units_issued_to_patient_id_fkey foreign key (issued_to_patient_id) references public.patients(id) on delete restrict;
exception when duplicate_object or duplicate_table then null;
end $$;

create table if not exists public.blood_crossmatches (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  blood_unit_id uuid not null references public.blood_bank_units(id) on delete restrict,
  patient_id uuid not null,
  result text not null check (result in ('Compatible', 'Incompatible')),
  method text not null check (method in ('Tube', 'Gel card', 'Solid phase')),
  performed_by uuid,
  performed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '72 hours'),
  created_at timestamptz not null default now()
);
alter table public.blood_bank_units add column if not exists issued_crossmatch_id uuid references public.blood_crossmatches(id) on delete restrict;

create table if not exists public.blood_requests (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid not null,
  patient_id        uuid not null references public.patients(id) on delete restrict,
  visit_id          text,
  component         text not null check (component in ('Packed Red Cells', 'Whole Blood', 'Fresh Frozen Plasma', 'Platelets', 'Cryoprecipitate')),
  units             smallint not null default 1 check (units between 1 and 20),
  urgency           text not null default 'routine' check (urgency in ('routine', 'urgent', 'emergency')),
  emergency_release boolean not null default false,       -- uncrossmatched group O red cells, signed by the requesting doctor
  indication        text not null,
  hb                numeric,
  platelet_count    numeric,
  inr               numeric,
  consent           text not null check (consent in ('obtained', 'emergency_no_consent', 'refused')),
  required_by       timestamptz,
  location          text,
  requested_by      uuid default auth.uid(),
  requested_by_name text,
  status            text not null default 'requested' check (status in ('requested', 'sample_received', 'ready', 'issued', 'completed', 'cancelled')),
  sample_received_at timestamptz,
  cancel_reason     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists blood_requests_open on public.blood_requests(hospital_id, status, created_at desc);

alter table public.blood_bank_units add column if not exists request_id uuid references public.blood_requests(id) on delete restrict;
alter table public.blood_bank_units add column if not exists reserved_for_patient_id uuid;
alter table public.blood_bank_units add column if not exists emergency_release boolean not null default false;
alter table public.blood_bank_units add column if not exists discard_reason text;
alter table public.blood_bank_units add column if not exists volume_ml numeric;
alter table public.blood_bank_units add column if not exists donation_id uuid;
alter table public.blood_crossmatches add column if not exists request_id uuid;
create index if not exists blood_bank_units_hospital_status_idx on public.blood_bank_units (hospital_id, status, blood_group);
create index if not exists blood_crossmatches_lookup_idx on public.blood_crossmatches (hospital_id, blood_unit_id, patient_id, performed_at desc);

create table if not exists public.blood_group_tests (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null,
  patient_id   uuid not null references public.patients(id) on delete restrict,
  sample_ref   text not null,                     -- each confirming test must be a separately collected sample
  abo          text not null check (abo in ('O', 'A', 'B', 'AB')),
  rh           text not null check (rh in ('pos', 'neg')),
  result_group text,
  antibody_screen text not null default 'not_done' check (antibody_screen in ('negative', 'positive', 'not_done')),
  antibodies   text,
  method       text,
  tested_by    uuid default auth.uid(),
  tested_by_name text,
  tested_at    timestamptz not null default now(),
  void_reason  text,                              -- e.g. wrong blood in tube; a voided test no longer counts
  voided_at    timestamptz
);
create unique index if not exists blood_group_tests_sample on public.blood_group_tests(patient_id, lower(sample_ref)) where void_reason is null;

create table if not exists public.blood_transfusions (
  id                     uuid primary key default gen_random_uuid(),
  hospital_id            uuid not null,
  unit_id                uuid not null unique references public.blood_bank_units(id) on delete restrict,
  patient_id             uuid not null references public.patients(id) on delete restrict,
  request_id             uuid,
  scanned_unit_ref       text not null,
  scanned_patient_number text not null,
  id_band_checked        boolean not null default false,
  checker1_name          text not null,
  checker2_name          text not null,
  started_at             timestamptz not null default now(),
  baseline               jsonb not null,              -- temp, hr, sbp, rr, spo2
  obs_15                 jsonb,                       -- 15 minutes after the start
  obs                    jsonb not null default '[]'::jsonb check (jsonb_typeof(obs) = 'array'),
  ended_at               timestamptz,
  volume_ml              numeric,
  status                 text not null default 'in_progress' check (status in ('in_progress', 'completed', 'stopped')),
  stop_reason            text,
  reaction               boolean not null default false,
  flags                  jsonb not null default '[]'::jsonb,
  notes                  text,
  recorded_by            uuid default auth.uid(),
  created_at             timestamptz not null default now()
);
create index if not exists blood_transfusions_patient on public.blood_transfusions(hospital_id, patient_id, started_at desc);

create table if not exists public.blood_reactions (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null,
  transfusion_id  uuid not null references public.blood_transfusions(id) on delete restrict,
  unit_id         uuid references public.blood_bank_units(id) on delete restrict,
  patient_id      uuid references public.patients(id) on delete restrict,
  onset_at        timestamptz not null default now(),
  reaction_type   text not null check (reaction_type in ('febrile_non_haemolytic', 'allergic_minor', 'anaphylaxis', 'acute_haemolytic', 'delayed_haemolytic',
                                                        'taco', 'trali', 'bacterial_contamination', 'hypotensive', 'other')),
  severity        text not null check (severity in ('non_severe', 'severe', 'life_threatening', 'death')),
  symptoms        jsonb not null default '[]'::jsonb,
  actions         text not null,
  imputability    text check (imputability in ('excluded', 'unlikely', 'possible', 'probable', 'certain')),
  unit_returned   boolean not null default false,
  samples_sent    boolean not null default false,
  reported_externally_at timestamptz,             -- national haemovigilance (KNBTS / Kenya Blood Transfusion Service)
  reported_by     uuid default auth.uid(),
  created_at      timestamptz not null default now()
);

create table if not exists public.blood_donors (
  id                   uuid primary key default gen_random_uuid(),
  hospital_id          uuid not null,
  donor_number         text,
  full_name            text not null,
  national_id          text,
  phone                text,
  sex                  text not null check (sex in ('male', 'female')),
  date_of_birth        date not null,
  blood_group          text check (blood_group in ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+')),
  permanently_deferred boolean not null default false,
  deferral_reason      text,
  deferred_until       date,
  last_donation_at     timestamptz,
  created_at           timestamptz not null default now()
);
create unique index if not exists blood_donors_national_id on public.blood_donors(hospital_id, national_id) where national_id is not null;

create table if not exists public.blood_donations (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid not null,
  donor_id         uuid not null references public.blood_donors(id) on delete restrict,
  donated_at       timestamptz not null default now(),
  weight_kg        numeric,
  hb               numeric,
  bp_sys           numeric,
  bp_dia           numeric,
  temp             numeric,
  questionnaire_ok boolean not null default false,
  outcome          text not null check (outcome in ('donated', 'deferred')),
  deferral_reason  text,
  deferral_until   date,
  blood_group      text check (blood_group in ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+')),
  unit_reference   text,
  volume_ml        numeric default 450,
  unit_id          uuid,
  tti              jsonb not null default '{}'::jsonb,   -- hiv, hbv, hcv, syphilis: negative | reactive | pending
  recorded_by      uuid default auth.uid(),
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------- helpers
create or replace function public.blood_groups_compatible(donor_group text, recipient_group text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select case upper(replace(coalesce(donor_group, ''), ' ', ''))
    when 'O-' then upper(replace(coalesce(recipient_group, ''), ' ', '')) in ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+')
    when 'O+' then upper(replace(coalesce(recipient_group, ''), ' ', '')) in ('O+', 'A+', 'B+', 'AB+')
    when 'A-' then upper(replace(coalesce(recipient_group, ''), ' ', '')) in ('A-', 'A+', 'AB-', 'AB+')
    when 'A+' then upper(replace(coalesce(recipient_group, ''), ' ', '')) in ('A+', 'AB+')
    when 'B-' then upper(replace(coalesce(recipient_group, ''), ' ', '')) in ('B-', 'B+', 'AB-', 'AB+')
    when 'B+' then upper(replace(coalesce(recipient_group, ''), ' ', '')) in ('B+', 'AB+')
    when 'AB-' then upper(replace(coalesce(recipient_group, ''), ' ', '')) in ('AB-', 'AB+')
    when 'AB+' then upper(replace(coalesce(recipient_group, ''), ' ', '')) = 'AB+'
    else false end
$$;

-- Plasma / cryo: the reverse of red cells (AB plasma suits everyone; O plasma only O patients). Rh does not matter.
create or replace function public.blood_plasma_compatible(donor_group text, recipient_group text)
returns boolean language sql immutable as $$
  select case regexp_replace(upper(coalesce(donor_group, '')), '[+-]$', '')
    when 'AB' then true
    when 'A' then regexp_replace(upper(coalesce(recipient_group, '')), '[+-]$', '') in ('A', 'O')
    when 'B' then regexp_replace(upper(coalesce(recipient_group, '')), '[+-]$', '') in ('B', 'O')
    when 'O' then regexp_replace(upper(coalesce(recipient_group, '')), '[+-]$', '') = 'O'
    else false end
$$;

-- Lab grouping status for a patient: none | single | confirmed (two samples agree) | discrepant
create or replace function public.blood_group_status(p_patient uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'status', case when count(*) = 0 then 'none' when count(distinct result_group) > 1 then 'discrepant' when count(*) = 1 then 'single' else 'confirmed' end,
    'group', case when count(distinct result_group) = 1 then min(result_group) end,
    'samples', count(*),
    'antibodies', bool_or(antibody_screen = 'positive'))
    from public.blood_group_tests where patient_id = p_patient and void_reason is null and public.clin_can_access(hospital_id)
$$;

create or replace function public.blood_is_staff(p_hospital uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select c.member and c.staff_active and (c.canonical = 'admin' or lower(coalesce(c.raw_role, '')) ~ '(lab|transfusion|mlt|blood|haemat|hemat|scientist)')
                     from public.pay_user_context(p_hospital, auth.uid()) c), false)
$$;

-- ---------------------------------------------------------------- requests
create or replace function public.blood_requests_before()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    if coalesce(trim(new.indication), '') = '' then raise exception 'Give the clinical indication for transfusion'; end if;
    if new.consent = 'refused' then raise exception 'The patient has refused transfusion: do not request blood; document alternatives'; end if;
    if new.emergency_release and (new.urgency <> 'emergency' or new.component not in ('Packed Red Cells', 'Whole Blood')) then
      raise exception 'Emergency (uncrossmatched) release is only for emergency red-cell requests';
    end if;
    new.status := 'requested';
    return new;
  end if;
  if old.status in ('completed', 'cancelled') and new.status is distinct from old.status then raise exception 'This request is closed'; end if;
  if (to_jsonb(new) - array['status', 'sample_received_at', 'cancel_reason', 'updated_at']) is distinct from (to_jsonb(old) - array['status', 'sample_received_at', 'cancel_reason', 'updated_at']) then
    raise exception 'A request cannot be edited after it is sent; cancel it and request again';
  end if;
  if new.status = 'sample_received' and old.status <> 'sample_received' then new.sample_received_at := coalesce(new.sample_received_at, now()); end if;
  if new.status = 'cancelled' and coalesce(trim(new.cancel_reason), '') = '' then raise exception 'Give the reason for cancelling'; end if;
  return new;
end $$;
drop trigger if exists trg_blood_requests_before on public.blood_requests;
create trigger trg_blood_requests_before before insert or update on public.blood_requests for each row execute function public.blood_requests_before();

-- ---------------------------------------------------------------- grouping
create or replace function public.blood_group_tests_before()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - array['void_reason', 'voided_at']) is distinct from (to_jsonb(old) - array['void_reason', 'voided_at']) or old.void_reason is not null then
      raise exception 'Grouping results cannot be changed; void the test with a reason and regroup';
    end if;
    if coalesce(trim(new.void_reason), '') = '' then raise exception 'Give the reason for voiding'; end if;
    new.voided_at := now();
    return new;
  end if;
  if coalesce(trim(new.sample_ref), '') = '' then raise exception 'Record the sample number'; end if;
  new.result_group := new.abo || case new.rh when 'pos' then '+' else '-' end;
  new.tested_at := now();
  return new;
end $$;
drop trigger if exists trg_blood_group_tests_before on public.blood_group_tests;
create trigger trg_blood_group_tests_before before insert or update on public.blood_group_tests for each row execute function public.blood_group_tests_before();

create or replace function public.blood_group_tests_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare st jsonb := public.blood_group_status(new.patient_id);
begin
  if st->>'status' in ('single', 'confirmed') then
    update public.patients set blood_group = st->>'group' where id = new.patient_id and blood_group is distinct from st->>'group';
  elsif st->>'status' = 'discrepant' and tg_op = 'INSERT' then
    begin
      execute 'insert into public.notifications(hospital_id, notification_type, title, message, target_path, payload_json) values ($1, ''alert'', ''Blood group discrepancy'', $2, ''/blood-bank'', $3)'
        using new.hospital_id, 'Sample ' || new.sample_ref || ' groups as ' || new.result_group || ', which disagrees with an earlier sample. Possible wrong blood in tube: recollect.',
              jsonb_build_object('patient_id', new.patient_id);
    exception when others then raise warning 'discrepancy notification skipped: %', sqlerrm;
    end;
  end if;
  return null;
end $$;
drop trigger if exists trg_blood_group_tests_after on public.blood_group_tests;
create trigger trg_blood_group_tests_after after insert or update on public.blood_group_tests for each row execute function public.blood_group_tests_after();

-- ---------------------------------------------------------------- crossmatch
create or replace function public.prevent_blood_crossmatch_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Crossmatch results are immutable; record a new test instead';
end $$;
drop trigger if exists blood_crossmatches_immutable on public.blood_crossmatches;
create trigger blood_crossmatches_immutable before update or delete on public.blood_crossmatches for each row execute function public.prevent_blood_crossmatch_mutation();

create or replace function public.validate_blood_crossmatch()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.blood_bank_units; st jsonb;
begin
  select * into u from public.blood_bank_units where id = new.blood_unit_id and hospital_id = new.hospital_id;
  if u.id is null then raise exception 'Blood unit must belong to the selected hospital'; end if;
  if lower(u.component) not in ('packed red cells', 'whole blood') then raise exception 'Crossmatch is for red cells and whole blood only'; end if;
  if u.status not in ('Available', 'Reserved') or u.screening_status <> 'clear' or u.expiry_at <= now() then
    raise exception 'Crossmatch requires an available, screened, unexpired unit';
  end if;
  if u.status = 'Reserved' and u.reserved_for_patient_id is distinct from new.patient_id then raise exception 'This unit is reserved for another patient'; end if;
  st := public.blood_group_status(new.patient_id);
  if st->>'status' = 'discrepant' then raise exception 'Blood group discrepancy for this patient: recollect a sample and regroup first'; end if;
  if st->>'status' = 'none' then raise exception 'Group the patient in the laboratory before crossmatching'; end if;
  if new.result = 'Compatible' and not public.blood_groups_compatible(u.blood_group, st->>'group') then
    raise exception 'A crossmatch cannot be Compatible when the ABO/Rh groups are incompatible';
  end if;
  new.performed_by := auth.uid();
  new.performed_at := now();
  new.expires_at := now() + interval '72 hours';
  return new;
end $$;
drop trigger if exists blood_crossmatches_validate on public.blood_crossmatches;
create trigger blood_crossmatches_validate before insert on public.blood_crossmatches for each row execute function public.validate_blood_crossmatch();

create or replace function public.blood_crossmatches_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.result = 'Compatible' then
    update public.blood_bank_units set status = 'Reserved', reserved_for_patient_id = new.patient_id where id = new.blood_unit_id and status in ('Available', 'Reserved');
    if new.request_id is not null then
      update public.blood_requests set status = 'ready' where id = new.request_id and status in ('requested', 'sample_received');
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_blood_crossmatches_after on public.blood_crossmatches;
create trigger trg_blood_crossmatches_after after insert on public.blood_crossmatches for each row execute function public.blood_crossmatches_after();

-- ---------------------------------------------------------------- units: stock rules and issue
create or replace function public.enforce_blood_bank_unit_safety()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare rq public.blood_requests; st jsonb; recipient text; comp text := lower(coalesce(new.component, '')); n int; xm uuid;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('Pending', 'Quarantine') then raise exception 'New blood units must enter inventory as Pending or Quarantine'; end if;
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.issued_to_patient_id := null; new.issued_by := null; new.issued_at := null; new.issued_crossmatch_id := null;
    new.reserved_for_patient_id := null; new.request_id := null; new.emergency_release := false;
    new.updated_at := now();
    return new;
  end if;

  new.created_by := old.created_by;
  if new.id is distinct from old.id or new.hospital_id is distinct from old.hospital_id then raise exception 'Blood unit identity and hospital cannot be changed'; end if;
  if new.unit_reference is distinct from old.unit_reference or new.blood_group is distinct from old.blood_group
     or new.component is distinct from old.component or new.expiry_at is distinct from old.expiry_at then
    raise exception 'Blood unit identity, component, group, and expiry are immutable after registration';
  end if;
  if old.status = 'Discarded' then raise exception 'Discarded blood units are final'; end if;

  if old.status = 'Issued' then
    if new.status = 'Issued' then
      if (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then raise exception 'Issued blood units cannot be changed'; end if;
      return new;
    elsif new.status = 'Available' then
      if now() - old.issued_at > interval '30 minutes' then raise exception 'Returned more than 30 minutes after issue: the cold chain cannot be assured — discard the unit'; end if;
      if exists (select 1 from public.blood_transfusions t where t.unit_id = new.id) then raise exception 'A transfusion has already started from this unit'; end if;
      new.issued_to_patient_id := null; new.issued_by := null; new.issued_at := null; new.issued_crossmatch_id := null;
      new.request_id := null; new.reserved_for_patient_id := null; new.emergency_release := false;
    elsif new.status = 'Discarded' then
      if coalesce(trim(new.discard_reason), '') = '' then raise exception 'Give the reason for discarding'; end if;
      new.updated_at := now();
      return new;
    else
      raise exception 'Invalid status transition from Issued';
    end if;
  elsif old.status = 'Pending' and new.status not in ('Pending', 'Quarantine', 'Available', 'Discarded') then raise exception 'Invalid status transition from Pending';
  elsif old.status = 'Quarantine' and new.status not in ('Quarantine', 'Available', 'Discarded') then raise exception 'Invalid status transition from Quarantine';
  elsif old.status = 'Available' and new.status not in ('Available', 'Reserved', 'Issued', 'Quarantine', 'Discarded') then raise exception 'Invalid status transition from Available';
  elsif old.status = 'Reserved' and new.status not in ('Reserved', 'Available', 'Issued', 'Quarantine', 'Discarded') then raise exception 'Invalid status transition from Reserved';
  end if;

  if new.screening_status is distinct from old.screening_status and old.status in ('Available', 'Reserved') and new.screening_status <> 'clear' then
    new.status := 'Quarantine';
  end if;
  if new.status = 'Discarded' and coalesce(trim(new.discard_reason), '') = '' then raise exception 'Give the reason for discarding (expired, damaged bag, reactive screening, …)'; end if;
  if new.status in ('Available', 'Reserved', 'Issued') then
    if new.screening_status <> 'clear' then raise exception 'Blood unit screening must be clear before availability or issue'; end if;
    if new.expiry_at <= now() then raise exception 'Expired blood units cannot be made available or issued'; end if;
  end if;
  if new.status not in ('Reserved', 'Issued') then new.reserved_for_patient_id := null; end if;

  if new.status = 'Issued' and old.status <> 'Issued' then
    if new.issued_to_patient_id is null then raise exception 'Select and record the recipient patient before issuing blood'; end if;
    if new.request_id is null then raise exception 'Issue against the doctor''s transfusion request'; end if;
    select * into rq from public.blood_requests where id = new.request_id and hospital_id = new.hospital_id;
    if rq.id is null or rq.patient_id is distinct from new.issued_to_patient_id then raise exception 'The transfusion request is for a different patient'; end if;
    if rq.status in ('cancelled', 'completed') then raise exception 'This transfusion request is closed'; end if;
    if not (lower(rq.component) = comp or (rq.component = 'Packed Red Cells' and comp = 'whole blood')) then
      raise exception 'The request is for %; this unit is %', rq.component, new.component;
    end if;
    select count(*) into n from public.blood_bank_units u where u.request_id = rq.id and u.status = 'Issued' and u.id <> new.id;
    if n >= rq.units then raise exception 'All % unit(s) on this request have been issued; the doctor must request more', rq.units; end if;
    if old.reserved_for_patient_id is not null and old.reserved_for_patient_id is distinct from new.issued_to_patient_id then
      raise exception 'This unit is crossmatched and reserved for another patient';
    end if;
    if not exists (select 1 from public.patients p where p.id = new.issued_to_patient_id and p.hospital_id = new.hospital_id) then
      raise exception 'The recipient must be a patient of this hospital';
    end if;
    st := public.blood_group_status(new.issued_to_patient_id);
    recipient := st->>'group';

    if comp in ('packed red cells', 'whole blood') then
      if rq.emergency_release and new.issued_crossmatch_id is null then
        if new.blood_group not in ('O-', 'O+') then raise exception 'Emergency (uncrossmatched) release is group O red cells only'; end if;
        if new.blood_group = 'O+' and (recipient is null or recipient like '%-') then raise exception 'Use O negative while the patient''s group is unknown or Rh negative'; end if;
        new.emergency_release := true;
      else
        if st->>'status' = 'discrepant' then raise exception 'Blood group discrepancy for this patient: recollect a sample and regroup before issuing'; end if;
        if recipient is null then raise exception 'Group the patient in the laboratory before issuing (or use emergency release)'; end if;
        if not public.blood_groups_compatible(new.blood_group, recipient) then raise exception 'Blood group % is incompatible with the patient (%)', new.blood_group, recipient; end if;
        if comp = 'whole blood' and regexp_replace(new.blood_group, '[+-]$', '') <> regexp_replace(recipient, '[+-]$', '') then
          raise exception 'Whole blood must be the same ABO group as the patient';
        end if;
        if new.issued_crossmatch_id is null then raise exception 'Select a current Compatible crossmatch before issuing this unit'; end if;
        select x.id into xm from public.blood_crossmatches x
         where x.id = new.issued_crossmatch_id and x.hospital_id = new.hospital_id and x.blood_unit_id = new.id
           and x.patient_id = new.issued_to_patient_id and x.result = 'Compatible' and x.expires_at > now();
        if xm is null then raise exception 'The selected Compatible crossmatch is missing, expired, or belongs to another unit or patient'; end if;
      end if;
    elsif comp ~ '(plasma|cryo)' then
      if st->>'status' = 'discrepant' then raise exception 'Blood group discrepancy for this patient: recollect a sample and regroup before issuing'; end if;
      if recipient is null then raise exception 'Group the patient before issuing plasma (or issue group AB plasma)'; end if;
      if not public.blood_plasma_compatible(new.blood_group, recipient) then raise exception 'Plasma group % is not compatible with the patient (%)', new.blood_group, recipient; end if;
    end if;
    new.issued_by := auth.uid();
    new.issued_at := now();
  elsif new.status <> 'Issued' and old.status <> 'Issued' then
    new.issued_by := old.issued_by; new.issued_at := old.issued_at; new.issued_crossmatch_id := old.issued_crossmatch_id;
    new.issued_to_patient_id := old.issued_to_patient_id; new.request_id := old.request_id; new.emergency_release := old.emergency_release;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists blood_bank_units_safety_guard on public.blood_bank_units;
create trigger blood_bank_units_safety_guard before insert or update on public.blood_bank_units for each row execute function public.enforce_blood_bank_unit_safety();

create or replace function public.blood_bank_units_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'Issued' and old.status is distinct from 'Issued' and new.request_id is not null then
    update public.blood_requests set status = 'issued' where id = new.request_id and status in ('requested', 'sample_received', 'ready');
  end if;
  return null;
end $$;
drop trigger if exists trg_blood_bank_units_after on public.blood_bank_units;
create trigger trg_blood_bank_units_after after update on public.blood_bank_units for each row execute function public.blood_bank_units_after();

-- ---------------------------------------------------------------- bedside
create or replace function public.blood_transfusions_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare u public.blood_bank_units; pj jsonb; b jsonb; o jsonb; f jsonb := '[]';
begin
  if tg_op = 'INSERT' then
    select * into u from public.blood_bank_units where id = new.unit_id;
    if u.id is null or u.status <> 'Issued' then raise exception 'This unit has not been issued by the blood bank'; end if;
    if u.issued_to_patient_id is distinct from new.patient_id then raise exception 'WRONG PATIENT: this unit was issued for another patient. Do not transfuse; return it to the blood bank'; end if;
    if upper(trim(new.scanned_unit_ref)) <> upper(trim(u.unit_reference)) then
      raise exception 'The number on the bag (%) does not match the issued unit. Do not transfuse', new.scanned_unit_ref;
    end if;
    select to_jsonb(p) into pj from public.patients p where p.id = new.patient_id;
    if upper(trim(new.scanned_patient_number)) not in (upper(coalesce(pj->>'patient_number', '')), upper(pj->>'id')) then
      raise exception 'The patient number on the identity band does not match the patient this unit was issued for. Do not transfuse';
    end if;
    if not new.id_band_checked then raise exception 'Check the identity band (name, number, date of birth) against the bag label at the bedside'; end if;
    if coalesce(trim(new.checker1_name), '') = '' or coalesce(trim(new.checker2_name), '') = '' or lower(trim(new.checker1_name)) = lower(trim(new.checker2_name)) then
      raise exception 'Two different staff must do the bedside check';
    end if;
    if u.expiry_at <= now() then raise exception 'This unit has expired. Do not transfuse'; end if;
    b := new.baseline;
    if coalesce(b->>'temp', '') = '' or coalesce(b->>'hr', '') = '' or coalesce(b->>'sbp', '') = '' then raise exception 'Record baseline temperature, pulse and blood pressure before starting'; end if;
    new.hospital_id := u.hospital_id; new.request_id := u.request_id;
    new.started_at := now(); new.status := 'in_progress'; new.obs_15 := null; new.ended_at := null;
    if now() - u.issued_at > interval '30 minutes' then f := f || '["Started more than 30 minutes after leaving the blood bank"]'; end if;
    new.flags := f;
    return new;
  end if;

  if old.status <> 'in_progress' then
    if (to_jsonb(new) - array['reaction', 'notes']) is distinct from (to_jsonb(old) - array['reaction', 'notes']) then raise exception 'This transfusion record is closed'; end if;
    return new;
  end if;
  if new.unit_id is distinct from old.unit_id or new.patient_id is distinct from old.patient_id or new.started_at is distinct from old.started_at
     or new.baseline is distinct from old.baseline or new.checker1_name is distinct from old.checker1_name or new.checker2_name is distinct from old.checker2_name
     or new.scanned_unit_ref is distinct from old.scanned_unit_ref or new.scanned_patient_number is distinct from old.scanned_patient_number then
    raise exception 'The bedside check cannot be changed';
  end if;
  f := old.flags;
  if new.obs_15 is not null and old.obs_15 is null then
    b := old.baseline; o := new.obs_15;
    if coalesce(o->>'temp', '') = '' or coalesce(o->>'hr', '') = '' or coalesce(o->>'sbp', '') = '' then raise exception 'Record temperature, pulse and blood pressure at 15 minutes'; end if;
    if (o->>'temp')::numeric - (b->>'temp')::numeric >= 1 or (o->>'temp')::numeric >= 39
       or (b->>'sbp')::numeric - (o->>'sbp')::numeric >= 30 or (o->>'hr')::numeric - (b->>'hr')::numeric >= 30 then
      f := f || '["Possible reaction at 15 minutes: stop the transfusion, keep the line open with saline and call the doctor"]';
    end if;
  end if;
  if new.status = 'completed' then
    if new.obs_15 is null then raise exception 'Record the 15-minute observations before completing'; end if;
    new.ended_at := coalesce(new.ended_at, now());
    if new.volume_ml is null then raise exception 'Record the volume transfused'; end if;
    if new.ended_at - new.started_at > interval '4 hours' then f := f || '["Took longer than 4 hours"]'; end if;
  elsif new.status = 'stopped' then
    if coalesce(trim(new.stop_reason), '') = '' then raise exception 'Give the reason for stopping'; end if;
    new.ended_at := coalesce(new.ended_at, now());
  end if;
  new.flags := f;
  return new;
end $$;
drop trigger if exists trg_blood_transfusions_before on public.blood_transfusions;
create trigger trg_blood_transfusions_before before insert or update on public.blood_transfusions for each row execute function public.blood_transfusions_before();

create or replace function public.blood_transfusions_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare rq public.blood_requests;
begin
  if new.status = 'completed' and old.status = 'in_progress' and new.request_id is not null then
    select * into rq from public.blood_requests where id = new.request_id;
    if (select count(*) from public.blood_transfusions t where t.request_id = rq.id and t.status = 'completed') >= rq.units then
      update public.blood_requests set status = 'completed' where id = rq.id and status not in ('completed', 'cancelled');
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_blood_transfusions_after on public.blood_transfusions;
create trigger trg_blood_transfusions_after after update on public.blood_transfusions for each row execute function public.blood_transfusions_after();

create or replace function public.blood_reactions_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare t public.blood_transfusions;
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - array['imputability', 'unit_returned', 'samples_sent', 'reported_externally_at']) is distinct from (to_jsonb(old) - array['imputability', 'unit_returned', 'samples_sent', 'reported_externally_at']) then
      raise exception 'Only the investigation fields of a reaction report can be updated';
    end if;
    return new;
  end if;
  select * into t from public.blood_transfusions where id = new.transfusion_id;
  if t.id is null then raise exception 'Transfusion not found'; end if;
  if coalesce(trim(new.actions), '') = '' then raise exception 'Record what was done (stopped transfusion, treatment given)'; end if;
  new.hospital_id := t.hospital_id; new.unit_id := t.unit_id; new.patient_id := t.patient_id;
  return new;
end $$;
drop trigger if exists trg_blood_reactions_before on public.blood_reactions;
create trigger trg_blood_reactions_before before insert or update on public.blood_reactions for each row execute function public.blood_reactions_before();

create or replace function public.blood_reactions_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.blood_transfusions set reaction = true where id = new.transfusion_id and not reaction;
  begin
    execute 'insert into public.notifications(hospital_id, notification_type, title, message, target_path, payload_json) values ($1, ''alert'', ''Transfusion reaction'', $2, ''/blood-bank'', $3)'
      using new.hospital_id, replace(new.reaction_type, '_', ' ') || ' (' || replace(new.severity, '_', ' ') || '). Return the bag and giving set to the blood bank; send post-transfusion samples.',
            jsonb_build_object('reaction_id', new.id, 'patient_id', new.patient_id, 'unit_id', new.unit_id);
  exception when others then raise warning 'reaction notification skipped: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_blood_reactions_after on public.blood_reactions;
create trigger trg_blood_reactions_after after insert on public.blood_reactions for each row execute function public.blood_reactions_after();

-- ---------------------------------------------------------------- donors
-- Eligibility (KNBTS / WHO): age 16–65, weight ≥ 50 kg, Hb ≥ 12.5 g/dL, BP 100–180 / 60–100, temperature ≤ 37.5 °C,
-- at least 12 weeks since the last donation for men and 16 weeks for women, not deferred.
create or replace function public.blood_donation_problem(p_donor uuid, p_at timestamptz, p_weight numeric, p_hb numeric, p_sys numeric, p_dia numeric, p_temp numeric, p_questionnaire boolean)
returns text language plpgsql stable security definer set search_path = public as $$
declare d public.blood_donors; age numeric; gap interval;
begin
  select * into d from public.blood_donors where id = p_donor;
  if d.id is null or not public.blood_is_staff(d.hospital_id) then return 'Donor not found'; end if;
  if d.permanently_deferred then return 'Permanently deferred: ' || coalesce(d.deferral_reason, 'see donor record'); end if;
  if d.deferred_until is not null and d.deferred_until > p_at::date then return 'Deferred until ' || to_char(d.deferred_until, 'DD Mon YYYY') || coalesce(' (' || d.deferral_reason || ')', ''); end if;
  age := extract(epoch from age(p_at::date, d.date_of_birth)) / (365.25 * 86400);
  if age < 16 or age >= 66 then return 'Age must be 16 to 65'; end if;
  gap := case d.sex when 'female' then interval '112 days' else interval '84 days' end;
  if d.last_donation_at is not null and p_at - d.last_donation_at < gap then
    return 'Too soon since the last donation: next eligible ' || to_char(d.last_donation_at + gap, 'DD Mon YYYY');
  end if;
  if p_weight is null or p_weight < 50 then return 'Weight must be at least 50 kg'; end if;
  if p_hb is null or p_hb < 12.5 then return 'Haemoglobin must be at least 12.5 g/dL'; end if;
  if p_sys is not null and (p_sys < 100 or p_sys > 180) or p_dia is not null and (p_dia < 60 or p_dia > 100) then return 'Blood pressure outside 100–180 / 60–100'; end if;
  if p_temp is not null and p_temp > 37.5 then return 'Temperature above 37.5 °C'; end if;
  if not p_questionnaire then return 'Complete the donor health questionnaire'; end if;
  return null;
end $$;

create or replace function public.blood_donations_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare problem text; d public.blood_donors; v_unit uuid; reactive boolean; all_neg boolean;
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'tti') is distinct from (to_jsonb(old) - 'tti') then raise exception 'Only the screening results of a donation can be updated'; end if;
    reactive := exists (select 1 from jsonb_each_text(new.tti) where value = 'reactive');
    all_neg := (select count(*) from jsonb_each_text(new.tti) where key in ('hiv', 'hbv', 'hcv', 'syphilis') and value = 'negative') = 4;
    if reactive then
      update public.blood_donors set permanently_deferred = true,
             deferral_reason = 'Reactive screening (' || (select string_agg(key, ', ') from jsonb_each_text(new.tti) where value = 'reactive') || '): refer for confidential counselling and confirmatory testing'
       where id = new.donor_id;
      update public.blood_bank_units set status = 'Discarded', discard_reason = 'Reactive transfusion-transmissible infection screening'
       where id = new.unit_id and status not in ('Issued', 'Discarded');
    elsif all_neg then
      update public.blood_bank_units set screening_status = 'clear' where id = new.unit_id and status in ('Pending', 'Quarantine');
    end if;
    return new;
  end if;

  select * into d from public.blood_donors where id = new.donor_id;
  if d.id is null then raise exception 'Donor not found'; end if;
  new.hospital_id := d.hospital_id;
  if new.outcome = 'deferred' then
    if coalesce(trim(new.deferral_reason), '') = '' then raise exception 'Give the reason for deferral'; end if;
    update public.blood_donors set deferred_until = new.deferral_until, deferral_reason = new.deferral_reason where id = d.id and new.deferral_until is not null;
    return new;
  end if;
  problem := public.blood_donation_problem(new.donor_id, new.donated_at, new.weight_kg, new.hb, new.bp_sys, new.bp_dia, new.temp, new.questionnaire_ok);
  if problem is not null then raise exception 'Not eligible to donate: %', problem; end if;
  new.blood_group := coalesce(new.blood_group, d.blood_group);
  if new.blood_group is null then raise exception 'Record the donor''s blood group'; end if;
  if coalesce(trim(new.unit_reference), '') = '' then raise exception 'Record the bag (unit) number'; end if;
  insert into public.blood_bank_units(hospital_id, unit_reference, blood_group, component, status, screening_status, expiry_at, volume_ml, donation_id)
  values (d.hospital_id, trim(new.unit_reference), new.blood_group, 'Whole Blood', 'Quarantine', 'pending', new.donated_at + interval '35 days', new.volume_ml, new.id)
  returning id into v_unit;
  new.unit_id := v_unit;
  update public.blood_donors set last_donation_at = new.donated_at, blood_group = coalesce(blood_group, new.blood_group) where id = d.id;
  return new;
end $$;
drop trigger if exists trg_blood_donations_before on public.blood_donations;
create trigger trg_blood_donations_before before insert or update on public.blood_donations for each row execute function public.blood_donations_before();

-- ---------------------------------------------------------------- statistics
create or replace function public.blood_stats(p_hospital uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.clin_can_access(p_hospital) then raise exception 'Only clinical staff can see blood bank statistics'; end if;
  select jsonb_build_object(
    'requests', (select count(*) from public.blood_requests where hospital_id = p_hospital and created_at >= p_from and created_at < p_to + 1),
    'emergency_requests', (select count(*) from public.blood_requests where hospital_id = p_hospital and urgency = 'emergency' and created_at >= p_from and created_at < p_to + 1),
    'issued_by_component', (select coalesce(jsonb_object_agg(component, n), '{}'::jsonb) from (select component, count(*) n from public.blood_bank_units
        where hospital_id = p_hospital and status = 'Issued' and issued_at >= p_from and issued_at < p_to + 1 group by component) x),
    'crossmatched', (select count(distinct blood_unit_id) from public.blood_crossmatches where hospital_id = p_hospital and performed_at >= p_from and performed_at < p_to + 1),
    'transfused', (select count(*) from public.blood_transfusions where hospital_id = p_hospital and started_at >= p_from and started_at < p_to + 1),
    'emergency_releases', (select count(*) from public.blood_bank_units where hospital_id = p_hospital and emergency_release and issued_at >= p_from and issued_at < p_to + 1),
    'median_emergency_request_to_issue_min', (select round((percentile_cont(0.5) within group (order by extract(epoch from u.issued_at - q.created_at) / 60))::numeric, 0)
        from public.blood_bank_units u join public.blood_requests q on q.id = u.request_id
       where u.hospital_id = p_hospital and q.urgency = 'emergency' and u.issued_at >= p_from and u.issued_at < p_to + 1),
    'discarded', (select coalesce(jsonb_object_agg(reason, n), '{}'::jsonb) from (select coalesce(discard_reason, 'unspecified') reason, count(*) n from public.blood_bank_units
        where hospital_id = p_hospital and status = 'Discarded' and updated_at >= p_from and updated_at < p_to + 1 group by 1) x),
    'reactions', (select count(*) from public.blood_reactions where hospital_id = p_hospital and onset_at >= p_from and onset_at < p_to + 1),
    'severe_reactions', (select count(*) from public.blood_reactions where hospital_id = p_hospital and severity <> 'non_severe' and onset_at >= p_from and onset_at < p_to + 1),
    'late_starts', (select count(*) from public.blood_transfusions where hospital_id = p_hospital and flags::text like '%30 minutes%' and started_at >= p_from and started_at < p_to + 1),
    'donations', (select count(*) from public.blood_donations where hospital_id = p_hospital and outcome = 'donated' and donated_at >= p_from and donated_at < p_to + 1),
    'deferrals', (select count(*) from public.blood_donations where hospital_id = p_hospital and outcome = 'deferred' and donated_at >= p_from and donated_at < p_to + 1),
    'tti_reactive', (select count(*) from public.blood_donations where hospital_id = p_hospital and tti::text like '%reactive%' and donated_at >= p_from and donated_at < p_to + 1),
    'stock', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select component || ' ' || blood_group k, count(*) n from public.blood_bank_units
        where hospital_id = p_hospital and status in ('Available', 'Reserved') and expiry_at > now() group by 1) x),
    'expiring_7_days', (select count(*) from public.blood_bank_units where hospital_id = p_hospital and status in ('Available', 'Reserved') and expiry_at between now() and now() + interval '7 days')
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------- access
alter table public.blood_bank_units enable row level security;
alter table public.blood_crossmatches enable row level security;
alter table public.blood_requests enable row level security;
alter table public.blood_group_tests enable row level security;
alter table public.blood_transfusions enable row level security;
alter table public.blood_reactions enable row level security;
alter table public.blood_donors enable row level security;
alter table public.blood_donations enable row level security;

drop policy if exists "Hospital members can read blood bank units" on public.blood_bank_units;
drop policy if exists "Blood bank staff can add units" on public.blood_bank_units;
drop policy if exists "Blood bank staff can update units" on public.blood_bank_units;
drop policy if exists "Authorized blood bank staff can add units" on public.blood_bank_units;
drop policy if exists "Authorized blood bank staff can update units" on public.blood_bank_units;
drop policy if exists "Authorized blood bank staff can read crossmatches" on public.blood_crossmatches;
drop policy if exists "Authorized blood bank staff can record crossmatches" on public.blood_crossmatches;
drop policy if exists blood_units_read on public.blood_bank_units;
drop policy if exists blood_units_insert on public.blood_bank_units;
drop policy if exists blood_units_update on public.blood_bank_units;
drop policy if exists blood_crossmatches_read on public.blood_crossmatches;
drop policy if exists blood_crossmatches_insert on public.blood_crossmatches;
drop policy if exists blood_requests_clinical on public.blood_requests;
drop policy if exists blood_group_tests_read on public.blood_group_tests;
drop policy if exists blood_group_tests_lab on public.blood_group_tests;
drop policy if exists blood_group_tests_void on public.blood_group_tests;
drop policy if exists blood_transfusions_clinical on public.blood_transfusions;
drop policy if exists blood_reactions_clinical on public.blood_reactions;
drop policy if exists blood_donors_lab on public.blood_donors;
drop policy if exists blood_donations_lab on public.blood_donations;

-- clinical staff see stock and issued units (the ward must find the unit for the bedside check); only blood bank staff change stock
create policy blood_units_read on public.blood_bank_units for select to authenticated using (public.clin_can_access(hospital_id));
create policy blood_units_insert on public.blood_bank_units for insert to authenticated with check (public.blood_is_staff(hospital_id));
create policy blood_units_update on public.blood_bank_units for update to authenticated using (public.blood_is_staff(hospital_id)) with check (public.blood_is_staff(hospital_id));
create policy blood_crossmatches_read on public.blood_crossmatches for select to authenticated using (public.clin_can_access(hospital_id));
create policy blood_crossmatches_insert on public.blood_crossmatches for insert to authenticated with check (public.blood_is_staff(hospital_id));
create policy blood_requests_clinical on public.blood_requests for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
create policy blood_group_tests_read on public.blood_group_tests for select to authenticated using (public.clin_can_access(hospital_id));
create policy blood_group_tests_lab on public.blood_group_tests for insert to authenticated with check (public.blood_is_staff(hospital_id));
create policy blood_group_tests_void on public.blood_group_tests for update to authenticated using (public.blood_is_staff(hospital_id)) with check (public.blood_is_staff(hospital_id));
create policy blood_transfusions_clinical on public.blood_transfusions for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
create policy blood_reactions_clinical on public.blood_reactions for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
create policy blood_donors_lab on public.blood_donors for all to authenticated using (public.blood_is_staff(hospital_id)) with check (public.blood_is_staff(hospital_id));
create policy blood_donations_lab on public.blood_donations for all to authenticated using (public.blood_is_staff(hospital_id)) with check (public.blood_is_staff(hospital_id));

revoke all on public.blood_bank_units, public.blood_crossmatches, public.blood_requests, public.blood_group_tests, public.blood_transfusions,
              public.blood_reactions, public.blood_donors, public.blood_donations from anon;
grant select, insert, update on public.blood_bank_units, public.blood_requests, public.blood_group_tests, public.blood_transfusions,
              public.blood_reactions, public.blood_donors, public.blood_donations to authenticated;
revoke update, delete on public.blood_crossmatches from authenticated;
grant select, insert on public.blood_crossmatches to authenticated;
grant all on public.blood_bank_units, public.blood_crossmatches, public.blood_requests, public.blood_group_tests, public.blood_transfusions,
              public.blood_reactions, public.blood_donors, public.blood_donations to service_role;

revoke execute on function public.blood_requests_before(), public.blood_group_tests_before(), public.blood_group_tests_after(), public.prevent_blood_crossmatch_mutation(),
  public.validate_blood_crossmatch(), public.blood_crossmatches_after(), public.enforce_blood_bank_unit_safety(), public.blood_bank_units_after(),
  public.blood_transfusions_before(), public.blood_transfusions_after(), public.blood_reactions_before(), public.blood_reactions_after(),
  public.blood_donations_before() from public, anon, authenticated;
revoke execute on function public.blood_group_status(uuid), public.blood_is_staff(uuid), public.blood_stats(uuid, date, date),
  public.blood_donation_problem(uuid, timestamptz, numeric, numeric, numeric, numeric, numeric, boolean) from public, anon;
grant execute on function public.blood_group_status(uuid), public.blood_is_staff(uuid), public.blood_stats(uuid, date, date),
  public.blood_donation_problem(uuid, timestamptz, numeric, numeric, numeric, numeric, numeric, boolean) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['blood_bank_units', 'blood_crossmatches', 'blood_requests', 'blood_group_tests', 'blood_transfusions', 'blood_reactions', 'blood_donors', 'blood_donations'] loop
    if to_regprocedure('public.audit_row_change()') is not null then
      execute format('drop trigger if exists trg_audit_change on public.%I', t);
      execute format('create trigger trg_audit_change after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
    end if;
  end loop;
end $$;
