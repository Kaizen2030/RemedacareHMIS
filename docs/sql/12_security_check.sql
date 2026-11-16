-- RemedacareHMS — SECURITY CHECK (read-only: changes nothing). Run in SQL Editor, choose "Run without RLS".
-- Lists every weak spot in the live database, most severe first. Send the result back for fixes.
with
tbl as (
  select c.oid, c.relname as name, c.relrowsecurity as rls,
         exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'hospital_id') as tenant
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
),
reference_tables as (select unnest(array['icd10_codes', 'loinc_codes', 'ncd_condition_config']) as name),
findings as (
  select 1 as rank, 'CRITICAL' as severity, 'RLS switched off' as area, t.name as object,
         'Any logged-in user (and possibly the public key) can read and change every row. Enable RLS and add hospital policies.' as detail
    from tbl t where not t.rls and t.name not in (select name from reference_tables)
  union all
  select 2, 'HIGH', 'Allow-all policy', p.tablename || ' / ' || p.policyname,
         'Policy for ' || p.cmd || ' is "true" for ' || array_to_string(p.roles, ',') || ' — not limited to the user''s hospital.'
    from pg_policies p join tbl t on t.name = p.tablename
   where p.schemaname = 'public' and t.tenant
     and (coalesce(p.qual, 'true') = 'true' and p.cmd <> 'INSERT' or coalesce(p.with_check, p.qual, 'true') = 'true' and p.cmd in ('INSERT', 'UPDATE', 'ALL'))
  union all
  select 2, 'HIGH', 'Public (anon) has access', pr.table_name::text,
         'The anon role (no login) has ' || string_agg(distinct pr.privilege_type, ', ') || ' on this table or view.'
    from information_schema.role_table_grants pr
   where pr.table_schema = 'public' and pr.grantee = 'anon' and pr.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
   group by pr.table_name::text
  union all
  select 2, 'HIGH', 'View skips row-level security', c.relname,
         'This view runs with its owner''s rights, so logged-in users see every hospital''s rows. Recreate it with security_invoker = true.'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v' and not coalesce('security_invoker=true' = any(c.reloptions), false)
     and has_table_privilege('authenticated', c.oid, 'select')
  union all
  select 3, 'MEDIUM', 'Logged-in users can TRUNCATE', string_agg(pr.table_name::text, ', ' order by pr.table_name::text),
         'TRUNCATE ignores row-level security. Revoke it (13_lockdown_public.sql does).'
    from information_schema.role_table_grants pr
   where pr.table_schema = 'public' and pr.grantee = 'authenticated' and pr.privilege_type = 'TRUNCATE'
  having count(*) > 0
  union all
  select 3, 'HIGH', 'Definer function open to the public', f.oid::regprocedure::text,
         'Runs with owner rights and anyone (anon) can call it. Revoke execute from anon unless it is meant to be public.'
    from pg_proc f join pg_namespace n on n.oid = f.pronamespace
   where n.nspname = 'public' and f.prosecdef and has_function_privilege('anon', f.oid, 'execute')
     and f.proname not in ('ref_try_uuid')
  union all
  select 4, 'MEDIUM', 'Definer function without fixed search_path', f.oid::regprocedure::text,
         'Add "set search_path = public" so the function cannot be tricked into using another schema''s objects.'
    from pg_proc f join pg_namespace n on n.oid = f.pronamespace
   where n.nspname = 'public' and f.prosecdef and not coalesce(array_to_string(f.proconfig, ',') like '%search_path%', false)
  union all
  select 4, 'MEDIUM', 'Table without hospital_id', t.name,
         'Shared by all hospitals on this database. Confirm that is intended.'
    from tbl t where not t.tenant and t.rls and t.name not in (select name from reference_tables)
      and t.name not in ('hospitals', 'hospital_networks', 'receipt_counters', 'hospital_users', 'icd10_codes', 'loinc_codes', 'purchase_order_items')
  union all
  select 5, 'MEDIUM', 'Public storage bucket', b.name,
         'Files in this bucket can be downloaded by anyone with the link. Patient documents must use a private bucket.'
    from storage.buckets b where b.public
  union all
  select 9, 'OK', 'Summary', count(*)::text || ' public tables',
         count(*) filter (where rls)::text || ' with RLS on'
    from tbl
)
select severity, area, object, detail from findings order by rank, area, object;
