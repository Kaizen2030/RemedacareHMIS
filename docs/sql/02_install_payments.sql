-- =============================================================================
-- RemedacareHMS — INSTALL / UPDATE the payments ledger (all-in-one)
-- Generated from supabase/migrations/20261114000000_payments_ledger.sql — do not edit by hand.
--
-- 1. Run 01_check_current_supabase.sql first and fix every BLOCKER.
-- 2. Take a backup: Supabase → Database → Backups (or pg_dump). This script also keeps a
--    private copy of the invoices table in schema payments_backup.
-- 3. Paste this whole file into Supabase → SQL Editor → Run.
--    Everything runs in ONE transaction: if any statement fails, nothing is changed.
-- 4. The last result is a health check. Every row should say OK.
-- Safe to run again later (it is idempotent).
-- =============================================================================

begin;

-- Stop at once if this is not the RemedacareHMS database (wrong Supabase project).
do $$ begin
  if to_regclass('public.invoices') is null or to_regclass('public.hospital_users') is null
     or to_regclass('public.staff') is null or to_regclass('public.hospitals') is null then
    raise exception 'This database has no RemedacareHMS tables (invoices, hospital_users, staff, hospitals). You are probably in the wrong Supabase project. Open the project your app uses (VITE_SUPABASE_URL in .env) and run it there. Nothing was changed.';
  end if;
end $$;

-- Private snapshot of invoices as they were before the ledger (not exposed to the API).
create schema if not exists payments_backup;
revoke all on schema payments_backup from public;
do $$ begin
  if to_regclass('payments_backup.invoices_before_ledger') is null then
    create table payments_backup.invoices_before_ledger as select now() as snapshot_at, i.* from public.invoices i;
  end if;
end $$;
do $$ begin
  execute 'revoke all on schema payments_backup from anon, authenticated';
exception when undefined_object then null; end $$;


create extension if not exists pgcrypto;

create or replace function public.pay_canonical_role(p_role text)
returns text language plpgsql immutable as $$
declare r text := lower(trim(coalesce(p_role, '')));
begin
  if r = '' or r = 'staff' then return 'unknown'; end if;  -- deliberately NOT receptionist
  if r in ('admin','owner') then return 'admin'; end if;
  if r in ('doctor','nurse','pharmacist','hr','transfusion officer','mortuary attendant','lab technician') then return 'clinical'; end if;
  if r = 'receptionist' then return 'receptionist'; end if;
  if r = 'accountant' then return 'accountant'; end if;
  if r in ('finance officer','cashier','billing officer') then return 'accountant'; end if;
  if r in ('front desk','patient coordinator') then return 'receptionist'; end if;
  if r ~ '(doctor|physician|surgeon|clinical|nurse|nursing|midwife|pharma|lab|technician|radiolog|mlt)' then return 'clinical'; end if;
  if r ~ '(account|finance|cashier|billing)' then return 'accountant'; end if;
  if r ~ '(reception|front desk|coordinator)' then return 'receptionist'; end if;
  if r ~ 'admin' then return 'admin'; end if;
  return 'unknown';
end $$;

create or replace function public.pay_user_context(p_hospital uuid, p_user uuid)
returns table(member boolean, raw_role text, canonical text, staff_active boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_email text; v_hu jsonb; v_owner text; v_staff record;
begin
  if p_hospital is null or p_user is null then
    return query select false, null::text, 'unknown'::text, false; return;
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = p_user;
  select to_jsonb(hu) into v_hu from public.hospital_users hu
   where hu.hospital_id = p_hospital and hu.user_id = p_user limit 1;
  select lower(h.owner_email) into v_owner from public.hospitals h where h.id = p_hospital;

  if v_email is not null and v_email = v_owner then
    return query select true, 'Owner'::text, 'admin'::text, true; return;
  end if;
  if v_hu is null or coalesce((v_hu->>'active')::boolean, true) = false then
    return query select false, null::text, 'unknown'::text, false; return;
  end if;

  select s.role, s.status into v_staff from public.staff s
   where s.hospital_id = p_hospital and lower(s.email) = v_email
   order by (lower(coalesce(s.status,'active')) = 'active') desc limit 1;

  return query select true,
    coalesce(nullif(trim(v_staff.role), ''), v_hu->>'role'),
    public.pay_canonical_role(coalesce(nullif(trim(v_staff.role), ''), v_hu->>'role')),
    coalesce(lower(v_staff.status), 'active') not in ('suspended','terminated','rejected','pending approval','inactive');
end $$;

create or replace function public.pay_access_level(p_hospital uuid, p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when not c.member then null
    when not c.staff_active then 'member'
    when c.canonical = 'admin' then 'manage'
    when c.canonical = 'accountant' and lower(c.raw_role) !~ '(cashier|billing)' then 'manage'
    when c.canonical in ('accountant','receptionist') then 'take'
    else 'member' end
  from public.pay_user_context(p_hospital, p_user) c
$$;

create or replace function public.pay_member_role(p_hospital uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(c.raw_role, 'unknown') from public.pay_user_context(p_hospital, auth.uid()) c
$$;

create or replace function public.pay_is_member(p_hospital uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select member from public.pay_user_context(p_hospital, auth.uid())), false)
$$;

create or replace function public.can_take_payments(p_hospital uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.pay_access_level(p_hospital, auth.uid()) in ('take','manage'), false)
$$;

create or replace function public.can_manage_payments(p_hospital uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.pay_access_level(p_hospital, auth.uid()) = 'manage', false)
$$;

create or replace function public.is_payments_admin(p_hospital uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select canonical = 'admin' and staff_active
                     from public.pay_user_context(p_hospital, auth.uid())), false)
$$;

do $$
declare v_has_rows boolean; v_idx record;
begin
  if to_regclass('public.payments') is not null and not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'payments' and column_name = 'refund_of') then
    execute 'select exists (select 1 from public.payments)' into v_has_rows;
    if v_has_rows then
      raise exception 'An older public.payments table with data exists. Its rows must be moved into the new ledger first. Send them to your developer. Nothing was changed.';
    end if;
    if to_regclass('public.payments_old_20261114') is not null then
      raise exception 'public.payments_old_20261114 already exists. Drop or rename it, then run this again. Nothing was changed.';
    end if;
    drop trigger if exists trigger_sync_invoice_on_payment on public.payments;
    for v_idx in
      select ic.relname as name from pg_index i join pg_class ic on ic.oid = i.indexrelid
       where i.indrelid = 'public.payments'::regclass
    loop
      execute format('alter index public.%I rename to %I', v_idx.name, left(v_idx.name, 50) || '_old20261114');
    end loop;
    alter table public.payments rename to payments_old_20261114;
    revoke all on public.payments_old_20261114 from anon, authenticated;
  end if;

  if to_regprocedure('public.sync_invoice_totals()') is not null
     and (select prosrc from pg_proc where oid = to_regprocedure('public.sync_invoice_totals()')) ~* '\mpayments\M' then
    execute $f$
      create or replace function public.sync_invoice_totals()
      returns trigger language plpgsql as $body$
      begin
        update public.invoices set
          amount_kes = (select coalesce(sum(total_kes), 0) from public.invoice_items
                         where invoice_id = coalesce(new.invoice_id, old.invoice_id))
        where id = coalesce(new.invoice_id, old.invoice_id);
        return coalesce(new, old);
      end $body$
    $f$;
  end if;
end $$;

create table if not exists public.hospital_payment_settings (
  hospital_id        uuid primary key,
  enabled_methods    text[] not null default array['cash','mpesa_manual','card_pos','bank_transfer','cheque'],
  mpesa_provider     text not null default 'daraja'   check (mpesa_provider in ('daraja','paystack','flutterwave')),
  card_provider      text not null default 'paystack' check (card_provider  in ('paystack','flutterwave','pesapal')),
  mpesa_paybill      text,
  mpesa_till         text,
  bank_name          text,
  bank_account_name  text,
  bank_account_no    text,
  fallback_email     text,
  allow_partial      boolean not null default true,
  updated_at         timestamptz not null default now()
);

create table if not exists public.hospital_payment_credentials (
  hospital_id  uuid not null,
  provider     text not null check (provider in ('daraja','paystack','flutterwave','pesapal')),
  environment  text not null default 'sandbox' check (environment in ('sandbox','live')),
  credentials  jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  primary key (hospital_id, provider)
);
alter table public.hospital_payment_credentials enable row level security;
revoke all on public.hospital_payment_credentials from anon, authenticated;

alter table public.hospital_payment_settings enable row level security;
grant select, insert, update on public.hospital_payment_settings to authenticated;
drop policy if exists hps_select on public.hospital_payment_settings;
create policy hps_select on public.hospital_payment_settings
  for select using (public.pay_is_member(hospital_id));
drop policy if exists hps_write on public.hospital_payment_settings;
create policy hps_write on public.hospital_payment_settings
  for all using (public.is_payments_admin(hospital_id))
  with check (public.is_payments_admin(hospital_id));

create or replace function public.set_payment_credentials(
  p_hospital uuid, p_provider text, p_environment text, p_credentials jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_payments_admin(p_hospital) then
    raise exception 'Only an administrator can change payment credentials';
  end if;
  insert into public.hospital_payment_credentials(hospital_id, provider, environment, credentials)
  values (p_hospital, p_provider, p_environment,
          (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
             from jsonb_each(coalesce(p_credentials,'{}'::jsonb)) as t(k, v)
            where v <> '""'::jsonb))
  on conflict (hospital_id, provider) do update
    set environment = excluded.environment,
        credentials = public.hospital_payment_credentials.credentials || excluded.credentials,
        updated_at  = now();
end $$;

create or replace function public.payment_credentials_status(p_hospital uuid)
returns table(provider text, environment text, configured_keys text[], updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.provider, c.environment,
         array(select jsonb_object_keys(c.credentials)), c.updated_at
  from public.hospital_payment_credentials c
  where c.hospital_id = p_hospital and public.is_payments_admin(p_hospital)
$$;

create table if not exists public.receipt_counters (
  hospital_id uuid not null,
  prefix      text not null,
  year        int  not null,
  last_no     int  not null default 0,
  primary key (hospital_id, prefix, year)
);
alter table public.receipt_counters enable row level security;
revoke all on public.receipt_counters from anon, authenticated;

create or replace function public.next_receipt_no(p_hospital uuid, p_prefix text)
returns text language plpgsql security definer set search_path = public as $$
declare v_year int := extract(year from (now() at time zone 'Africa/Nairobi'))::int; v_no int;
begin
  insert into public.receipt_counters as rc(hospital_id, prefix, year, last_no)
  values (p_hospital, p_prefix, v_year, 1)
  on conflict (hospital_id, prefix, year) do update set last_no = rc.last_no + 1
  returning last_no into v_no;
  return p_prefix || '-' || v_year || '-' || lpad(v_no::text, 6, '0');
end $$;

create table if not exists public.payments (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null,
  invoice_id         uuid not null references public.invoices(id) on delete restrict,
  patient_id         uuid,
  visit_id           uuid,
  kind               text not null default 'payment' check (kind in ('payment','refund')),
  refund_of          uuid references public.payments(id),
  method             text not null check (method in (
                       'cash','mpesa','mpesa_manual','airtel_money','card_online','card_pos',
                       'bank_transfer','cheque','other')),
  provider           text not null default 'manual'
                       check (provider in ('manual','daraja','paystack','flutterwave','pesapal')),
  status             text not null default 'pending'
                       check (status in ('pending','completed','failed','cancelled','expired','reversed')),
  amount             numeric(14,2) not null check (amount > 0),
  currency           text not null default 'KES',
  tendered           numeric(14,2),
  change_given       numeric(14,2),
  receipt_no         text,
  reference          text,
  provider_reference text,
  idempotency_key    text,
  payer_name         text,
  payer_phone        text,
  payer_email        text,
  card_brand         text,
  card_last4         text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  bank_name          text,
  cheque_no          text,
  terminal_id        text,
  fee_amount         numeric(14,2),
  failure_reason     text,
  needs_review       boolean not null default false,
  review_note        text,
  notes              text,
  provider_payload   jsonb,
  source             text not null default 'app',
  created_by         uuid,
  created_by_role    text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  completed_at       timestamptz,
  last_checked_at    timestamptz,
  constraint refund_has_parent check ((kind = 'refund') = (refund_of is not null))
);
alter table public.payments add column if not exists last_checked_at timestamptz;

create index if not exists payments_invoice_idx  on public.payments(invoice_id);
create index if not exists payments_hospital_day on public.payments(hospital_id, created_at desc);
create index if not exists payments_pending_idx  on public.payments(hospital_id, status) where status = 'pending';
create unique index if not exists payments_idem_uq
  on public.payments(hospital_id, idempotency_key) where idempotency_key is not null;
create unique index if not exists payments_provider_ref_uq
  on public.payments(hospital_id, provider, provider_reference) where provider_reference is not null;
create unique index if not exists payments_receipt_uq
  on public.payments(hospital_id, receipt_no) where receipt_no is not null;
create or replace function public.payment_ref_family(p_method text)
returns text language sql immutable as $$
  select case when p_method in ('mpesa','mpesa_manual') then 'mpesa' else p_method end
$$;
drop index if exists public.payments_ref_uq;
create unique index if not exists payments_ref_invoice_uq
  on public.payments(hospital_id, public.payment_ref_family(method), upper(reference), invoice_id)
  where kind = 'payment' and reference is not null
    and status in ('pending','completed')
    and method not in ('cash','card_pos','other');
create unique index if not exists payments_gateway_ref_uq
  on public.payments(hospital_id, public.payment_ref_family(method), upper(reference))
  where kind = 'payment' and reference is not null and provider <> 'manual'
    and status in ('pending','completed');

alter table public.payments enable row level security;
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select using (public.pay_is_member(hospital_id));
revoke insert, update, delete on public.payments from anon, authenticated;
grant select on public.payments to authenticated;

create or replace function public.payments_before_write()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    if old.status = 'completed' then
      if new.status not in ('completed','reversed')
         or new.amount is distinct from old.amount
         or new.invoice_id is distinct from old.invoice_id
         or new.method is distinct from old.method
         or new.kind is distinct from old.kind then
        raise exception 'Completed payments are immutable (payment %). Use a refund.', old.id;
      end if;
    elsif old.status in ('failed','cancelled','expired') and new.status = 'pending' then
      raise exception 'Cannot reopen a % payment', old.status;
    end if;
  end if;
  if new.status = 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
    if new.receipt_no is null then
      new.receipt_no := public.next_receipt_no(new.hospital_id,
                          case when new.kind = 'refund' then 'RFD' else 'RCP' end);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_payments_before_write on public.payments;
create trigger trg_payments_before_write
  before insert or update on public.payments
  for each row execute function public.payments_before_write();

create or replace function public.recompute_invoice_payments(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_total numeric; v_cur text; v_cur_method text;
  v_paid numeric; v_n int; v_last text; v_status text; v_label text; v_prev_flag text;
begin
  select coalesce(amount_kes,0), status, payment_method
    into v_total, v_cur, v_cur_method
  from public.invoices where id = p_invoice for update;
  if not found then return; end if;

  select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0),
         count(distinct method) filter (where kind = 'payment'),
         (array_agg(method order by completed_at desc nulls last)
            filter (where kind = 'payment'))[1]
    into v_paid, v_n, v_last
  from public.payments where invoice_id = p_invoice and status = 'completed';

  v_paid := greatest(v_paid, 0);
  v_status := case
    when v_cur in ('Cancelled','Approved') then v_cur
    when v_total > 0 and v_paid >= v_total then 'Paid'
    when v_paid > 0 then 'Partial'
    else 'Pending' end;

  v_label := case when v_n > 1 then 'Split' else case v_last
    when 'cash' then 'Cash' when 'mpesa' then 'M-Pesa' when 'mpesa_manual' then 'M-Pesa'
    when 'airtel_money' then 'Airtel Money' when 'card_online' then 'Card' when 'card_pos' then 'Card'
    when 'bank_transfer' then 'Bank Transfer' when 'cheque' then 'Cheque' else null end end;

  v_prev_flag := coalesce(current_setting('app.payments_recompute', true), '');
  perform set_config('app.payments_recompute', 'on', true);
  update public.invoices set
    paid_kes       = v_paid,
    balance_kes    = greatest(v_total - v_paid, 0),
    status         = v_status,
    paid_at        = case when v_status = 'Paid' then coalesce(paid_at, now()) else null end,
    payment_method = case
      when v_label is not null and (coalesce(v_cur_method,'') = ''
        or v_cur_method in ('Cash','M-Pesa','Airtel Money','Card','Bank Transfer','Cheque','Split'))
      then v_label else payment_method end
  where id = p_invoice;
  perform set_config('app.payments_recompute', v_prev_flag, true);
end $$;

create or replace function public.payments_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status = old.status and new.amount = old.amount
     and new.method = old.method and new.invoice_id = old.invoice_id then
    return null;
  end if;
  perform public.recompute_invoice_payments(coalesce(new.invoice_id, old.invoice_id));
  if tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id then
    perform public.recompute_invoice_payments(old.invoice_id);
  end if;
  return null;
end $$;

drop trigger if exists trg_payments_after_write on public.payments;
create trigger trg_payments_after_write
  after insert or update or delete on public.payments
  for each row execute function public.payments_after_write();

create or replace function public.payments_audit(p_hospital uuid, p_action text, p_target uuid, p_details jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_target_type text; v_details_type text; v_hosp_type text;
begin
  select max(format_type(a.atttypid, a.atttypmod)) filter (where a.attname = 'target_id'),
         max(format_type(a.atttypid, a.atttypmod)) filter (where a.attname = 'details'),
         max(format_type(a.atttypid, a.atttypmod)) filter (where a.attname = 'hospital_id')
    into v_target_type, v_details_type, v_hosp_type
    from pg_attribute a
   where a.attrelid = to_regclass('public.audit_log') and a.attnum > 0 and not a.attisdropped;
  if v_details_type is null then return; end if;
  execute format(
    'insert into public.audit_log(hospital_id, user_role, action, target_table, target_id, details, performed_at)
     values ($1::%s, $2, $3, ''payments'', $4::%s, $5::%s, now())',
    coalesce(v_hosp_type, 'text'), coalesce(v_target_type, 'text'), v_details_type)
  using p_hospital::text, coalesce(public.pay_member_role(p_hospital), 'system'), p_action, p_target::text, p_details::text;
exception when others then
  raise warning 'payments_audit failed: %', sqlerrm;  -- never block a payment because audit failed
end $$;

create or replace function public.invoice_open_amount(p_invoice uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select greatest(coalesce(i.amount_kes,0)
         - coalesce((select sum(case when p.kind='payment' then p.amount else -p.amount end)
                       from public.payments p
                      where p.invoice_id = i.id
                        and ((p.kind = 'payment' and p.status in ('completed','pending'))
                          or (p.kind = 'refund'  and p.status = 'completed'))),0), 0)
  from public.invoices i
  where i.id = p_invoice and (auth.uid() is null or public.pay_is_member(i.hospital_id))
$$;

create or replace function public.record_manual_payments(
  p_invoice_id uuid, p_lines jsonb, p_idempotency_key text default null)
returns setof public.payments language plpgsql security definer set search_path = public as $$
declare
  v_inv public.invoices%rowtype; v_line jsonb; v_idx int := 0; v_key text;
  v_method text; v_amt numeric; v_tend numeric; v_ref text; v_status text;
  v_sum numeric := 0; v_open numeric; v_row public.payments%rowtype; v_cons text;
  v_prefix text; v_other_invoice uuid; v_review text; v_clash record;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if not public.can_take_payments(v_inv.hospital_id) then
    raise exception 'You are not allowed to record payments';
  end if;
  if v_inv.status = 'Cancelled' then raise exception 'Invoice is cancelled'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'No payment lines supplied';
  end if;

  if p_idempotency_key is not null then
    if length(p_idempotency_key) not between 1 and 120 then raise exception 'Invalid idempotency key'; end if;
    v_prefix := p_idempotency_key || ':';
    select invoice_id into v_other_invoice from public.payments
     where hospital_id = v_inv.hospital_id and left(idempotency_key, length(v_prefix)) = v_prefix limit 1;
    if found then
      if v_other_invoice <> v_inv.id then
        raise exception 'This request was already used for a different invoice — reload and try again';
      end if;
      return query select * from public.payments
        where hospital_id = v_inv.hospital_id and left(idempotency_key, length(v_prefix)) = v_prefix
        order by idempotency_key;
      return;
    end if;
  end if;

  v_open := public.invoice_open_amount(p_invoice_id);
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if coalesce(v_line->>'amount', '') !~ '^\s*\d+(\.\d+)?\s*$' then
      raise exception 'Each payment line needs a valid amount';
    end if;
    v_sum := v_sum + round((v_line->>'amount')::numeric, 2);
  end loop;
  if v_sum <= 0 then raise exception 'Amount must be greater than zero'; end if;
  if v_sum > v_open + 0.005 then
    raise exception 'Payment (%) exceeds the open balance (%)', v_sum, v_open;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_idx := v_idx + 1;
    v_method := v_line->>'method';
    v_amt    := round((v_line->>'amount')::numeric, 2);
    v_tend   := nullif(trim(coalesce(v_line->>'tendered','')),'')::numeric;
    v_ref    := upper(nullif(trim(v_line->>'reference'), ''));
    v_status := case when v_method = 'cheque' then 'pending' else 'completed' end;
    v_review := null;

    if v_method is null or v_method not in ('cash','mpesa_manual','airtel_money','card_pos','bank_transfer','cheque','other') then
      raise exception 'Method % cannot be recorded manually', coalesce(v_method, '(none)');
    end if;
    if v_amt <= 0 then raise exception 'Amount must be greater than zero'; end if;
    if v_method in ('mpesa_manual','bank_transfer','airtel_money') and v_ref is null then
      raise exception 'A transaction reference is required for %', v_method;
    end if;
    if v_method = 'mpesa_manual' and v_ref !~ '^[A-Z0-9]{10}$' then
      raise exception 'M-Pesa code must be 10 letters/digits (e.g. SGH7K2L9QX)';
    end if;
    if v_method = 'card_pos' and (v_ref is null or coalesce(v_line->>'card_last4','') !~ '^[0-9]{4}$') then
      raise exception 'POS card payments need the approval code and last 4 digits';
    end if;
    if v_method = 'cheque' then
      v_ref := upper(nullif(trim(v_line->>'cheque_no'),''));
      if v_ref is null then raise exception 'Cheque number is required'; end if;
    end if;
    if v_method = 'cash' and v_tend is not null and v_tend < v_amt then
      raise exception 'Cash tendered is less than the amount';
    end if;

    if v_ref is not null and v_method in ('mpesa_manual','airtel_money','bank_transfer','cheque') then
      perform pg_advisory_xact_lock(hashtext(v_inv.hospital_id::text || '|' || payment_ref_family(v_method) || '|' || v_ref));
      for v_clash in
        select p.provider, p.patient_id, i.invoice_no, i.patient_name
          from public.payments p join public.invoices i on i.id = p.invoice_id
         where p.hospital_id = v_inv.hospital_id and p.kind = 'payment'
           and p.status in ('pending','completed')
           and payment_ref_family(p.method) = payment_ref_family(v_method)
           and upper(p.reference) = v_ref and p.invoice_id <> v_inv.id
      loop
        if v_clash.provider <> 'manual' then
          raise exception 'Reference % was already received through % for invoice %', v_ref, v_clash.provider, v_clash.invoice_no;
        end if;
        if v_method in ('mpesa_manual','airtel_money')
           and not (v_clash.patient_id is not null and v_clash.patient_id = v_inv.patient_id)
           and not (v_clash.patient_id is null and v_inv.patient_id is null
                    and lower(trim(coalesce(v_clash.patient_name,''))) = lower(trim(coalesce(v_inv.patient_name,'')))
                    and coalesce(v_inv.patient_name,'') <> '') then
          raise exception 'Reference % has already been used for another patient (invoice %)', v_ref, v_clash.invoice_no;
        end if;
        v_review := concat_ws('; ', v_review, 'Same reference also used on invoice ' || coalesce(v_clash.invoice_no, '?'));
      end loop;
      if v_review is not null then
        v_review := v_review || ' — confirm the SMS / bank slip covers the combined amount';
      end if;
    end if;

    v_key := case when p_idempotency_key is null then null
                  else v_prefix || lpad(v_idx::text, 3, '0') end;

    begin
    insert into public.payments(
      hospital_id, invoice_id, patient_id, visit_id, method, provider, status, amount,
      tendered, change_given, reference, idempotency_key, payer_name, payer_phone,
      card_brand, card_last4, bank_name, cheque_no, terminal_id, notes,
      needs_review, review_note, created_by, created_by_role)
    values (
      v_inv.hospital_id, v_inv.id, v_inv.patient_id, v_inv.visit_id, v_method, 'manual', v_status, v_amt,
      case when v_method = 'cash' then coalesce(v_tend, v_amt) end,
      case when v_method = 'cash' then greatest(coalesce(v_tend, v_amt) - v_amt, 0) end,
      v_ref,
      v_key, nullif(v_line->>'payer_name',''), nullif(v_line->>'payer_phone',''),
      nullif(v_line->>'card_brand',''), nullif(v_line->>'card_last4',''),
      nullif(v_line->>'bank_name',''), nullif(v_line->>'cheque_no',''), nullif(v_line->>'terminal_id',''),
      nullif(v_line->>'notes',''), v_review is not null, v_review,
      auth.uid(), public.pay_member_role(v_inv.hospital_id))
    returning * into v_row;
    exception when unique_violation then
      get stacked diagnostics v_cons = constraint_name;
      if v_cons in ('payments_ref_invoice_uq', 'payments_gateway_ref_uq') then
        raise exception 'Reference % has already been used on this invoice', v_ref;
      elsif v_cons = 'payments_idem_uq' then
        raise exception 'This payment was already submitted — refresh to see it';
      else
        raise;
      end if;
    end;

    perform public.payments_audit(v_inv.hospital_id, 'payment_recorded', v_row.id,
      jsonb_build_object('invoice', v_inv.invoice_no, 'method', v_method, 'amount', v_amt,
                         'status', v_status, 'receipt', v_row.receipt_no, 'review', v_review));
    return next v_row;
  end loop;
end $$;

create or replace function public.resolve_pending_payment(
  p_payment_id uuid, p_outcome text, p_note text default null)
returns public.payments language plpgsql security definer set search_path = public as $$
declare v_p public.payments%rowtype;
begin
  select * into v_p from public.payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if not public.can_manage_payments(v_p.hospital_id) then
    raise exception 'Only finance/admin can clear or bounce payments';
  end if;
  if v_p.status <> 'pending' then raise exception 'Payment is not pending'; end if;
  if p_outcome not in ('cleared','bounced') then raise exception 'Outcome must be cleared or bounced'; end if;

  update public.payments set
    status = case when p_outcome = 'cleared' then 'completed' else 'failed' end,
    failure_reason = case when p_outcome = 'bounced' then coalesce(p_note,'Bounced') end,
    notes = concat_ws(' | ', notes, p_note)
  where id = p_payment_id returning * into v_p;

  perform public.payments_audit(v_p.hospital_id, 'payment_' || p_outcome, v_p.id,
                                jsonb_build_object('note', p_note));
  return v_p;
end $$;

create or replace function public.cancel_pending_payment(p_payment_id uuid, p_reason text default null)
returns public.payments language plpgsql security definer set search_path = public as $$
declare v_p public.payments%rowtype;
begin
  select * into v_p from public.payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if not public.can_take_payments(v_p.hospital_id) then raise exception 'Not allowed'; end if;
  if v_p.status <> 'pending' then raise exception 'Only pending payments can be cancelled'; end if;
  if v_p.method = 'cheque' and not public.can_manage_payments(v_p.hospital_id) then
    raise exception 'Only finance/admin can cancel a cheque — mark it cleared or bounced instead';
  end if;
  update public.payments set status = 'cancelled', failure_reason = coalesce(p_reason,'Cancelled by cashier')
   where id = p_payment_id returning * into v_p;
  perform public.payments_audit(v_p.hospital_id, 'payment_cancelled', v_p.id, jsonb_build_object('reason', p_reason));
  return v_p;
end $$;

create or replace function public.record_manual_refund(
  p_payment_id uuid, p_amount numeric, p_reason text, p_reference text default null)
returns public.payments language plpgsql security definer set search_path = public as $$
declare v_p public.payments%rowtype; v_refunded numeric; v_row public.payments%rowtype;
begin
  select * into v_p from public.payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if not public.can_manage_payments(v_p.hospital_id) then
    raise exception 'Only finance/admin can issue refunds';
  end if;
  if v_p.kind <> 'payment' or v_p.status <> 'completed' then
    raise exception 'Only completed payments can be refunded';
  end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A refund reason is required'; end if;

  select coalesce(sum(amount),0) into v_refunded from public.payments
   where refund_of = v_p.id and status in ('completed','pending');
  if p_amount is null or p_amount <= 0 or round(p_amount,2) > v_p.amount - v_refunded + 0.005 then
    raise exception 'Refund must be between 0 and % (already refunded %)', v_p.amount - v_refunded, v_refunded;
  end if;

  insert into public.payments(hospital_id, invoice_id, patient_id, visit_id, kind, refund_of,
     method, provider, status, amount, reference, notes, created_by, created_by_role, source)
  values (v_p.hospital_id, v_p.invoice_id, v_p.patient_id, v_p.visit_id, 'refund', v_p.id,
     v_p.method, 'manual', 'completed', round(p_amount,2), nullif(trim(p_reference),''), p_reason,
     auth.uid(), public.pay_member_role(v_p.hospital_id), 'app')
  returning * into v_row;

  perform public.payments_audit(v_p.hospital_id, 'payment_refunded', v_row.id,
    jsonb_build_object('original', v_p.receipt_no, 'amount', p_amount, 'reason', p_reason));
  return v_row;
end $$;

create or replace function public.create_online_payment(
  p_invoice_id uuid, p_user uuid, p_method text, p_provider text, p_amount numeric,
  p_idempotency_key text, p_payer_name text, p_payer_phone text, p_payer_email text,
  p_allow_partial boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inv public.invoices%rowtype; v_open numeric; v_row public.payments%rowtype; v_level text;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  v_level := public.pay_access_level(v_inv.hospital_id, p_user);
  if v_level is null then raise exception 'You do not belong to this hospital'; end if;
  if v_level not in ('take','manage') then raise exception 'Your role cannot take payments'; end if;
  if v_inv.status = 'Cancelled' then raise exception 'Invoice is cancelled'; end if;

  select * into v_row from public.payments
   where hospital_id = v_inv.hospital_id and idempotency_key = p_idempotency_key;
  if found then
    if v_row.invoice_id <> v_inv.id then raise exception 'This request was already used for a different invoice'; end if;
    return jsonb_build_object('replay', true, 'payment', to_jsonb(v_row));
  end if;

  if p_method not in ('mpesa','card_online') then raise exception 'Unsupported online method'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than zero'; end if;
  v_open := public.invoice_open_amount(v_inv.id);
  if round(p_amount, 2) > v_open + 0.005 then
    raise exception 'Amount exceeds the open balance (KES %). A payment may already be awaiting confirmation.', v_open;
  end if;
  if not coalesce(p_allow_partial, true) and round(p_amount, 2) < v_open - 0.005 then
    raise exception 'Partial payments are disabled — pay the full balance';
  end if;

  insert into public.payments(hospital_id, invoice_id, patient_id, visit_id, kind, method, provider, status,
    amount, currency, payer_name, payer_phone, payer_email, idempotency_key, created_by, created_by_role, source)
  values (v_inv.hospital_id, v_inv.id, v_inv.patient_id, v_inv.visit_id, 'payment', p_method, p_provider, 'pending',
    round(p_amount, 2), 'KES', nullif(left(p_payer_name, 120), ''), p_payer_phone, nullif(p_payer_email, ''),
    p_idempotency_key, p_user, (select raw_role from public.pay_user_context(v_inv.hospital_id, p_user)), 'app')
  returning * into v_row;

  perform public.payments_audit(v_inv.hospital_id, 'payment_initiated', v_row.id,
    jsonb_build_object('invoice', v_inv.invoice_no, 'method', p_method, 'provider', p_provider, 'amount', p_amount));
  return jsonb_build_object('replay', false, 'payment', to_jsonb(v_row), 'invoice_no', v_inv.invoice_no);
end $$;

create or replace function public.create_gateway_refund(
  p_payment_id uuid, p_user uuid, p_amount numeric, p_reason text)
returns public.payments language plpgsql security definer set search_path = public as $$
declare v_p public.payments%rowtype; v_refunded numeric; v_row public.payments%rowtype;
begin
  select * into v_p from public.payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if coalesce(public.pay_access_level(v_p.hospital_id, p_user), '') <> 'manage' then
    raise exception 'Only finance/admin can issue refunds';
  end if;
  if v_p.kind <> 'payment' or v_p.status <> 'completed' then raise exception 'Only completed payments can be refunded'; end if;
  if v_p.provider not in ('paystack','flutterwave') then
    raise exception 'This gateway has no refund API here — refund outside the app and record it as a manual refund';
  end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A refund reason is required'; end if;
  select coalesce(sum(amount),0) into v_refunded from public.payments
   where refund_of = v_p.id and status in ('completed','pending');
  if p_amount is null or p_amount <= 0 or round(p_amount,2) > v_p.amount - v_refunded + 0.005 then
    raise exception 'Refund must be between 0 and % (already refunded %)', v_p.amount - v_refunded, v_refunded;
  end if;
  insert into public.payments(hospital_id, invoice_id, patient_id, visit_id, kind, refund_of, method, provider,
     status, amount, notes, created_by, created_by_role, source)
  values (v_p.hospital_id, v_p.invoice_id, v_p.patient_id, v_p.visit_id, 'refund', v_p.id, v_p.method, v_p.provider,
     'pending', round(p_amount,2), p_reason, p_user,
     (select raw_role from public.pay_user_context(v_p.hospital_id, p_user)), 'app')
  returning * into v_row;
  perform public.payments_audit(v_p.hospital_id, 'refund_requested', v_row.id,
    jsonb_build_object('original', v_p.receipt_no, 'amount', p_amount, 'reason', p_reason));
  return v_row;
end $$;

revoke execute on function
  public.pay_user_context(uuid, uuid), public.pay_access_level(uuid, uuid),
  public.next_receipt_no(uuid, text), public.recompute_invoice_payments(uuid),
  public.payments_audit(uuid, text, uuid, jsonb),
  public.create_online_payment(uuid, uuid, text, text, numeric, text, text, text, text, boolean),
  public.create_gateway_refund(uuid, uuid, numeric, text)
from public, anon, authenticated;
grant execute on function
  public.pay_user_context(uuid, uuid), public.pay_access_level(uuid, uuid),
  public.create_online_payment(uuid, uuid, text, text, numeric, text, text, text, text, boolean),
  public.create_gateway_refund(uuid, uuid, numeric, text),
  public.invoice_open_amount(uuid)
to service_role;

revoke execute on function
  public.record_manual_payments(uuid, jsonb, text), public.resolve_pending_payment(uuid, text, text),
  public.cancel_pending_payment(uuid, text), public.record_manual_refund(uuid, numeric, text, text),
  public.invoice_open_amount(uuid), public.set_payment_credentials(uuid, text, text, jsonb),
  public.payment_credentials_status(uuid)
from public, anon;
grant execute on function
  public.record_manual_payments(uuid, jsonb, text),
  public.resolve_pending_payment(uuid, text, text),
  public.cancel_pending_payment(uuid, text),
  public.record_manual_refund(uuid, numeric, text, text),
  public.invoice_open_amount(uuid),
  public.set_payment_credentials(uuid, text, text, jsonb),
  public.payment_credentials_status(uuid)
to authenticated;

create table if not exists public.payment_events (
  id           bigserial primary key,
  hospital_id  uuid,
  payment_id   uuid,
  provider     text not null,
  event_id     text,
  verified     boolean not null default false,
  payload      jsonb,
  error        text,
  received_at  timestamptz not null default now(),
  processed_at timestamptz
);
create unique index if not exists payment_events_dedupe
  on public.payment_events(provider, event_id) where event_id is not null;
alter table public.payment_events enable row level security;
revoke all on public.payment_events from anon, authenticated;

create or replace view public.payment_daily_summary with (security_invoker = true) as
select hospital_id,
       (coalesce(completed_at, created_at) at time zone 'Africa/Nairobi')::date as day,
       method, provider, created_by_role,
       sum(amount) filter (where kind = 'payment')                       as gross,
       sum(amount) filter (where kind = 'refund')                        as refunds,
       sum(case when kind = 'payment' then amount else -amount end)      as net,
       sum(fee_amount) filter (where kind = 'payment')                   as gateway_fees,
       count(*) filter (where kind = 'payment')                          as txn_count
from public.payments
where status = 'completed'
group by 1, 2, 3, 4, 5;
grant select on public.payment_daily_summary to authenticated;

do $$
begin
  insert into public.payments(hospital_id, invoice_id, patient_id, visit_id, method, provider,
                              status, amount, receipt_no, notes, source, created_at, completed_at)
  select i.hospital_id, i.id, i.patient_id, i.visit_id,
         case lower(coalesce(i.payment_method,''))
           when 'cash' then 'cash' when 'm-pesa' then 'mpesa_manual' else 'other' end,
         'manual', 'completed', i.paid_kes,
         'LEG-' || upper(replace(i.id::text,'-','')),  -- full id: a 10-char prefix can collide and abort the migration
         'Migrated from legacy invoices.paid_kes', 'legacy_backfill',
         coalesce(i.paid_at, i.created_at, now()), coalesce(i.paid_at, i.created_at, now())
  from public.invoices i
  where coalesce(i.paid_kes, 0) > 0 and i.hospital_id is not null
    and not exists (select 1 from public.payments p where p.invoice_id = i.id);
end $$;

create or replace function public.invoices_guard_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ledger numeric := 0; v_blocked boolean := false;
begin
  if coalesce(current_setting('app.payments_recompute', true), '') = 'on' then return new; end if;

  if tg_op = 'UPDATE' then
    select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0)
      into v_ledger from public.payments where invoice_id = new.id and status = 'completed';
    v_ledger := greatest(v_ledger, 0);
    if coalesce(new.paid_kes, 0) < v_ledger - 0.005 then
      perform public.payments_audit(new.hospital_id, 'legacy_paid_decrease_blocked', null,
        jsonb_build_object('invoice', new.invoice_no, 'invoice_id', new.id, 'attempted_paid', new.paid_kes,
                           'ledger_paid', v_ledger, 'previous_paid', old.paid_kes));
      new.paid_kes := v_ledger;
      v_blocked := true;
    end if;
  end if;

  new.paid_kes := coalesce(new.paid_kes, 0);

  if v_blocked or (tg_op = 'UPDATE' and new.amount_kes is distinct from old.amount_kes) then
    new.balance_kes := greatest(coalesce(new.amount_kes, 0) - new.paid_kes, 0);
    if coalesce(new.status, '') not in ('Cancelled', 'Approved') then
      new.status := case when coalesce(new.amount_kes, 0) > 0 and new.paid_kes >= new.amount_kes then 'Paid'
                         when new.paid_kes > 0 then 'Partial' else 'Pending' end;
      new.paid_at := case when new.status = 'Paid' then coalesce(old.paid_at, new.paid_at, now()) else null end;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_invoices_guard_ledger on public.invoices;
create trigger trg_invoices_guard_ledger
  before insert or update on public.invoices
  for each row execute function public.invoices_guard_ledger();

create or replace function public.invoices_sync_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ledger numeric; v_diff numeric; v_method text;
begin
  if coalesce(current_setting('app.payments_recompute', true), '') = 'on' then return null; end if;
  if new.hospital_id is null then return null; end if;
  if tg_op = 'UPDATE' and new.paid_kes is not distinct from old.paid_kes then return null; end if;

  select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0)
    into v_ledger from public.payments where invoice_id = new.id and status = 'completed';
  v_diff := round(coalesce(new.paid_kes, 0) - v_ledger, 2);
  if v_diff <= 0 then return null; end if;

  v_method := case lower(coalesce(new.payment_method, ''))
    when 'cash' then 'cash' when 'm-pesa' then 'mpesa_manual' when 'mpesa' then 'mpesa_manual'
    when 'airtel money' then 'airtel_money' when 'card' then 'card_pos'
    when 'bank transfer' then 'bank_transfer' when 'cheque' then 'cheque'
    else 'other' end;
  insert into public.payments(hospital_id, invoice_id, patient_id, visit_id, method, provider, status,
                              amount, notes, source, created_by, created_by_role)
  values (new.hospital_id, new.id, new.patient_id, new.visit_id, v_method, 'manual', 'completed', v_diff,
          'Recorded via legacy invoice update' ||
            case when v_method = 'other' and coalesce(new.payment_method, '') <> ''
                 then ' (' || new.payment_method || ')' else '' end,
          'legacy_sync', auth.uid(), public.pay_member_role(new.hospital_id));
  return null;
end $$;

drop trigger if exists trg_invoices_sync_ledger on public.invoices;
create trigger trg_invoices_sync_ledger
  after insert or update of paid_kes on public.invoices
  for each row execute function public.invoices_sync_ledger();

do $$ begin
  if to_regclass('public.mpesa_transactions') is not null then
    alter table public.mpesa_transactions add column if not exists payment_id uuid;
    create index if not exists mpesa_transactions_payment_idx on public.mpesa_transactions(payment_id);
  end if;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.payments;
exception when others then null; end $$;


commit;

-- ---------------------------------------------------------------- health check (read-only)
select check_name, case when ok then 'OK' else 'PROBLEM' end as result, detail from (
  select 'tables created' as check_name,
         (select count(*) from pg_class where oid in (to_regclass('public.payments'), to_regclass('public.receipt_counters'),
           to_regclass('public.payment_events'), to_regclass('public.hospital_payment_settings'),
           to_regclass('public.hospital_payment_credentials'), to_regclass('public.payment_daily_summary'))) = 6 as ok,
         '6 expected' as detail
  union all
  select 'invoice triggers', (select count(*) from pg_trigger where tgrelid = 'public.invoices'::regclass
           and tgname in ('trg_invoices_guard_ledger', 'trg_invoices_sync_ledger')) = 2, 'guard + bridge'
  union all
  select 'payment triggers', (select count(*) from pg_trigger where tgrelid = 'public.payments'::regclass
           and tgname in ('trg_payments_before_write', 'trg_payments_after_write')) = 2, 'immutability + recompute'
  union all
  select 'history back-filled', true,
         (select count(*) || ' legacy payments, KES ' || coalesce(sum(amount), 0) from public.payments where source = 'legacy_backfill')
  union all
  select 'paid_kes matches the ledger', count(*) = 0, count(*) || ' invoices differ' from (
    select i.id from public.invoices i
    left join public.payments p on p.invoice_id = i.id and p.status = 'completed'
    where i.hospital_id is not null
    group by i.id, i.paid_kes
    having round(coalesce(i.paid_kes, 0), 2) <> round(greatest(coalesce(sum(case when p.kind = 'payment' then p.amount else -p.amount end), 0), 0), 2)) d
  union all
  select 'browser cannot call internal functions',
         not has_function_privilege('authenticated', 'public.next_receipt_no(uuid, text)', 'execute')
         and not has_function_privilege('authenticated', 'public.payments_audit(uuid, text, uuid, jsonb)', 'execute'),
         'next_receipt_no / payments_audit revoked'
  union all
  select 'browser cannot write payments', not has_table_privilege('authenticated', 'public.payments', 'insert'), 'writes only via RPCs'
) h;
