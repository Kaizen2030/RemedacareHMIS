-- Medical Records: (1) physical file locator — one record per patient file volume, every movement logged (issued,
-- transferred, returned, missing, found, archived) with who holds it now, since when and when it is due back;
-- (2) incomplete-records (deficiency) list generated from the clinical data: discharged admissions without a discharge
-- summary or a diagnosis code, and deaths in the mortuary register without an MCCD cause of death. Items drop off the
-- list automatically when the record is completed. Records staff and clinical staff only.

create or replace function public.rec_can_access(p_hospital uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.clin_can_access(p_hospital) or coalesce((select c.member and c.staff_active and (c.canonical = 'admin' or lower(coalesce(c.raw_role, '')) ~ '(record|health information|\yhis\y|coder|coding)')
                                                          from public.pay_user_context(p_hospital, auth.uid()) c), false)
$$;

create table if not exists public.record_files (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid not null,
  patient_id       uuid not null,
  file_number      text,
  volume           smallint not null default 1 check (volume >= 1),
  shelf            text,                                 -- home location in the registry
  status           text not null default 'in_registry' check (status in ('in_registry', 'out', 'missing', 'archived')),
  holder           text,                                 -- department / person holding it now
  holder_location  text,
  out_since        timestamptz,
  due_back         timestamptz,
  last_movement_at timestamptz,
  created_at       timestamptz not null default now(),
  unique (hospital_id, patient_id, volume)
);
create index if not exists record_files_status on public.record_files(hospital_id, status, due_back);

create table if not exists public.record_file_movements (
  id          bigserial primary key,
  hospital_id uuid not null,
  file_id     uuid not null references public.record_files(id) on delete cascade,
  action      text not null check (action in ('issued', 'transferred', 'returned', 'missing', 'found', 'archived')),
  to_holder   text,
  to_location text,
  due_back    timestamptz,
  reason      text,
  moved_by    uuid default auth.uid(),
  moved_by_name text,
  moved_at    timestamptz not null default now()
);
create index if not exists record_file_movements_file on public.record_file_movements(file_id, moved_at desc);

create or replace function public.record_files_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'in_registry'; new.holder := null; new.holder_location := null; new.out_since := null; new.due_back := null;
    return new;
  end if;
  if coalesce(current_setting('app.record_move', true), '') <> 'on'
     and (new.status, new.holder, new.holder_location, new.out_since, new.due_back) is distinct from (old.status, old.holder, old.holder_location, old.out_since, old.due_back) then
    raise exception 'File location changes only through a recorded movement (issue, transfer, return)';
  end if;
  return new;
end $$;
drop trigger if exists trg_record_files_guard on public.record_files;
create trigger trg_record_files_guard before insert or update on public.record_files for each row execute function public.record_files_guard();

create or replace function public.record_file_movements_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare f public.record_files;
begin
  if tg_op <> 'INSERT' then raise exception 'File movements cannot be changed'; end if;
  select * into f from public.record_files where id = new.file_id for update;
  if f.id is null then raise exception 'File not found'; end if;
  new.hospital_id := f.hospital_id; new.moved_by := auth.uid(); new.moved_at := now();
  if new.action = 'issued' then
    if f.status <> 'in_registry' then raise exception 'The file is not in the registry (it is %: % since %)', f.status, coalesce(f.holder, 'unknown'), to_char(f.out_since, 'DD Mon HH24:MI'); end if;
    if coalesce(trim(new.to_holder), '') = '' then raise exception 'Record who is taking the file'; end if;
    new.due_back := coalesce(new.due_back, now() + interval '24 hours');
  elsif new.action = 'transferred' then
    if f.status <> 'out' then raise exception 'Only a file that is out can be passed on; issue it from the registry'; end if;
    if coalesce(trim(new.to_holder), '') = '' then raise exception 'Record who is receiving the file'; end if;
    new.due_back := coalesce(new.due_back, f.due_back);
  elsif new.action = 'returned' then
    if f.status not in ('out', 'missing') then raise exception 'The file is already in the registry'; end if;
  elsif new.action = 'missing' then
    if coalesce(trim(new.reason), '') = '' then raise exception 'Describe where the file was last seen'; end if;
  elsif new.action = 'found' then
    if f.status <> 'missing' then raise exception 'The file is not marked missing'; end if;
  elsif new.action = 'archived' then
    if f.status <> 'in_registry' then raise exception 'Return the file to the registry before archiving'; end if;
    if coalesce(trim(new.reason), '') = '' then raise exception 'Give the archive box / reason'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_record_file_movements_before on public.record_file_movements;
create trigger trg_record_file_movements_before before insert or update or delete on public.record_file_movements for each row execute function public.record_file_movements_before();

create or replace function public.record_file_movements_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.record_move', 'on', true);
  update public.record_files set
    status = case new.action when 'issued' then 'out' when 'transferred' then 'out' when 'returned' then 'in_registry' when 'found' then 'in_registry'
                             when 'missing' then 'missing' when 'archived' then 'archived' end,
    holder = case when new.action in ('issued', 'transferred') then new.to_holder when new.action = 'missing' then holder else null end,
    holder_location = case when new.action in ('issued', 'transferred') then new.to_location when new.action = 'missing' then holder_location else null end,
    out_since = case when new.action = 'issued' then new.moved_at when new.action in ('transferred', 'missing') then out_since else null end,
    due_back = case when new.action in ('issued', 'transferred') then new.due_back else null end,
    last_movement_at = new.moved_at
  where id = new.file_id;
  perform set_config('app.record_move', 'off', true);
  return null;
end $$;
drop trigger if exists trg_record_file_movements_after on public.record_file_movements;
create trigger trg_record_file_movements_after after insert on public.record_file_movements for each row execute function public.record_file_movements_after();

-- Incomplete records, computed from the clinical data (nothing to keep in sync)
create or replace function public.records_deficiencies(p_hospital uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb := '[]'; part jsonb;
begin
  if not public.rec_can_access(p_hospital) then raise exception 'Only records and clinical staff can see the incomplete-records list'; end if;
  if to_regclass('public.admissions') is not null then
    execute format($q$
      select coalesce(jsonb_agg(x order by x->>'discharged_at'), '[]'::jsonb) from (
        select jsonb_build_object(
          'kind', 'admission', 'record_id', a.id, 'patient_id', a.patient_id, 'patient', p.full_name,
          'discharged_at', j->>'discharge_date', 'ward', coalesce(j->>'ward_name', j->>'ward', j->>'ward_id'),
          'clinician', coalesce(j->>'discharging_doctor', j->>'doctor_name', j->>'admitting_doctor', j->>'attending_doctor'),
          'days_since', (current_date - (j->>'discharge_date')::date),
          'missing', to_jsonb(array_remove(array[
            case when coalesce(trim(coalesce(j->>'discharge_summary_notes', j->>'discharge_notes', j->>'discharge_summary')), '') = '' then 'Discharge summary' end,
            case when coalesce(trim(coalesce(j->>'icd10_code', j->>'diagnosis_code', j->>'icd_code', j->>'final_diagnosis_code')), '') = ''
                  and not %s
                 then 'Diagnosis (ICD-10) code' end
          ], null))) x
          from public.admissions a
          cross join lateral (select to_jsonb(a) j) jj
          left join public.patients p on p.id::text = a.patient_id::text
         where a.hospital_id::text = $1::text and nullif(j->>'discharge_date', '') is not null
           and (j->>'discharge_date')::date between $2 and $3) y(x)
      where jsonb_array_length(x->'missing') > 0 $q$,
      case when to_regclass('public.consultations') is not null
           then 'exists (select 1 from public.consultations c where c.patient_id::text = a.patient_id::text and to_jsonb(c)->>''visit_id'' = j->>''visit_id'' and coalesce(to_jsonb(c)->>''icd10_code'', '''') <> '''')'
           else 'false' end)
    into part using p_hospital, p_from, p_to;
    r := r || coalesce(part, '[]'::jsonb);
  end if;
  if to_regclass('public.mortuary_bodies') is not null then
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'death', 'record_id', b.id, 'patient_id', b.patient_id, 'patient', b.deceased_name,
             'discharged_at', coalesce(b.died_at, b.admitted_at), 'ward', b.source_ward, 'clinician', b.certified_by,
             'days_since', current_date - coalesce(b.died_at, b.admitted_at)::date,
             'missing', to_jsonb(array_remove(array[
               case when coalesce(trim(b.cause_of_death->>'ia'), '') = '' then 'Cause of death (MCCD Ia)' end,
               case when coalesce(trim(b.mccd_serial), '') = '' then 'MCCD serial number' end], null))) order by b.admitted_at), '[]'::jsonb)
      into part from public.mortuary_bodies b
     where b.hospital_id = p_hospital and b.place_of_death in ('ward', 'emergency', 'theatre') and coalesce(b.died_at, b.admitted_at)::date between p_from and p_to
       and (coalesce(trim(b.cause_of_death->>'ia'), '') = '' or coalesce(trim(b.mccd_serial), '') = '');
    r := r || part;
  end if;
  return r;
end $$;

alter table public.record_files enable row level security;
alter table public.record_file_movements enable row level security;
drop policy if exists record_files_staff on public.record_files;
drop policy if exists record_file_movements_staff on public.record_file_movements;
create policy record_files_staff on public.record_files for all to authenticated using (public.rec_can_access(hospital_id)) with check (public.rec_can_access(hospital_id));
create policy record_file_movements_staff on public.record_file_movements for all to authenticated using (public.rec_can_access(hospital_id)) with check (public.rec_can_access(hospital_id));
revoke all on public.record_files, public.record_file_movements from anon;
grant select, insert, update on public.record_files to authenticated;
grant select, insert on public.record_file_movements to authenticated;
grant usage on sequence public.record_file_movements_id_seq to authenticated;
grant all on public.record_files, public.record_file_movements to service_role;
revoke execute on function public.record_files_guard(), public.record_file_movements_before(), public.record_file_movements_after() from public, anon, authenticated;
revoke execute on function public.rec_can_access(uuid), public.records_deficiencies(uuid, date, date) from public, anon;
grant execute on function public.rec_can_access(uuid), public.records_deficiencies(uuid, date, date) to authenticated, service_role;
