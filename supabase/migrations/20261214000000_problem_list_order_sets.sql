-- Continuity of care: a problem list and a current-medicines list that follow the patient across visits (with
-- medication reviews), and order sets — bundles of labs, medicines and instructions for a condition. A hospital adopts
-- an order set from the built-in library (src/utils/orderSetLibrary.js) or writes its own; it can only be used after a
-- doctor approves it, and any edit withdraws the approval until it is approved again. Every use is logged.
--
-- FIX: job titles. pay_canonical_role() (from 02_install_payments.sql) did not recognise common Kenyan clinical titles —
-- "Medical Officer", "Consultant", "Specialist", "General Practitioner", "Registrar", "Microbiologist", "Radiographer" and
-- others fell to 'unknown', so staff with those titles could not open clinical records (clin_can_access). Ambiguous words
-- ("specialist", "consultant", "intern") are matched only as the whole title so "IT Specialist" stays non-clinical.

create or replace function public.pay_canonical_role(p_role text)
returns text language plpgsql immutable as $$
declare r text := lower(trim(coalesce(p_role, '')));
begin
  if r = '' or r = 'staff' then return 'unknown'; end if;  -- deliberately NOT receptionist
  if r in ('admin','owner') then return 'admin'; end if;
  if r in ('doctor','nurse','pharmacist','hr','transfusion officer','mortuary attendant','lab technician') then return 'clinical'; end if;
  if r in ('medical officer','consultant','specialist','general practitioner','registrar','intern','medical intern','microbiologist','radiographer',
           'sonographer','anaesthetist','anesthetist','paediatrician','pediatrician','obstetrician','gynaecologist','gynecologist','dentist',
           'physiotherapist','optometrist','nutritionist','dietitian','psychologist','counsellor','hiv counsellor') then return 'clinical'; end if;
  if r = 'receptionist' then return 'receptionist'; end if;
  if r = 'accountant' then return 'accountant'; end if;
  if r in ('finance officer','cashier','billing officer') then return 'accountant'; end if;
  if r in ('front desk','patient coordinator') then return 'receptionist'; end if;
  if r ~ '(doctor|physician|surgeon|clinical|nurse|nursing|midwife|pharma|lab|technician|radiolog|mlt)' then return 'clinical'; end if;
  if r ~ '(medical officer|practitioner|anaesth|anesth|paediatrician|pediatrician|obstetric|gynaec|gynec|microbiolog|radiograph|sonograph|physiotherap|optomet|dietit|dentist)' then return 'clinical'; end if;
  if r ~ '(account|finance|cashier|billing)' then return 'accountant'; end if;
  if r ~ '(reception|front desk|coordinator)' then return 'receptionist'; end if;
  if r ~ 'admin' then return 'admin'; end if;
  return 'unknown';
end $$;

create table if not exists public.patient_problems (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  patient_id  uuid not null,
  problem     text not null,
  icd10       text,
  onset_date  date,
  status      text not null default 'active' check (status in ('active', 'inactive', 'resolved')),
  chronic     boolean not null default false,
  notes       text,
  visit_id    text,
  noted_by    uuid default auth.uid(),
  noted_by_name text,
  resolved_on date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists patient_problems_one_active on public.patient_problems(patient_id, coalesce(upper(icd10), lower(trim(problem)))) where status = 'active';
create index if not exists patient_problems_patient on public.patient_problems(hospital_id, patient_id, status);

create or replace function public.patient_problems_before()
returns trigger language plpgsql as $$
begin
  if coalesce(trim(new.problem), '') = '' then raise exception 'Describe the problem'; end if;
  new.problem := trim(new.problem); new.icd10 := nullif(upper(trim(coalesce(new.icd10, ''))), '');
  new.updated_at := now();
  if new.status = 'resolved' and (tg_op = 'INSERT' or old.status <> 'resolved') then new.resolved_on := coalesce(new.resolved_on, current_date); end if;
  if new.status <> 'resolved' then new.resolved_on := null; end if;
  if tg_op = 'UPDATE' then new.noted_by := old.noted_by; new.created_at := old.created_at; new.patient_id := old.patient_id; new.hospital_id := old.hospital_id; end if;
  return new;
end $$;
drop trigger if exists trg_patient_problems_before on public.patient_problems;
create trigger trg_patient_problems_before before insert or update on public.patient_problems for each row execute function public.patient_problems_before();

create table if not exists public.patient_medications (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null,
  patient_id      uuid not null,
  drug            text not null,
  dose            text,
  route           text,
  frequency       text,
  indication      text,
  source          text not null default 'prescribed_here' check (source in ('prescribed_here', 'other_facility', 'over_the_counter', 'herbal')),
  prescription_id text,
  started_on      date,
  status          text not null default 'active' check (status in ('active', 'stopped', 'completed')),
  stopped_on      date,
  stop_reason     text,
  added_by        uuid default auth.uid(),
  added_by_name   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists patient_medications_one_active on public.patient_medications(patient_id, lower(trim(drug))) where status = 'active';
create index if not exists patient_medications_patient on public.patient_medications(hospital_id, patient_id, status);

create or replace function public.patient_medications_before()
returns trigger language plpgsql as $$
begin
  if coalesce(trim(new.drug), '') = '' then raise exception 'Name the medicine'; end if;
  new.drug := trim(new.drug); new.updated_at := now();
  if tg_op = 'UPDATE' then
    if old.status <> 'active' and new.status is distinct from old.status then raise exception 'This medicine was stopped; add it again if restarted'; end if;
    new.added_by := old.added_by; new.created_at := old.created_at; new.patient_id := old.patient_id; new.hospital_id := old.hospital_id;
  end if;
  if new.status = 'stopped' then
    if coalesce(trim(new.stop_reason), '') = '' then raise exception 'Give the reason for stopping'; end if;
    new.stopped_on := coalesce(new.stopped_on, current_date);
  elsif new.status = 'completed' then new.stopped_on := coalesce(new.stopped_on, current_date);
  end if;
  return new;
end $$;
drop trigger if exists trg_patient_medications_before on public.patient_medications;
create trigger trg_patient_medications_before before insert or update on public.patient_medications for each row execute function public.patient_medications_before();

create table if not exists public.medication_reviews (
  id          bigserial primary key,
  hospital_id uuid not null,
  patient_id  uuid not null,
  visit_id    text,
  active_count integer,
  notes       text,
  reviewed_by uuid default auth.uid(),
  reviewed_by_name text,
  reviewed_at timestamptz not null default now()
);
create index if not exists medication_reviews_patient on public.medication_reviews(hospital_id, patient_id, reviewed_at desc);

create or replace function public.medication_reviews_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'INSERT' then raise exception 'Medication reviews cannot be changed'; end if;
  new.active_count := (select count(*) from public.patient_medications m where m.patient_id = new.patient_id and m.hospital_id = new.hospital_id and m.status = 'active');
  new.reviewed_at := now(); new.reviewed_by := auth.uid();
  return new;
end $$;
drop trigger if exists trg_medication_reviews_before on public.medication_reviews;
create trigger trg_medication_reviews_before before insert or update or delete on public.medication_reviews for each row execute function public.medication_reviews_before();

-- ---------------------------------------------------------------- order sets
create table if not exists public.order_sets (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null,
  name         text not null,
  condition    text,
  icd10        text[] not null default '{}',          -- codes / prefixes this set is suggested for
  labs         jsonb not null default '[]'::jsonb check (jsonb_typeof(labs) = 'array'),          -- [{test_type, category, priority}]
  medications  jsonb not null default '[]'::jsonb check (jsonb_typeof(medications) = 'array'),   -- [{drug_name, dosage, frequency, duration, route, notes}]
  instructions text,
  source       text not null default 'custom',        -- 'library:<id>' or 'custom'
  version      integer not null default 1,
  active       boolean not null default false,
  approved_by  uuid,
  approved_by_name text,
  approved_at  timestamptz,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists order_sets_name on public.order_sets(hospital_id, lower(name));

create or replace function public.order_set_can_approve(p_hospital uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select c.member and c.staff_active and (c.canonical = 'admin' or lower(coalesce(c.raw_role, '')) ~ '(doctor|physician|consultant|medical officer|clinical officer|surgeon|specialist|registrar)')
                     from public.pay_user_context(p_hospital, auth.uid()) c), false)
$$;

create or replace function public.order_sets_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare content_changed boolean;
begin
  if coalesce(trim(new.name), '') = '' then raise exception 'Name the order set'; end if;
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.approved_by := null; new.approved_at := null; new.approved_by_name := null; new.active := false; new.version := 1;
    return new;
  end if;
  new.created_by := old.created_by; new.created_at := old.created_at; new.hospital_id := old.hospital_id;
  content_changed := (new.name, new.condition, new.icd10, new.labs, new.medications, new.instructions) is distinct from (old.name, old.condition, old.icd10, old.labs, old.medications, old.instructions);
  if content_changed then
    new.version := old.version + 1;
    new.approved_by := null; new.approved_at := null; new.approved_by_name := null; new.active := false;   -- edits need fresh approval
  elsif new.approved_by is distinct from old.approved_by then
    if new.approved_by is not null then
      if not public.order_set_can_approve(new.hospital_id) then raise exception 'Only a doctor or administrator can approve an order set'; end if;
      new.approved_by := auth.uid(); new.approved_at := now();
    else
      new.approved_at := null; new.approved_by_name := null; new.active := false;
    end if;
  end if;
  if new.active and new.approved_by is null then raise exception 'Approve the order set before switching it on'; end if;
  return new;
end $$;
drop trigger if exists trg_order_sets_before on public.order_sets;
create trigger trg_order_sets_before before insert or update on public.order_sets for each row execute function public.order_sets_before();

create table if not exists public.order_set_uses (
  id           bigserial primary key,
  hospital_id  uuid not null,
  order_set_id uuid not null references public.order_sets(id) on delete cascade,
  version      integer,
  patient_id   uuid,
  visit_id     text,
  used_by      uuid default auth.uid(),
  used_at      timestamptz not null default now()
);
create index if not exists order_set_uses_set on public.order_set_uses(order_set_id, used_at desc);

create or replace function public.order_set_uses_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare o public.order_sets;
begin
  if tg_op <> 'INSERT' then raise exception 'Order set use records cannot be changed'; end if;
  select * into o from public.order_sets where id = new.order_set_id;
  if o.id is null or not o.active then raise exception 'This order set is not approved for use'; end if;
  new.hospital_id := o.hospital_id; new.version := o.version; new.used_by := auth.uid(); new.used_at := now();
  return new;
end $$;
drop trigger if exists trg_order_set_uses_before on public.order_set_uses;
create trigger trg_order_set_uses_before before insert or update or delete on public.order_set_uses for each row execute function public.order_set_uses_before();

-- ---------------------------------------------------------------- access
alter table public.patient_problems enable row level security;
alter table public.patient_medications enable row level security;
alter table public.medication_reviews enable row level security;
alter table public.order_sets enable row level security;
alter table public.order_set_uses enable row level security;
drop policy if exists patient_problems_clinical on public.patient_problems;
drop policy if exists patient_medications_clinical on public.patient_medications;
drop policy if exists medication_reviews_clinical on public.medication_reviews;
drop policy if exists order_sets_clinical on public.order_sets;
drop policy if exists order_set_uses_clinical on public.order_set_uses;
create policy patient_problems_clinical on public.patient_problems for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
create policy patient_medications_clinical on public.patient_medications for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
create policy medication_reviews_clinical on public.medication_reviews for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
create policy order_sets_clinical on public.order_sets for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
create policy order_set_uses_clinical on public.order_set_uses for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
revoke all on public.patient_problems, public.patient_medications, public.medication_reviews, public.order_sets, public.order_set_uses from anon;
grant select, insert, update on public.patient_problems, public.patient_medications, public.order_sets to authenticated;
grant select, insert on public.medication_reviews, public.order_set_uses to authenticated;
grant usage on sequence public.medication_reviews_id_seq, public.order_set_uses_id_seq to authenticated;
grant all on public.patient_problems, public.patient_medications, public.medication_reviews, public.order_sets, public.order_set_uses to service_role;
revoke execute on function public.patient_problems_before(), public.patient_medications_before(), public.medication_reviews_before(), public.order_sets_before(), public.order_set_uses_before() from public, anon, authenticated;
revoke execute on function public.order_set_can_approve(uuid) from public, anon;
grant execute on function public.order_set_can_approve(uuid) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['patient_problems', 'patient_medications', 'order_sets'] loop
    if to_regprocedure('public.audit_row_change()') is not null then
      execute format('drop trigger if exists trg_audit_change on public.%I', t);
      execute format('create trigger trg_audit_change after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
    end if;
  end loop;
end $$;
