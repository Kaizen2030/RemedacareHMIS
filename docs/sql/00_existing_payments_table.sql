-- STEP A (read-only): what is the old public.payments table? Run this alone and look at the rows.
-- If "rows" is 0 and there is nothing under view / foreign key / function, it is safe to do STEP B.
select kind, detail from (
  select 1 as o, 'column' as kind, column_name || '  ' || data_type as detail
    from information_schema.columns where table_schema = 'public' and table_name = 'payments'
  union all
  select 2, 'rows', substring(query_to_xml('select count(*) as c from public.payments', false, true, '')::text from '<c>(.*)</c>')
  union all
  select 3, 'foreign key from', conrelid::regclass::text || ' (' || conname || ')'
    from pg_constraint where confrelid = to_regclass('public.payments')
  union all
  select 4, 'view using it', v.oid::regclass::text
    from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class v on v.oid = r.ev_class
   where d.refobjid = to_regclass('public.payments') and v.oid <> to_regclass('public.payments')
  union all
  select 5, 'function mentioning payments', p.proname
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~* '\mpayments\M'
  union all
  select 6, 'trigger', tgname from pg_trigger where tgrelid = to_regclass('public.payments') and not tgisinternal
  union all
  select 7, 'policy', policyname from pg_policies where schemaname = 'public' and tablename = 'payments'
) x order by o, detail;

-- STEP B is no longer needed: 02_install_payments.sql now moves an EMPTY old payments table aside itself.
-- (kept for reference only)
-- alter table public.payments rename to payments_old_20261114;
