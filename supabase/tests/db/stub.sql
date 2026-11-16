-- Supabase-shaped stub, modelled on how RemedacareHMS actually uses these tables.
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create publication supabase_realtime;
create table hospitals(id uuid primary key, name text, owner_email text);
-- role holds either the staff.role text (copied at login) or 'admin'/'staff' (written by set_staff_role)
create table hospital_users(user_id uuid, hospital_id uuid, role text, active boolean default true);
create table staff(id uuid primary key default gen_random_uuid(), hospital_id uuid, email text, full_name text, role text, status text default 'Active');
create table audit_log(id bigserial primary key, hospital_id uuid, user_role text, action text, target_table text, target_id text, details text, performed_at timestamptz);
create table patients(id uuid primary key default gen_random_uuid(), hospital_id uuid, full_name text);
create table invoices(id uuid primary key default gen_random_uuid(), hospital_id uuid, patient_id uuid, visit_id uuid, patient_name text, invoice_no text,
  amount_kes numeric, paid_kes numeric default 0, balance_kes numeric default 0, status text default 'Pending', payment_method text, paid_at timestamptz, created_at timestamptz default now());
create table mpesa_transactions(id uuid primary key default gen_random_uuid(), hospital_id uuid, reference text, phone text, amount_kes numeric,
  drug_or_service text, status text, transacted_at timestamptz, invoice_id uuid, patient_id uuid, visit_id uuid);
grant usage on schema public to anon, authenticated; grant usage on schema auth to anon, authenticated;
grant select, insert, update, delete on invoices, patients, mpesa_transactions to authenticated;
grant select on hospital_users, staff, hospitals to authenticated;

insert into hospitals values ('11111111-1111-1111-1111-111111111111','Hosp A','owner@a.ke'), ('22222222-2222-2222-2222-222222222222','Hosp B','owner@b.ke');
insert into auth.users values
 ('00000000-0000-0000-0000-0000000000a1','rec@a.ke'),   -- receptionist
 ('00000000-0000-0000-0000-0000000000a2','acc@a.ke'),   -- accountant
 ('00000000-0000-0000-0000-0000000000a3','cash@a.ke'),  -- cashier (edited in Settings -> hospital_users.role = 'staff')
 ('00000000-0000-0000-0000-0000000000a4','own@a.ke'),   -- owner
 ('00000000-0000-0000-0000-0000000000a5','sus@a.ke'),   -- suspended cashier
 ('00000000-0000-0000-0000-0000000000a6','fin@a.ke'),   -- "Senior Finance Officer"
 ('00000000-0000-0000-0000-0000000000c1','nurse@a.ke'),
 ('00000000-0000-0000-0000-0000000000b1','rec@b.ke');
update hospitals set owner_email = 'own@a.ke' where id = '11111111-1111-1111-1111-111111111111';
insert into hospital_users(user_id, hospital_id, role) values
 ('00000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','Receptionist'),
 ('00000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111','Accountant'),
 ('00000000-0000-0000-0000-0000000000a3','11111111-1111-1111-1111-111111111111','staff'),
 ('00000000-0000-0000-0000-0000000000a4','11111111-1111-1111-1111-111111111111','staff'),
 ('00000000-0000-0000-0000-0000000000a5','11111111-1111-1111-1111-111111111111','Cashier'),
 ('00000000-0000-0000-0000-0000000000a6','11111111-1111-1111-1111-111111111111','Senior Finance Officer'),
 ('00000000-0000-0000-0000-0000000000c1','11111111-1111-1111-1111-111111111111','Nurse'),
 ('00000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','Receptionist');
insert into staff(hospital_id, email, full_name, role, status) values
 ('11111111-1111-1111-1111-111111111111','rec@a.ke','Rita','Receptionist','Active'),
 ('11111111-1111-1111-1111-111111111111','acc@a.ke','Abel','Accountant','Active'),
 ('11111111-1111-1111-1111-111111111111','cash@a.ke','Carol','Cashier','Active'),
 ('11111111-1111-1111-1111-111111111111','sus@a.ke','Sam','Cashier','Suspended'),
 ('11111111-1111-1111-1111-111111111111','fin@a.ke','Faith','Senior Finance Officer','Active'),
 ('11111111-1111-1111-1111-111111111111','nurse@a.ke','Nora','Nurse','Active');
insert into patients(id, hospital_id, full_name) values
 ('99999999-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Jane'),
 ('99999999-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Bob');
