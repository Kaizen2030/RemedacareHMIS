-- =============================================================================
-- RemedacareHMS - CONFIGURATION: PAYER PRICE LISTS, ROLE MATRIX, DEPARTMENT FORMS, CHANGE LOG
-- Generated from supabase/migrations/20261124000000_configuration.sql - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.audit_row_change()') is null then
    raise exception 'Run 11_audit_privacy.sql first. Nothing was changed.';
  end if;
end $$;

create table if not exists public.price_lists (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  name text not null,
  payer_type text not null check (payer_type in ('cash', 'sha', 'insurance', 'corporate', 'staff', 'other')),
  insurer_name text,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hospital_id, name)
);
create table if not exists public.charge_code_prices (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  price_list_id uuid not null references public.price_lists(id) on delete cascade,
  charge_code text not null,
  price_kes numeric(12, 2) not null check (price_kes >= 0),
  updated_at timestamptz not null default now(),
  unique (price_list_id, charge_code)
);
create index if not exists charge_code_prices_lookup on public.charge_code_prices (hospital_id, upper(charge_code));

create or replace function public.config_payer_type(p_method text, p_insurer text default null)
returns text language sql immutable as $$
  select case
    when coalesce(p_method, '') ~* '(sha|nhif|social health)' then 'sha'
    when coalesce(p_method, '') ~* 'insur' and coalesce(p_insurer, '') ~* '^(sha|nhif)' then 'sha'
    when coalesce(p_method, '') ~* 'insur' then 'insurance'
    when coalesce(p_method, '') ~* '(corporate|company|employer)' then 'corporate'
    when coalesce(p_method, '') ~* 'staff' then 'staff'
    else 'cash' end
$$;

create or replace function public.config_price(p_hospital uuid, p_code text, p_payment_method text default null, p_insurer text default null)
returns table (price_kes numeric, price_list text) language sql stable set search_path = public as $$
  select p.price_kes, l.name
    from public.charge_code_prices p join public.price_lists l on l.id = p.price_list_id
   where p.hospital_id = p_hospital and l.active and upper(p.charge_code) = upper(p_code)
     and l.payer_type = public.config_payer_type(p_payment_method, p_insurer)
     and (l.payer_type <> 'insurance' or l.insurer_name is null or lower(l.insurer_name) = lower(coalesce(p_insurer, '')))
   order by (l.insurer_name is not null) desc, l.created_at
   limit 1
$$;

create table if not exists public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  role text not null check (role <> 'Admin'),
  screens text[] not null default '{}',
  actions text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (hospital_id, role)
);

create table if not exists public.workflow_form_overrides (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  module_code text not null,
  fields jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (hospital_id, module_code)
);

create or replace function public.config_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['price_lists', 'charge_code_prices', 'role_permissions', 'workflow_form_overrides'] loop
    execute format('drop trigger if exists trg_config_touch on public.%I', t);
    execute format('create trigger trg_config_touch before update on public.%I for each row execute function public.config_touch()', t);
  end loop;
end $$;

alter table public.price_lists enable row level security;
alter table public.charge_code_prices enable row level security;
alter table public.role_permissions enable row level security;
alter table public.workflow_form_overrides enable row level security;

drop policy if exists price_lists_read on public.price_lists;
drop policy if exists price_lists_write on public.price_lists;
create policy price_lists_read on public.price_lists for select to authenticated using (public.pay_is_member(hospital_id));
create policy price_lists_write on public.price_lists for all to authenticated
  using (public.priv_is_admin(hospital_id) or public.can_manage_payments(hospital_id))
  with check (public.priv_is_admin(hospital_id) or public.can_manage_payments(hospital_id));

drop policy if exists charge_code_prices_read on public.charge_code_prices;
drop policy if exists charge_code_prices_write on public.charge_code_prices;
create policy charge_code_prices_read on public.charge_code_prices for select to authenticated using (public.pay_is_member(hospital_id));
create policy charge_code_prices_write on public.charge_code_prices for all to authenticated
  using (public.priv_is_admin(hospital_id) or public.can_manage_payments(hospital_id))
  with check ((public.priv_is_admin(hospital_id) or public.can_manage_payments(hospital_id))
              and exists (select 1 from public.price_lists l where l.id = price_list_id and l.hospital_id = charge_code_prices.hospital_id));

drop policy if exists role_permissions_read on public.role_permissions;
drop policy if exists role_permissions_write on public.role_permissions;
create policy role_permissions_read on public.role_permissions for select to authenticated using (public.pay_is_member(hospital_id));
create policy role_permissions_write on public.role_permissions for all to authenticated
  using (public.priv_is_admin(hospital_id)) with check (public.priv_is_admin(hospital_id));

drop policy if exists workflow_form_overrides_read on public.workflow_form_overrides;
drop policy if exists workflow_form_overrides_write on public.workflow_form_overrides;
create policy workflow_form_overrides_read on public.workflow_form_overrides for select to authenticated using (public.pay_is_member(hospital_id));
create policy workflow_form_overrides_write on public.workflow_form_overrides for all to authenticated
  using (public.priv_is_admin(hospital_id)) with check (public.priv_is_admin(hospital_id));

revoke all on public.price_lists, public.charge_code_prices, public.role_permissions, public.workflow_form_overrides from anon;
grant select, insert, update, delete on public.price_lists, public.charge_code_prices, public.role_permissions, public.workflow_form_overrides to authenticated;
grant all on public.price_lists, public.charge_code_prices, public.role_permissions, public.workflow_form_overrides to service_role;
revoke execute on function public.config_price(uuid, text, text, text), public.config_payer_type(text, text) from public, anon;
grant execute on function public.config_price(uuid, text, text, text), public.config_payer_type(text, text) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['charge_codes', 'price_lists', 'charge_code_prices', 'role_permissions', 'workflow_form_overrides'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_audit_change on public.%I', t);
      execute format('create trigger trg_audit_change after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
    end if;
  end loop;
end $$;

commit;

select 'tables' as check_name, case when (select count(*) from pg_class where oid in (to_regclass('public.price_lists'), to_regclass('public.charge_code_prices'),
      to_regclass('public.role_permissions'), to_regclass('public.workflow_form_overrides'))) = 4 then 'OK' else 'PROBLEM' end as result
    union all select 'changes go to the audit log', case when (select count(*) from pg_trigger where tgname = 'trg_audit_change' and tgrelid in (to_regclass('public.price_lists'),
      to_regclass('public.charge_code_prices'), to_regclass('public.role_permissions'), to_regclass('public.workflow_form_overrides'))) = 4 then 'OK' else 'PROBLEM' end
    union all select 'SHA payer detected', case when public.config_payer_type('SHA (Social Health Authority)') = 'sha' and public.config_payer_type('Insurance', 'AAR') = 'insurance' then 'OK' else 'PROBLEM' end;
