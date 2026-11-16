-- Pharmacy controls: (1) FEFO enforced by the database — stock leaves through pharmacy_fefo_issue() (earliest-expiry
-- batch first, atomically with the stock level), and a batch cannot be drawn down while an earlier-expiring batch of the
-- same medicine still has stock, nor dispensed once expired; (2) controlled-drug register with a running balance per
-- location (pharmacy and each ward), a second person who witnesses with their own login, balance checks that flag
-- discrepancies, and ward transfers that post on both sides; (3) ward imprest stock with par levels, usage, counts and
-- top-up requests issued by the pharmacy (FEFO) and received by the ward.

do $$ begin
  if to_regclass('public.pharmacy_inventory') is null or to_regclass('public.drug_batches') is null then
    raise exception 'pharmacy_inventory / drug_batches not found: Pharmacy controls need the original RemedacareHMS pharmacy tables.';
  end if;
end $$;

alter table public.pharmacy_inventory add column if not exists controlled_drug boolean not null default false;
alter table public.drug_batches add column if not exists inventory_id uuid;
alter table public.drug_batches add column if not exists last_change_reason text;
alter table public.drug_batches add column if not exists received_at timestamptz default now();   -- consumed by the trigger, then cleared

create table if not exists public.pharmacy_batch_movements (
  id          bigserial primary key,
  hospital_id uuid not null,
  batch_id    uuid not null,
  drug_name   text,
  delta       numeric not null,
  reason      text not null,
  reference   text,
  performed_by uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists pharmacy_batch_movements_batch on public.pharmacy_batch_movements(batch_id, created_at desc);

create or replace function public.pharm_is_staff(p_hospital uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select c.member and c.staff_active and (c.canonical = 'admin' or lower(coalesce(c.raw_role, '')) ~ 'pharm')
                     from public.pay_user_context(p_hospital, auth.uid()) c), false)
$$;

-- Batches belonging to the same medicine as batch b: same inventory item, or (for batches not linked to one) the same name
create or replace function public.pharm_same_medicine(b_inventory uuid, b_name text, o_inventory uuid, o_name text)
returns boolean language sql immutable as $$
  select case when b_inventory is not null and o_inventory is not null then b_inventory = o_inventory
              else lower(trim(coalesce(b_name, ''))) = lower(trim(coalesce(o_name, ''))) end
$$;

-- ---------------------------------------------------------------- FEFO guard on every batch change
create or replace function public.drug_batches_fefo_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare reason text := lower(coalesce(trim(new.last_change_reason), '')); earlier record; j jsonb := to_jsonb(new);
begin
  new.last_change_reason := null;
  if tg_op = 'UPDATE' and coalesce(new.quantity_remaining, 0) < coalesce(old.quantity_remaining, 0) then
    if reason ~ '^(write_off|writeoff|write-off|return|stock_take|recall|quarantine)' or lower(coalesce(new.status, '')) in ('written off', 'quarantined', 'recalled') then
      null;   -- not a dispense: write-off / return to supplier / stock-take correction
    elsif reason ~ '^override:' then
      if not public.pharm_is_staff(new.hospital_id) then raise exception 'Only a pharmacist can override first-expiry-first-out'; end if;
      if length(trim(substr(reason, 10))) < 5 then raise exception 'Give the reason for the FEFO override'; end if;
    else
      if (j->>'expiry_date') is not null and (j->>'expiry_date')::date < current_date then
        raise exception 'Batch % expired on %: expired stock cannot be dispensed (write it off)', new.batch_number, j->>'expiry_date';
      end if;
      select b.batch_number, b.expiry_date into earlier from public.drug_batches b
       where b.hospital_id = new.hospital_id and b.id <> new.id and coalesce(b.quantity_remaining, 0) > 0
         and lower(coalesce(b.status, 'active')) not in ('written off', 'quarantined', 'recalled', 'expired')
         and b.expiry_date >= current_date and b.expiry_date < (j->>'expiry_date')::date
         and public.pharm_same_medicine(new.inventory_id, new.drug_name, b.inventory_id, b.drug_name)
       order by b.expiry_date limit 1;
      if earlier.batch_number is not null then
        raise exception 'First expiry, first out: use batch % (expires %) before batch %', earlier.batch_number, to_char(earlier.expiry_date, 'DD Mon YYYY'), new.batch_number;
      end if;
    end if;
  end if;
  if tg_op = 'INSERT' or coalesce(new.quantity_remaining, 0) <> coalesce(old.quantity_remaining, 0) then
    insert into public.pharmacy_batch_movements(hospital_id, batch_id, drug_name, delta, reason)
    values (new.hospital_id, new.id, new.drug_name, coalesce(new.quantity_remaining, 0) - case when tg_op = 'INSERT' then 0 else coalesce(old.quantity_remaining, 0) end,
            coalesce(nullif(reason, ''), case when tg_op = 'INSERT' then 'receipt' when coalesce(new.quantity_remaining, 0) > coalesce(old.quantity_remaining, 0) then 'increase' else 'dispense' end));
  end if;
  return new;
end $$;
drop trigger if exists trg_drug_batches_fefo_guard on public.drug_batches;
create trigger trg_drug_batches_fefo_guard before insert or update on public.drug_batches for each row execute function public.drug_batches_fefo_guard();

-- Issue stock of one medicine, earliest-expiry batch first, together with the stock level. Returns the allocations.
-- Medicines with no batch records at all are issued from the stock level only.
create or replace function public.pharmacy_fefo_issue(p_inventory uuid, p_qty numeric, p_reference text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare inv jsonb; v_h uuid; left_qty numeric := p_qty; b record; take numeric; alloc jsonb := '[]'; tracked int; stock numeric;
begin
  select to_jsonb(i) into inv from public.pharmacy_inventory i where i.id = p_inventory for update;
  if inv is null then raise exception 'Medicine not found in pharmacy stock'; end if;
  v_h := (inv->>'hospital_id')::uuid;
  if not public.pharm_is_staff(v_h) and not coalesce(current_setting('app.ward_topup', true), '') = 'on' then
    raise exception 'Only pharmacy staff can issue stock';
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be more than zero'; end if;
  stock := coalesce((inv->>'quantity_in_stock')::numeric, 0);
  if stock < p_qty then raise exception '% : need %, only % in stock', inv->>'drug_name', p_qty, stock; end if;

  select count(*) into tracked from public.drug_batches d where d.hospital_id = v_h
     and public.pharm_same_medicine(p_inventory, inv->>'drug_name', d.inventory_id, d.drug_name);
  if tracked > 0 then
    for b in select d.id, d.batch_number, d.expiry_date, d.quantity_remaining from public.drug_batches d
              where d.hospital_id = v_h and coalesce(d.quantity_remaining, 0) > 0 and d.expiry_date >= current_date
                and lower(coalesce(d.status, 'active')) not in ('written off', 'quarantined', 'recalled', 'expired')
                and public.pharm_same_medicine(p_inventory, inv->>'drug_name', d.inventory_id, d.drug_name)
              order by d.expiry_date, d.received_at nulls last, d.id for update loop
      exit when left_qty <= 0;
      take := least(left_qty, b.quantity_remaining);
      update public.drug_batches set quantity_remaining = quantity_remaining - take, last_change_reason = 'fefo_issue' where id = b.id;
      update public.pharmacy_batch_movements set reference = p_reference where id = (select max(id) from public.pharmacy_batch_movements where batch_id = b.id);
      alloc := alloc || jsonb_build_object('batch_id', b.id, 'batch_number', b.batch_number, 'expiry_date', b.expiry_date, 'quantity', take);
      left_qty := left_qty - take;
    end loop;
    if left_qty > 0 then raise exception '% : unexpired batches cover only % of %', inv->>'drug_name', p_qty - left_qty, p_qty; end if;
  end if;
  update public.pharmacy_inventory set quantity_in_stock = quantity_in_stock - p_qty where id = p_inventory;
  return jsonb_build_object('inventory_id', p_inventory, 'quantity', p_qty, 'batches', alloc, 'tracked', tracked > 0);
end $$;

-- ---------------------------------------------------------------- controlled drug register
create table if not exists public.cd_register (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid not null,
  inventory_id     uuid not null,
  drug_name        text,
  location         text not null default 'Pharmacy',
  entry_type       text not null check (entry_type in ('receipt', 'issue_patient', 'issue_ward', 'received_from_pharmacy', 'administered',
                                                       'return_to_pharmacy', 'return_from_ward', 'destruction', 'adjustment', 'balance_check')),
  quantity         numeric not null,                 -- for balance_check: the counted quantity; adjustment may be negative
  delta            numeric,
  balance_after    numeric,
  discrepancy      numeric,
  patient_id       uuid,
  prescription_id  text,
  prescriber       text,
  counterpart      text,                             -- ward issued to / pharmacy, supplier and invoice for receipts
  batch_number     text,
  reason           text,
  linked_entry_id  uuid,
  recorded_by      uuid default auth.uid(),
  recorded_by_name text,
  witness_by       uuid,
  witness_name     text,
  witnessed_at     timestamptz,
  created_at       timestamptz not null default clock_timestamp()
);
create index if not exists cd_register_ledger on public.cd_register(hospital_id, inventory_id, location, created_at desc);
create index if not exists cd_register_unwitnessed on public.cd_register(hospital_id) where witness_by is null;

create or replace function public.cd_register_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare inv jsonb; bal numeric; d numeric;
begin
  if tg_op = 'UPDATE' then
    if old.witness_by is not null or (to_jsonb(new) - array['witness_by', 'witness_name', 'witnessed_at']) is distinct from (to_jsonb(old) - array['witness_by', 'witness_name', 'witnessed_at']) then
      raise exception 'Controlled drug register entries cannot be changed; record a correcting entry';
    end if;
    return new;
  end if;
  select to_jsonb(i) into inv from public.pharmacy_inventory i where i.id = new.inventory_id;
  if inv is null or (inv->>'hospital_id')::uuid is distinct from new.hospital_id then raise exception 'Medicine not found'; end if;
  if not coalesce((inv->>'controlled_drug')::boolean, false) then raise exception '% is not marked as a controlled medicine', inv->>'drug_name'; end if;
  new.drug_name := inv->>'drug_name';
  new.location := coalesce(nullif(trim(new.location), ''), 'Pharmacy');
  new.witness_by := null; new.witness_name := null; new.witnessed_at := null;
  if new.entry_type <> 'adjustment' and new.quantity <= 0 and new.entry_type <> 'balance_check' then raise exception 'Quantity must be more than zero'; end if;
  if new.entry_type = 'balance_check' and new.quantity < 0 then raise exception 'Counted quantity cannot be negative'; end if;
  if new.entry_type = 'adjustment' and new.quantity = 0 then raise exception 'An adjustment cannot be zero'; end if;

  perform pg_advisory_xact_lock(hashtext(new.hospital_id::text || new.inventory_id::text || lower(new.location)));
  select r.balance_after into bal from public.cd_register r
   where r.hospital_id = new.hospital_id and r.inventory_id = new.inventory_id and lower(r.location) = lower(new.location)
   order by r.created_at desc, r.id desc limit 1;
  bal := coalesce(bal, 0);

  d := case new.entry_type
         when 'receipt' then new.quantity when 'received_from_pharmacy' then new.quantity when 'return_from_ward' then new.quantity
         when 'adjustment' then new.quantity when 'balance_check' then 0
         else -new.quantity end;
  if new.entry_type in ('issue_patient', 'administered') and new.patient_id is null then raise exception 'Name the patient'; end if;
  if new.entry_type = 'issue_patient' and coalesce(trim(new.prescriber), '') = '' then raise exception 'Record the prescriber'; end if;
  if new.entry_type = 'issue_ward' and coalesce(trim(new.counterpart), '') = '' then raise exception 'Name the ward receiving the stock'; end if;
  if new.entry_type in ('destruction', 'adjustment') and coalesce(trim(new.reason), '') = '' then raise exception 'Give the reason'; end if;
  if new.entry_type = 'adjustment' and not public.pharm_is_staff(new.hospital_id) then raise exception 'Only a pharmacist can adjust the register'; end if;
  if new.entry_type in ('receipt', 'issue_ward', 'return_from_ward') and lower(new.location) <> 'pharmacy' then raise exception 'That entry belongs in the pharmacy register'; end if;
  if new.entry_type in ('received_from_pharmacy', 'administered', 'return_to_pharmacy') and lower(new.location) = 'pharmacy' then raise exception 'That entry belongs in a ward register'; end if;

  new.delta := d;
  if new.entry_type = 'balance_check' then
    new.discrepancy := new.quantity - bal;
    if new.discrepancy <> 0 and coalesce(trim(new.reason), '') = '' then
      raise exception 'The count (%) differs from the register balance (%): explain the discrepancy and inform the pharmacist in charge', new.quantity, bal;
    end if;
  elsif bal + d < 0 then
    raise exception 'The % register balance for % is %: this entry would make it negative', new.location, new.drug_name, bal;
  end if;
  new.balance_after := bal + d;
  new.created_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists trg_cd_register_before on public.cd_register;
create trigger trg_cd_register_before before insert or update on public.cd_register for each row execute function public.cd_register_before();

create or replace function public.cd_register_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.entry_type = 'issue_ward' then
    insert into public.cd_register(hospital_id, inventory_id, location, entry_type, quantity, counterpart, batch_number, linked_entry_id, recorded_by, recorded_by_name)
    values (new.hospital_id, new.inventory_id, new.counterpart, 'received_from_pharmacy', new.quantity, 'Pharmacy', new.batch_number, new.id, new.recorded_by, new.recorded_by_name);
  elsif new.entry_type = 'return_to_pharmacy' then
    insert into public.cd_register(hospital_id, inventory_id, location, entry_type, quantity, counterpart, batch_number, linked_entry_id, recorded_by, recorded_by_name)
    values (new.hospital_id, new.inventory_id, 'Pharmacy', 'return_from_ward', new.quantity, new.location, new.batch_number, new.id, new.recorded_by, new.recorded_by_name);
  elsif new.entry_type = 'balance_check' and new.discrepancy <> 0 then
    begin
      execute 'insert into public.notifications(hospital_id, notification_type, title, message, target_path, payload_json) values ($1, ''alert'', ''Controlled drug discrepancy'', $2, ''/pharmacy'', $3)'
        using new.hospital_id, new.location || ': ' || new.drug_name || ' counted ' || new.quantity || ', register says ' || new.balance_after || '. ' || coalesce(new.reason, ''),
              jsonb_build_object('cd_entry_id', new.id);
    exception when others then raise warning 'discrepancy notification skipped: %', sqlerrm;
    end;
  end if;
  return null;
end $$;
drop trigger if exists trg_cd_register_after on public.cd_register;
create trigger trg_cd_register_after after insert on public.cd_register for each row execute function public.cd_register_after();

-- The witness signs with their own login: a different person from the one who made the entry.
create or replace function public.cd_witness(p_entry uuid, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e public.cd_register;
begin
  select * into e from public.cd_register where id = p_entry for update;
  if e.id is null or not public.clin_can_access(e.hospital_id) then raise exception 'Entry not found'; end if;
  if e.witness_by is not null then raise exception 'Already witnessed'; end if;
  if e.recorded_by = auth.uid() then raise exception 'A second person must witness this entry, signed in with their own account'; end if;
  if e.entry_type in ('destruction', 'adjustment') and not public.pharm_is_staff(e.hospital_id) then raise exception 'A pharmacist must witness destruction and adjustments'; end if;
  update public.cd_register set witness_by = auth.uid(), witness_name = coalesce(nullif(trim(p_name), ''), 'Witness'), witnessed_at = now() where id = p_entry;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cd_balances(p_hospital uuid)
returns table(inventory_id uuid, drug_name text, location text, balance numeric, last_entry_at timestamptz, last_check_at timestamptz, unwitnessed bigint)
language sql stable security definer set search_path = public as $$
  select distinct on (r.inventory_id, lower(r.location)) r.inventory_id, r.drug_name, r.location, r.balance_after, r.created_at,
         (select max(c.created_at) from public.cd_register c where c.hospital_id = r.hospital_id and c.inventory_id = r.inventory_id and lower(c.location) = lower(r.location) and c.entry_type = 'balance_check'),
         (select count(*) from public.cd_register w where w.hospital_id = r.hospital_id and w.inventory_id = r.inventory_id and lower(w.location) = lower(r.location) and w.witness_by is null)
    from public.cd_register r
   where r.hospital_id = p_hospital and public.clin_can_access(p_hospital)
   order by r.inventory_id, lower(r.location), r.created_at desc, r.id desc
$$;

-- ---------------------------------------------------------------- ward imprest
create table if not exists public.ward_stock (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null,
  ward         text not null,
  inventory_id uuid not null,
  drug_name    text,
  par_level    numeric not null default 0 check (par_level >= 0),
  quantity     numeric not null default 0 check (quantity >= 0),
  active       boolean not null default true,
  updated_at   timestamptz not null default now(),
  unique (hospital_id, ward, inventory_id)
);

create table if not exists public.ward_stock_moves (
  id            bigserial primary key,
  hospital_id   uuid not null,
  ward_stock_id uuid not null references public.ward_stock(id) on delete cascade,
  kind          text not null check (kind in ('topup', 'use', 'return', 'expired', 'count')),
  quantity      numeric not null check (quantity >= 0),
  balance_after numeric,
  variance      numeric,
  patient_id    uuid,
  reference     text,
  reason        text,
  performed_by  uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists ward_stock_moves_item on public.ward_stock_moves(ward_stock_id, created_at desc);

create table if not exists public.ward_topup_requests (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null,
  ward         text not null,
  lines        jsonb not null check (jsonb_typeof(lines) = 'array'),   -- [{ward_stock_id, inventory_id, drug_name, requested, issued}]
  status       text not null default 'requested' check (status in ('requested', 'issued', 'received', 'cancelled')),
  requested_by uuid default auth.uid(),
  requested_at timestamptz not null default now(),
  issued_by    uuid,
  issued_at    timestamptz,
  received_by  uuid,
  received_at  timestamptz,
  notes        text
);
create index if not exists ward_topup_open on public.ward_topup_requests(hospital_id, status, requested_at desc);

create or replace function public.ward_stock_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare inv jsonb;
begin
  if tg_op = 'INSERT' then
    select to_jsonb(i) into inv from public.pharmacy_inventory i where i.id = new.inventory_id;
    if inv is null or (inv->>'hospital_id')::uuid is distinct from new.hospital_id then raise exception 'Medicine not found'; end if;
    new.drug_name := inv->>'drug_name';
    new.quantity := 0;                         -- stock only arrives through a top-up
  elsif new.quantity is distinct from old.quantity and coalesce(current_setting('app.ward_move', true), '') <> 'on' then
    raise exception 'Ward stock changes only through top-ups, use, returns and counts';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_ward_stock_before on public.ward_stock;
create trigger trg_ward_stock_before before insert or update on public.ward_stock for each row execute function public.ward_stock_before();

create or replace function public.ward_stock_moves_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare ws public.ward_stock; bal numeric;
begin
  select * into ws from public.ward_stock where id = new.ward_stock_id for update;
  if ws.id is null then raise exception 'Ward stock item not found'; end if;
  new.hospital_id := ws.hospital_id;
  if new.kind = 'topup' and coalesce(current_setting('app.ward_topup', true), '') <> 'on' then raise exception 'Top-ups arrive through a pharmacy top-up request'; end if;
  if new.kind = 'count' then
    new.variance := new.quantity - ws.quantity;
    if new.variance <> 0 and coalesce(trim(new.reason), '') = '' then raise exception 'The count (%) differs from the book balance (%): give the reason', new.quantity, ws.quantity; end if;
    bal := new.quantity;
  else
    if new.quantity <= 0 then raise exception 'Quantity must be more than zero'; end if;
    bal := ws.quantity + case when new.kind = 'topup' then new.quantity else -new.quantity end;
    if bal < 0 then raise exception 'Only % of % on the ward', ws.quantity, ws.drug_name; end if;
    if new.kind in ('return', 'expired') and coalesce(trim(new.reason), '') = '' and new.kind = 'expired' then new.reason := 'expired'; end if;
  end if;
  new.balance_after := bal;
  perform set_config('app.ward_move', 'on', true);
  update public.ward_stock set quantity = bal where id = ws.id;
  perform set_config('app.ward_move', 'off', true);
  return new;
end $$;
drop trigger if exists trg_ward_stock_moves_before on public.ward_stock_moves;
create trigger trg_ward_stock_moves_before before insert on public.ward_stock_moves for each row execute function public.ward_stock_moves_before();

create or replace function public.ward_stock_moves_immutable()
returns trigger language plpgsql as $$
begin raise exception 'Ward stock movements cannot be changed; record a count with the reason'; end $$;
drop trigger if exists trg_ward_stock_moves_immutable on public.ward_stock_moves;
create trigger trg_ward_stock_moves_immutable before update or delete on public.ward_stock_moves for each row execute function public.ward_stock_moves_immutable();

-- Top-up request for everything below par on a ward
create or replace function public.ward_topup_create(p_hospital uuid, p_ward text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_lines jsonb; v_id uuid;
begin
  if not public.clin_can_access(p_hospital) then raise exception 'Only clinical staff can request ward stock'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('ward_stock_id', id, 'inventory_id', inventory_id, 'drug_name', drug_name, 'requested', par_level - quantity, 'issued', 0) order by drug_name), '[]')
    into v_lines from public.ward_stock where hospital_id = p_hospital and lower(ward) = lower(p_ward) and active and quantity < par_level;
  if jsonb_array_length(v_lines) = 0 then raise exception 'Everything on % is at or above its par level', p_ward; end if;
  insert into public.ward_topup_requests(hospital_id, ward, lines) values (p_hospital, p_ward, v_lines) returning id into v_id;
  return v_id;
end $$;

-- Pharmacy issues: p_issued = {"<ward_stock_id>": qty, ...}; stock leaves FEFO; controlled medicines post to both registers
create or replace function public.ward_topup_issue(p_request uuid, p_issued jsonb, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.ward_topup_requests; l jsonb; q numeric; out_lines jsonb := '[]'; inv jsonb; alloc jsonb;
begin
  select * into r from public.ward_topup_requests where id = p_request for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if not public.pharm_is_staff(r.hospital_id) then raise exception 'Only pharmacy staff can issue ward stock'; end if;
  if r.status <> 'requested' then raise exception 'This request has already been %', r.status; end if;
  for l in select * from jsonb_array_elements(r.lines) loop
    q := coalesce((p_issued->>(l->>'ward_stock_id'))::numeric, 0);
    if q < 0 then raise exception 'Issued quantity cannot be negative'; end if;
    if q > 0 then
      alloc := public.pharmacy_fefo_issue((l->>'inventory_id')::uuid, q, 'Ward top-up ' || r.ward);
      select to_jsonb(i) into inv from public.pharmacy_inventory i where i.id = (l->>'inventory_id')::uuid;
      if coalesce((inv->>'controlled_drug')::boolean, false) then
        insert into public.cd_register(hospital_id, inventory_id, location, entry_type, quantity, counterpart, batch_number, recorded_by_name)
        values (r.hospital_id, (l->>'inventory_id')::uuid, 'Pharmacy', 'issue_ward', q, r.ward, alloc->'batches'->0->>'batch_number', p_name);
      end if;
    end if;
    out_lines := out_lines || (l || jsonb_build_object('issued', q));
  end loop;
  perform set_config('app.ward_topup', 'on', true);
  update public.ward_topup_requests set lines = out_lines, status = 'issued', issued_by = auth.uid(), issued_at = now() where id = r.id;
  perform set_config('app.ward_topup', 'off', true);
  return jsonb_build_object('lines', out_lines);
end $$;

create or replace function public.ward_topup_receive(p_request uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.ward_topup_requests; l jsonb;
begin
  select * into r from public.ward_topup_requests where id = p_request for update;
  if r.id is null or not public.clin_can_access(r.hospital_id) then raise exception 'Request not found'; end if;
  if r.status <> 'issued' then raise exception 'Only issued requests can be received'; end if;
  perform set_config('app.ward_topup', 'on', true);
  for l in select * from jsonb_array_elements(r.lines) loop
    if coalesce((l->>'issued')::numeric, 0) > 0 then
      insert into public.ward_stock_moves(hospital_id, ward_stock_id, kind, quantity, reference) values (r.hospital_id, (l->>'ward_stock_id')::uuid, 'topup', (l->>'issued')::numeric, 'Top-up ' || r.id);
    end if;
  end loop;
  update public.ward_topup_requests set status = 'received', received_by = auth.uid(), received_at = now() where id = r.id;
  perform set_config('app.ward_topup', 'off', true);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ward_topup_requests_guard()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.ward_topup', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then new.status := 'requested'; new.issued_by := null; new.issued_at := null; new.received_by := null; new.received_at := null; return new; end if;
  if new.status = 'cancelled' and old.status = 'requested' and (to_jsonb(new) - array['status', 'notes']) = (to_jsonb(old) - array['status', 'notes']) then return new; end if;
  raise exception 'Top-up requests change only through issue and receive';
end $$;
drop trigger if exists trg_ward_topup_requests_guard on public.ward_topup_requests;
create trigger trg_ward_topup_requests_guard before insert or update on public.ward_topup_requests for each row execute function public.ward_topup_requests_guard();

-- ---------------------------------------------------------------- access
alter table public.pharmacy_batch_movements enable row level security;
alter table public.cd_register enable row level security;
alter table public.ward_stock enable row level security;
alter table public.ward_stock_moves enable row level security;
alter table public.ward_topup_requests enable row level security;
drop policy if exists pharmacy_batch_movements_read on public.pharmacy_batch_movements;
drop policy if exists cd_register_read on public.cd_register;
drop policy if exists cd_register_insert on public.cd_register;
drop policy if exists ward_stock_read on public.ward_stock;
drop policy if exists ward_stock_manage on public.ward_stock;
drop policy if exists ward_stock_update on public.ward_stock;
drop policy if exists ward_stock_moves_clinical on public.ward_stock_moves;
drop policy if exists ward_topup_clinical on public.ward_topup_requests;
create policy pharmacy_batch_movements_read on public.pharmacy_batch_movements for select to authenticated using (public.pharm_is_staff(hospital_id));
create policy cd_register_read on public.cd_register for select to authenticated using (public.clin_can_access(hospital_id));
create policy cd_register_insert on public.cd_register for insert to authenticated with check (public.clin_can_access(hospital_id) and (lower(location) <> 'pharmacy' or public.pharm_is_staff(hospital_id)));
create policy ward_stock_read on public.ward_stock for select to authenticated using (public.clin_can_access(hospital_id));
create policy ward_stock_manage on public.ward_stock for insert to authenticated with check (public.pharm_is_staff(hospital_id));
create policy ward_stock_update on public.ward_stock for update to authenticated using (public.pharm_is_staff(hospital_id)) with check (public.pharm_is_staff(hospital_id));
create policy ward_stock_moves_clinical on public.ward_stock_moves for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
create policy ward_topup_clinical on public.ward_topup_requests for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));

revoke all on public.pharmacy_batch_movements, public.cd_register, public.ward_stock, public.ward_stock_moves, public.ward_topup_requests from anon;
grant select on public.pharmacy_batch_movements to authenticated;
grant select, insert on public.cd_register, public.ward_stock_moves to authenticated;
grant select, insert, update on public.ward_stock, public.ward_topup_requests to authenticated;
grant usage on sequence public.ward_stock_moves_id_seq, public.pharmacy_batch_movements_id_seq to authenticated;
grant all on public.pharmacy_batch_movements, public.cd_register, public.ward_stock, public.ward_stock_moves, public.ward_topup_requests to service_role;

revoke execute on function public.drug_batches_fefo_guard(), public.cd_register_before(), public.cd_register_after(), public.ward_stock_before(),
  public.ward_stock_moves_before(), public.ward_stock_moves_immutable(), public.ward_topup_requests_guard() from public, anon, authenticated;
revoke execute on function public.pharm_is_staff(uuid), public.pharmacy_fefo_issue(uuid, numeric, text), public.cd_witness(uuid, text), public.cd_balances(uuid),
  public.ward_topup_create(uuid, text), public.ward_topup_issue(uuid, jsonb, text), public.ward_topup_receive(uuid) from public, anon;
grant execute on function public.pharm_is_staff(uuid), public.pharmacy_fefo_issue(uuid, numeric, text), public.cd_witness(uuid, text), public.cd_balances(uuid),
  public.ward_topup_create(uuid, text), public.ward_topup_issue(uuid, jsonb, text), public.ward_topup_receive(uuid) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['cd_register', 'ward_stock', 'ward_topup_requests'] loop
    if to_regprocedure('public.audit_row_change()') is not null then
      execute format('drop trigger if exists trg_audit_change on public.%I', t);
      execute format('create trigger trg_audit_change after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
    end if;
  end loop;
end $$;
