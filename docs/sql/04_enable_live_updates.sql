-- RemedacareHMS - turn on live updates between screens (Supabase Realtime)
-- Safe to run more than once. Paste into SQL Editor, Run, choose "Run without RLS" if asked.
-- The result lists each table and whether it now sends live updates (should all say live).
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['invoices','payments','lab_tests','lab_referrals','prescriptions','visits','admissions','beds',
                           'pharmacy_inventory','workflow_events','notifications','sha_claims','insurance_claims',
                           'mpesa_transactions','microbiology_results','credit_debts','appointments'] loop
    if to_regclass('public.' || t) is not null and not exists (
         select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

select c.relname as table_name,
       case when pt.tablename is not null then 'live' else 'NOT LIVE' end as status
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
left join pg_publication_tables pt on pt.pubname = 'supabase_realtime' and pt.schemaname = 'public' and pt.tablename = c.relname
where c.relname in ('invoices','payments','lab_tests','lab_referrals','prescriptions','visits','admissions','beds',
                    'pharmacy_inventory','workflow_events','notifications','sha_claims','insurance_claims',
                    'mpesa_transactions','microbiology_results','credit_debts','appointments')
  and c.relkind = 'r'
order by 2, 1;
