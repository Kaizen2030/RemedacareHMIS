-- Enterprise pharmacy stock controls adapted for the HMIS hospital model.
-- Existing pharmacy_inventory, drug_batches, dispensing, expiry, and reporting flows remain compatible.

alter table public.pharmacy_inventory
  add column if not exists item_code text,
  add column if not exists barcode text,
  add column if not exists stock_wholes integer not null default 0,
  add column if not exists stock_pieces numeric(14,3) not null default 0,
  add column if not exists pack_size integer not null default 1,
  add column if not exists price_kes numeric(14,2),
  add column if not exists piece_price_kes numeric(14,2),
  add column if not exists cost_price_kes numeric(14,2),
  add column if not exists image_url text,
  add column if not exists image_source text,
  add column if not exists minimum_stock_level numeric(14,3),
  add column if not exists maximum_stock_level numeric(14,3),
  add column if not exists reorder_lead_days integer not null default 7 check (reorder_lead_days >= 0),
  add column if not exists average_daily_usage numeric(14,3) not null default 0 check (average_daily_usage >= 0),
  add column if not exists safety_stock numeric(14,3) not null default 0 check (safety_stock >= 0),
  add column if not exists controlled_drug boolean not null default false,
  add column if not exists requires_cold_chain boolean not null default false,
  add column if not exists active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

update public.pharmacy_inventory
set pack_size = greatest(coalesce(pack_size, 1), 1),
    stock_wholes = floor(greatest(coalesce(quantity_in_stock, 0), 0) / greatest(coalesce(pack_size, 1), 1)),
    stock_pieces = mod(greatest(coalesce(quantity_in_stock, 0), 0), greatest(coalesce(pack_size, 1), 1)),
    piece_price_kes = coalesce(piece_price_kes, selling_price),
    price_kes = coalesce(price_kes, selling_price * greatest(coalesce(pack_size, 1), 1)),
    cost_price_kes = coalesce(cost_price_kes, unit_cost * greatest(coalesce(pack_size, 1), 1));

update public.pharmacy_inventory
set minimum_stock_level = coalesce(minimum_stock_level, reorder_level, 0),
    maximum_stock_level = coalesce(maximum_stock_level, greatest(coalesce(reorder_level, 0) * 3, quantity_in_stock, 0)),
    updated_at = now()
where minimum_stock_level is null or maximum_stock_level is null;

create unique index if not exists pharmacy_inventory_hospital_item_code_key
  on public.pharmacy_inventory (hospital_id, item_code)
  where item_code is not null;
create unique index if not exists pharmacy_inventory_hospital_barcode_key
  on public.pharmacy_inventory (hospital_id, barcode)
  where barcode is not null;
create index if not exists pharmacy_inventory_replenishment_idx
  on public.pharmacy_inventory (hospital_id, active, quantity_in_stock, reorder_level);

insert into storage.buckets (id, name, public)
values ('drug-images', 'drug-images', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "hmis drug images public read" on storage.objects;
create policy "hmis drug images public read"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'drug-images');

drop policy if exists "hmis drug images authenticated upload" on storage.objects;
create policy "hmis drug images authenticated upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'drug-images');

drop policy if exists "hmis drug images authenticated update" on storage.objects;
create policy "hmis drug images authenticated update"
  on storage.objects for update to authenticated
  using (bucket_id = 'drug-images')
  with check (bucket_id = 'drug-images');

create table if not exists public.drug_image_library (
  id uuid primary key default gen_random_uuid(),
  generic_name text not null,
  brand_hint text,
  drug_class text,
  image_url text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists drug_image_library_generic_name_idx
  on public.drug_image_library (lower(generic_name));

alter table public.drug_image_library enable row level security;

drop policy if exists "hmis drug image library public read" on public.drug_image_library;
create policy "hmis drug image library public read"
  on public.drug_image_library for select to anon, authenticated
  using (true);

drop policy if exists "hmis drug image library staff insert" on public.drug_image_library;
create policy "hmis drug image library staff insert"
  on public.drug_image_library for insert to authenticated
  with check (true);

drop policy if exists "hmis drug image library staff update" on public.drug_image_library;
create policy "hmis drug image library staff update"
  on public.drug_image_library for update to authenticated
  using (true)
  with check (true);

alter table public.drug_batches
  add column if not exists inventory_id uuid references public.pharmacy_inventory(id) on delete set null,
  add column if not exists storage_location text,
  add column if not exists supplier_invoice text,
  add column if not exists received_at timestamptz not null default now(),
  add column if not exists quarantined_at timestamptz,
  add column if not exists quarantine_reason text,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists drug_batches_hospital_fefo_idx
  on public.drug_batches (hospital_id, inventory_id, status, expiry_date, received_at)
  where quantity_remaining > 0;

create table if not exists public.pharmacy_storage_locations (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  code text not null,
  name text not null,
  location_type text not null default 'Store'
    check (location_type in ('Store', 'Dispensary', 'Ward stock', 'Controlled cabinet', 'Cold chain', 'Quarantine', 'Returns')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (hospital_id, code)
);

insert into public.pharmacy_storage_locations (hospital_id, code, name, location_type)
select distinct hospital_id, 'MAIN-STORE', 'Main Pharmacy Store', 'Store'
from public.pharmacy_inventory
where hospital_id is not null
on conflict (hospital_id, code) do nothing;

create table if not exists public.pharmacy_stock_movements (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  inventory_id uuid not null references public.pharmacy_inventory(id) on delete restrict,
  batch_id uuid references public.drug_batches(id) on delete set null,
  movement_type text not null check (movement_type in ('Receipt', 'Dispense', 'Adjustment', 'Transfer out', 'Transfer in', 'Write-off', 'Return', 'Stock take')),
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  quantity_before numeric(14,3),
  quantity_after numeric(14,3),
  source_location_id uuid references public.pharmacy_storage_locations(id) on delete set null,
  destination_location_id uuid references public.pharmacy_storage_locations(id) on delete set null,
  reference_type text,
  reference_id text,
  reason text,
  performed_by text,
  created_at timestamptz not null default now()
);

create index if not exists pharmacy_stock_movements_inventory_idx
  on public.pharmacy_stock_movements (hospital_id, inventory_id, created_at desc);

create table if not exists public.pharmacy_stock_counts (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  inventory_id uuid not null references public.pharmacy_inventory(id) on delete restrict,
  batch_id uuid references public.drug_batches(id) on delete set null,
  counted_quantity numeric(14,3) not null check (counted_quantity >= 0),
  system_quantity numeric(14,3) not null check (system_quantity >= 0),
  variance_quantity numeric(14,3) generated always as (counted_quantity - system_quantity) stored,
  status text not null default 'Draft' check (status in ('Draft', 'Submitted', 'Approved', 'Rejected')),
  counted_by text,
  approved_by text,
  notes text,
  counted_at timestamptz not null default now(),
  approved_at timestamptz
);

create index if not exists pharmacy_stock_counts_open_idx
  on public.pharmacy_stock_counts (hospital_id, status, counted_at desc);

create or replace function public.record_pharmacy_inventory_movement()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.quantity_in_stock, 0) <> 0 then
      insert into public.pharmacy_stock_movements (
        hospital_id, inventory_id, movement_type, quantity_delta, quantity_before, quantity_after,
        reference_type, reason, performed_by
      ) values (
        new.hospital_id, new.id, 'Receipt', new.quantity_in_stock, 0, new.quantity_in_stock,
        'pharmacy_inventory', 'Opening stock or new catalogue item', auth.uid()::text
      );
    end if;
    return new;
  end if;

  if new.quantity_in_stock is distinct from old.quantity_in_stock then
    insert into public.pharmacy_stock_movements (
      hospital_id, inventory_id, movement_type, quantity_delta, quantity_before, quantity_after,
      reference_type, reason, performed_by
    ) values (
      new.hospital_id,
      new.id,
      case when new.quantity_in_stock < old.quantity_in_stock then 'Dispense' else 'Receipt' end,
      new.quantity_in_stock - old.quantity_in_stock,
      old.quantity_in_stock,
      new.quantity_in_stock,
      'pharmacy_inventory',
      'Inventory quantity changed',
      auth.uid()::text
    );
  end if;
  if (new.quantity_in_stock is distinct from old.quantity_in_stock or new.pack_size is distinct from old.pack_size)
     and new.stock_wholes is not distinct from old.stock_wholes
     and new.stock_pieces is not distinct from old.stock_pieces then
    new.stock_wholes := floor(greatest(coalesce(new.quantity_in_stock, 0), 0) / greatest(coalesce(new.pack_size, 1), 1));
    new.stock_pieces := mod(greatest(coalesce(new.quantity_in_stock, 0), 0), greatest(coalesce(new.pack_size, 1), 1));
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pharmacy_inventory_stock_movement on public.pharmacy_inventory;
create trigger pharmacy_inventory_stock_movement
before insert or update on public.pharmacy_inventory
for each row execute function public.record_pharmacy_inventory_movement();

alter table public.pharmacy_storage_locations enable row level security;
alter table public.pharmacy_stock_movements enable row level security;
alter table public.pharmacy_stock_counts enable row level security;

create policy "Hospital members can manage pharmacy locations"
  on public.pharmacy_storage_locations for all to authenticated
  using (exists (select 1 from public.hospital_users hu where hu.hospital_id = pharmacy_storage_locations.hospital_id and hu.user_id = auth.uid() and hu.active is distinct from false))
  with check (exists (select 1 from public.hospital_users hu where hu.hospital_id = pharmacy_storage_locations.hospital_id and hu.user_id = auth.uid() and hu.active is distinct from false));

create policy "Hospital members can read pharmacy stock movements"
  on public.pharmacy_stock_movements for select to authenticated
  using (exists (select 1 from public.hospital_users hu where hu.hospital_id = pharmacy_stock_movements.hospital_id and hu.user_id = auth.uid() and hu.active is distinct from false));

create policy "Hospital pharmacy staff can create stock counts"
  on public.pharmacy_stock_counts for all to authenticated
  using (exists (select 1 from public.hospital_users hu where hu.hospital_id = pharmacy_stock_counts.hospital_id and hu.user_id = auth.uid() and hu.active is distinct from false))
  with check (exists (select 1 from public.hospital_users hu where hu.hospital_id = pharmacy_stock_counts.hospital_id and hu.user_id = auth.uid() and hu.active is distinct from false));
