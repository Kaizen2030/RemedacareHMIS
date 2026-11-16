-- Theatre: surgeon preference cards (per surgeon + procedure: gloves, position, prep, instruments, sutures, equipment
-- and a pick list linked to stock), and theatre items linked to stock — a stock-linked item leaves the pharmacy / store
-- first-expiry-first-out in the same transaction (pharmacy_fefo_issue, 26_pharmacy_controls.sql) and is priced from the
-- stock item. Items are billed once, through a bill the cashier collects (cashier-only payments).

do $$ begin
  if to_regclass('public.theatre_items') is null then raise exception 'Run 21_theatre.sql first. Nothing was changed.'; end if;
end $$;

create table if not exists public.theatre_preference_cards (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  surgeon     text not null,
  procedure   text not null,
  glove_size  text,
  position    text,
  skin_prep   text,
  drapes      text,
  instruments text,
  sutures     text,
  equipment   text,
  medications text,
  items       jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),   -- [{kind, name, inventory_id, quantity}]
  notes       text,
  active      boolean not null default true,
  updated_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create unique index if not exists theatre_preference_cards_key on public.theatre_preference_cards(hospital_id, lower(surgeon), lower(procedure));

create or replace function public.theatre_preference_cards_before()
returns trigger language plpgsql as $$
begin
  if coalesce(trim(new.surgeon), '') = '' or coalesce(trim(new.procedure), '') = '' then raise exception 'Name the surgeon and the procedure'; end if;
  new.surgeon := trim(new.surgeon); new.procedure := trim(new.procedure);
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists trg_theatre_preference_cards_before on public.theatre_preference_cards;
create trigger trg_theatre_preference_cards_before before insert or update on public.theatre_preference_cards for each row execute function public.theatre_preference_cards_before();

alter table public.theatre_items add column if not exists inventory_id uuid;
alter table public.theatre_items add column if not exists unit_price numeric;
alter table public.theatre_items add column if not exists stock_issue jsonb;          -- batches taken (FEFO)
alter table public.theatre_items add column if not exists invoice_id uuid;
alter table public.theatre_items add column if not exists billed_at timestamptz;

create or replace function public.theatre_items_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare inv jsonb; c record;
begin
  if tg_op = 'UPDATE' then
    -- implant / consumable records are permanent; only the billing link can be set, once
    if (to_jsonb(new) - array['invoice_id', 'billed_at']) is distinct from (to_jsonb(old) - array['invoice_id', 'billed_at']) then
      raise exception 'Theatre item records cannot be changed';
    end if;
    if old.invoice_id is not null then raise exception 'This item has already been billed'; end if;
    if new.invoice_id is not null then new.billed_at := now(); end if;
    return new;
  end if;
  select id, hospital_id, status into c from public.theatre_cases where id = new.case_id;
  if c.id is null then raise exception 'Theatre case not found'; end if;
  new.hospital_id := c.hospital_id; new.invoice_id := null; new.billed_at := null; new.stock_issue := null;
  if new.inventory_id is not null then
    select to_jsonb(i) into inv from public.pharmacy_inventory i where i.id = new.inventory_id and i.hospital_id = c.hospital_id;
    if inv is null then raise exception 'Stock item not found'; end if;
    new.unit_price := coalesce(new.unit_price, nullif(inv->>'selling_price', '')::numeric, nullif(inv->>'piece_price_kes', '')::numeric);
    if to_regprocedure('public.pharmacy_fefo_issue(uuid,numeric,text)') is not null then
      perform set_config('app.ward_topup', 'on', true);    -- lets pharmacy_fefo_issue run for theatre staff (issue from stock to a case)
      new.stock_issue := public.pharmacy_fefo_issue(new.inventory_id, new.quantity, 'Theatre case ' || c.id);
      perform set_config('app.ward_topup', 'off', true);
    else
      update public.pharmacy_inventory set quantity_in_stock = quantity_in_stock - new.quantity where id = new.inventory_id and quantity_in_stock >= new.quantity;
      if not found then raise exception '% : not enough in stock', inv->>'drug_name'; end if;
      new.stock_issue := jsonb_build_object('quantity', new.quantity, 'tracked', false);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_theatre_items_before on public.theatre_items;
create trigger trg_theatre_items_before before insert or update on public.theatre_items for each row execute function public.theatre_items_before();

alter table public.theatre_preference_cards enable row level security;
drop policy if exists theatre_preference_cards_clinical on public.theatre_preference_cards;
create policy theatre_preference_cards_clinical on public.theatre_preference_cards for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
revoke all on public.theatre_preference_cards from anon;
grant select, insert, update on public.theatre_preference_cards to authenticated;
grant all on public.theatre_preference_cards to service_role;
grant update (invoice_id, billed_at) on public.theatre_items to authenticated;
revoke execute on function public.theatre_preference_cards_before(), public.theatre_items_before() from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.audit_row_change()') is not null then
    execute 'drop trigger if exists trg_audit_change on public.theatre_preference_cards';
    execute 'create trigger trg_audit_change after insert or update or delete on public.theatre_preference_cards for each row execute function public.audit_row_change()';
  end if;
end $$;
