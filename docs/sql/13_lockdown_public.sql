-- =============================================================================
-- RemedacareHMS - LOCK DOWN THE PUBLIC KEY (fixes from 12_security_check)
-- Generated from supabase/migrations/20261123000000_lockdown_public.sql - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.ref_try_uuid(text)') is null then
    raise exception 'Run 07_clinical_reference.sql first. Nothing was changed.';
  end if;
end $$;

do $$
declare
  r record;
  skipped text[] := '{}';
begin
  for r in
    select c.oid::regclass as obj, c.relkind
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
       and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  loop
    begin
      if r.relkind = 'S' then
        execute format('revoke all on sequence %s from anon', r.obj);
      else
        execute format('revoke all on table %s from anon', r.obj);
        execute format('revoke truncate on table %s from authenticated', r.obj);
      end if;
    exception when others then skipped := skipped || (r.obj::text || ': ' || sqlerrm);
    end;
  end loop;

  for r in
    select f.oid::regprocedure as fn, f.proname,
           has_function_privilege('authenticated', f.oid, 'execute') as auth_ok
      from pg_proc f join pg_namespace n on n.oid = f.pronamespace
     where n.nspname = 'public' and f.prosecdef
       and not exists (select 1 from pg_depend d where d.objid = f.oid and d.deptype = 'e')
  loop
    begin
      if r.proname = 'get_user_id_by_email' then
        execute format('revoke execute on function %s from public, anon, authenticated', r.fn);
      else
        if r.auth_ok then execute format('grant execute on function %s to authenticated', r.fn); end if;
        execute format('revoke execute on function %s from public, anon', r.fn);
      end if;
      execute format('grant execute on function %s to service_role', r.fn);
    exception when others then skipped := skipped || (r.fn::text || ': ' || sqlerrm);
    end;
  end loop;

  if array_length(skipped, 1) > 0 then
    raise notice 'Could not change (owned by another role): %', array_to_string(skipped, '; ');
  end if;
end $$;

do $$
declare p record;
begin
  if to_regclass('public.ppb_dispensing_flags') is null then return; end if;
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'ppb_dispensing_flags' loop
    execute format('drop policy if exists %I on public.ppb_dispensing_flags', p.policyname);
  end loop;
  alter table public.ppb_dispensing_flags enable row level security;
  create policy ppb_flags_member_read on public.ppb_dispensing_flags for select to authenticated
    using (public.pay_is_member(public.ref_try_uuid(hospital_id::text)));
  create policy ppb_flags_member_insert on public.ppb_dispensing_flags for insert to authenticated
    with check (public.pay_is_member(public.ref_try_uuid(hospital_id::text)));
  create policy ppb_flags_member_update on public.ppb_dispensing_flags for update to authenticated
    using (public.pay_is_member(public.ref_try_uuid(hospital_id::text)))
    with check (public.pay_is_member(public.ref_try_uuid(hospital_id::text)));
  revoke delete on public.ppb_dispensing_flags from authenticated;
end $$;

do $$
declare p record;
begin
  if to_regclass('public.purchase_order_items') is null or to_regclass('public.purchase_orders') is null then return; end if;
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'purchase_order_items' loop
    execute format('drop policy if exists %I on public.purchase_order_items', p.policyname);
  end loop;
  alter table public.purchase_order_items enable row level security;
  create policy po_items_by_order on public.purchase_order_items for all to authenticated
    using (exists (select 1 from public.purchase_orders po where po.id = purchase_order_id
                     and public.pay_is_member(public.ref_try_uuid(po.hospital_id::text))))
    with check (exists (select 1 from public.purchase_orders po where po.id = purchase_order_id
                     and public.pay_is_member(public.ref_try_uuid(po.hospital_id::text))));
end $$;

do $$ begin
  alter default privileges for role postgres in schema public revoke all on tables from anon;
  alter default privileges for role postgres in schema public revoke all on sequences from anon;
  alter default privileges for role postgres in schema public grant execute on functions to authenticated, service_role;
  alter default privileges for role postgres in schema public revoke execute on functions from public, anon;
exception when others then raise notice 'Default privileges not changed: %', sqlerrm;
end $$;

do $$
declare v record;
begin
  for v in select c.oid::regclass as obj from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'v' and not coalesce('security_invoker=true' = any(c.reloptions), false)
              and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e') loop
    begin
      execute format('alter view %s set (security_invoker = true)', v.obj);
    exception when others then raise notice 'View % not changed: %', v.obj, sqlerrm;
    end;
  end loop;
end $$;

commit;

select 'public (anon) table access' as check_name, case when count(*) = 0 then 'OK' else count(*) || ' grants left - send me this' end as result
      from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'
    union all select 'definer functions open to anon', case when count(*) = 0 then 'OK' else count(*) || ' left - send me this' end
      from pg_proc f join pg_namespace n on n.oid = f.pronamespace where n.nspname = 'public' and f.prosecdef and has_function_privilege('anon', f.oid, 'execute')
    union all select 'logged-in TRUNCATE', case when count(*) = 0 then 'OK' else count(*) || ' left' end
      from information_schema.role_table_grants where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'TRUNCATE'
    union all select 'PPB flags per hospital', case when exists (select 1 from pg_policies where tablename = 'ppb_dispensing_flags' and qual = 'true') then 'PROBLEM' else 'OK' end;
