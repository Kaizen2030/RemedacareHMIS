-- Lock down the public (anon) key: fixes from docs/sql/12_security_check.sql (14 Nov 2026).
--
-- 1. The anon role (no login) had INSERT/UPDATE/DELETE/TRUNCATE on almost every table. Row-level security
--    still applied to the API, but TRUNCATE ignores RLS and one wrong "to public" policy would open a table to
--    the internet. The app never reads or writes tables before login (sign-in goes through Supabase Auth; the
--    appointment-confirm link runs server-side with the service key), so anon loses every table, view and
--    sequence privilege. TRUNCATE is also taken from logged-in users: the app never truncates.
-- 2. Security-definer functions were callable by anon. Logged-in users keep exactly the access they had;
--    anon and PUBLIC lose it. get_user_id_by_email is unused by the app and let anyone look up account ids by
--    e-mail, so only the server (service_role) keeps it.
-- 3. ppb_dispensing_flags had allow-all ("true") policies: now limited to the user's own hospital.
-- 4. purchase_order_items has no hospital_id: access now follows its purchase order's hospital.
-- 5. Future tables and functions created by postgres start closed to anon.

do $$
declare
  r record;
  skipped text[] := '{}';
begin
  -- 1. Tables, views, sequences
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

  -- 2. Security-definer functions: keep logged-in access exactly as it was, close anon/PUBLIC
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

-- 3. PPB dispensing flags: own hospital only (no deletes: it is a regulatory log)
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

-- 4. Purchase-order lines follow their order's hospital
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

-- 5. New objects start closed to anon (logged-in and server access keep Supabase's defaults)
do $$ begin
  alter default privileges for role postgres in schema public revoke all on tables from anon;
  alter default privileges for role postgres in schema public revoke all on sequences from anon;
  alter default privileges for role postgres in schema public grant execute on functions to authenticated, service_role;
  alter default privileges for role postgres in schema public revoke execute on functions from public, anon;
exception when others then raise notice 'Default privileges not changed: %', sqlerrm;
end $$;

-- 6. Views must apply the reader's row-level security (otherwise they show every hospital's rows)
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
