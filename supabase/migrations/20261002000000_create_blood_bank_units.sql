create table if not exists public.blood_bank_units (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  unit_reference text not null,
  blood_group text not null check (blood_group in ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+')),
  component text not null,
  status text not null default 'Pending'
    check (status in ('Pending', 'Quarantine', 'Available', 'Reserved', 'Issued', 'Discarded')),
  screening_status text not null default 'pending'
    check (screening_status in ('pending', 'recheck', 'clear')),
  expiry_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hospital_id, unit_reference)
);

create index if not exists blood_bank_units_hospital_status_idx
  on public.blood_bank_units (hospital_id, status, blood_group);

alter table public.blood_bank_units enable row level security;

create policy "Hospital members can read blood bank units"
  on public.blood_bank_units for select to authenticated
  using (exists (
    select 1 from public.hospital_users hu
    where hu.hospital_id = blood_bank_units.hospital_id
      and hu.user_id = (select auth.uid())
      and hu.active is distinct from false
  ));

create policy "Blood bank staff can add units"
  on public.blood_bank_units for insert to authenticated
  with check (exists (
    select 1 from public.hospital_users hu
    where hu.hospital_id = blood_bank_units.hospital_id
      and hu.user_id = (select auth.uid())
      and hu.active is distinct from false
      and lower(hu.role) in ('admin', 'lab technician', 'lab scientist', 'medical laboratory technician', 'mlt', 'microbiologist')
  ));

create policy "Blood bank staff can update units"
  on public.blood_bank_units for update to authenticated
  using (exists (
    select 1 from public.hospital_users hu
    where hu.hospital_id = blood_bank_units.hospital_id
      and hu.user_id = (select auth.uid())
      and hu.active is distinct from false
      and lower(hu.role) in ('admin', 'lab technician', 'lab scientist', 'medical laboratory technician', 'mlt', 'microbiologist')
  ))
  with check (exists (
    select 1 from public.hospital_users hu
    where hu.hospital_id = blood_bank_units.hospital_id
      and hu.user_id = (select auth.uid())
      and hu.active is distinct from false
      and lower(hu.role) in ('admin', 'lab technician', 'lab scientist', 'medical laboratory technician', 'mlt', 'microbiologist')
  ));