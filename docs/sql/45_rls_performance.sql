-- =============================================================================
-- RemedacareHMS - SPEED: ACCESS CHECKS ONCE PER QUERY INSTEAD OF PER ROW, AND HOSPITAL INDEXES. RUN THIS LAST, AND AGAIN AFTER RE-RUNNING ANY OTHER FILE
-- Generated from supabase/migrations/20261227000000_rls_performance.sql - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.pay_is_member(uuid)') is null then
    raise exception 'Run 02_install_payments.sql first. Nothing was changed.';
  end if;
end $$;

/** Hospitals the signed-in user can belong to (hospital_users rows or ownership by email). */
create or replace function public.rls_my_hospitals()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct h), '{}'::uuid[]) from (
    select hu.hospital_id h from public.hospital_users hu where hu.user_id = auth.uid()
    union
    select x.id from public.hospitals x join auth.users u on lower(u.email) = lower(x.owner_email) where u.id = auth.uid()
  ) s where h is not null
$$;

/** Hospitals where a membership-based permission check passes for the signed-in user. */
create or replace function public.rls_hospitals(p_check text)
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare v uuid[];
begin
  if p_check not in ('pay_is_member', 'clin_can_access', 'priv_is_admin', 'blood_is_staff', 'hr_can_manage', 'hr_can_roster', 'guide_can_approve',
                     'pharm_is_staff', 'rec_can_access', 'can_manage_payments', 'can_take_payments', 'mortuary_can_access', 'is_payments_admin',
                     'lab_instrument_can_manage', 'service_is_records_staff') then
    raise exception 'rls_hospitals: % is not a membership-based check', p_check;
  end if;
  if to_regprocedure('public.' || p_check || '(uuid)') is null then return '{}'::uuid[]; end if;
  execute format('select coalesce(array_agg(h), ''{}''::uuid[]) from unnest($1) h where public.%I(h)', p_check) into v using public.rls_my_hospitals();
  return v;
end $$;

revoke execute on function public.rls_my_hospitals(), public.rls_hospitals(text) from public, anon;
grant execute on function public.rls_my_hospitals(), public.rls_hospitals(text) to authenticated, service_role;

do $$
declare
  p record; q text; c text; fn text; n int := 0; roles text; stmt text;
  checks text[] := array['pay_is_member', 'clin_can_access', 'priv_is_admin', 'blood_is_staff', 'hr_can_manage', 'hr_can_roster', 'guide_can_approve',
                         'pharm_is_staff', 'rec_can_access', 'can_manage_payments', 'can_take_payments', 'mortuary_can_access', 'is_payments_admin',
                         'lab_instrument_can_manage', 'service_is_records_staff'];
begin
  for p in select * from pg_policies where schemaname = 'public' loop
    q := p.qual; c := p.with_check;
    foreach fn in array checks loop
      q := regexp_replace(q, '(public\.)?\m' || fn || '\(hospital_id\)', '(hospital_id = ANY ((SELECT public.rls_hospitals(''' || fn || '''))::uuid[]))', 'g');
      c := regexp_replace(c, '(public\.)?\m' || fn || '\(hospital_id\)', '(hospital_id = ANY ((SELECT public.rls_hospitals(''' || fn || '''))::uuid[]))', 'g');
    end loop;
    if q is not distinct from p.qual and c is not distinct from p.with_check then continue; end if;
    select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ') into roles from unnest(p.roles) r;
    stmt := format('create policy %I on public.%I as %s for %s to %s', p.policyname, p.tablename, p.permissive, p.cmd, roles)
         || case when q is not null then ' using (' || q || ')' else '' end
         || case when c is not null then ' with check (' || c || ')' else '' end;
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
    execute stmt;
    n := n + 1;
  end loop;
  raise notice 'rls_performance: % policies optimised', n;
end $$;

do $$
declare t record; n int := 0;
begin
  for t in
    select c.relname, a.attnum from pg_class c
      join pg_namespace s on s.oid = c.relnamespace and s.nspname = 'public'
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'hospital_id' and not a.attisdropped
     where c.relkind = 'r'
       and not exists (select 1 from pg_index i where i.indrelid = c.oid and i.indkey[0] = a.attnum)
  loop
    execute format('create index if not exists %I on public.%I(hospital_id)', left(t.relname, 45) || '_hospital_idx', t.relname);
    n := n + 1;
  end loop;
  raise notice 'rls_performance: % hospital_id indexes added', n;
end $$;

commit;

select 'access checks optimised' as check_name, case when (select count(*) from pg_policies where schemaname = 'public' and (coalesce(qual, '') || coalesce(with_check, '')) ~ '\m(pay_is_member|clin_can_access|priv_is_admin|blood_is_staff|hr_can_manage|hr_can_roster|guide_can_approve|pharm_is_staff|rec_can_access|can_manage_payments|can_take_payments|mortuary_can_access|is_payments_admin|lab_instrument_can_manage|service_is_records_staff)\(hospital_id\)') = 0 then 'OK' else 'PROBLEM: run this file again' end as result
    union all select 'policies using the fast form', (select count(*) || ' policies' from pg_policies where schemaname = 'public' and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'rls_hospitals')
    union all select 'hospital indexes', case when not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace and s.nspname = 'public' join pg_attribute a on a.attrelid = c.oid and a.attname = 'hospital_id' and not a.attisdropped where c.relkind = 'r' and not exists (select 1 from pg_index i where i.indrelid = c.oid and i.indkey[0] = a.attnum)) then 'OK' else 'PROBLEM' end;
