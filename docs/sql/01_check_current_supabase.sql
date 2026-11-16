-- RemedacareHMS - PRE-INSTALL CHECK for the payments ledger
-- READ-ONLY. It changes nothing. It is ONE statement, so the SQL editor cannot split it.
-- Paste everything into Supabase SQL Editor and press Run. You get one table back.
-- BLOCKER = fix before installing. WARN = read it. OK and INFO = fine.
with
cols as (
  select c.table_schema as s, c.table_name as t, c.column_name as c, c.udt_name as typ
  from information_schema.columns c
  where c.table_schema in ('public', 'auth')
),
has as (
  select
    (select count(*) from cols where s = 'public' and t = 'invoices'
       and c in ('hospital_id', 'amount_kes', 'paid_kes', 'status', 'payment_method')) = 5 as inv,
    (select count(*) from cols where s = 'public' and t = 'staff' and c in ('hospital_id', 'email', 'role', 'id')) = 4 as stf,
    (select count(*) from cols where s = 'public' and t = 'hospital_users' and c in ('hospital_id', 'user_id', 'role')) = 3 as hu,
    (select count(*) from cols where s = 'public' and t = 'hospitals' and c in ('id', 'owner_email')) = 2 as hosp,
    exists (select 1 from cols where s = 'public' and t = 'payments' and c = 'refund_of') as installed
),
required(s, t, c, need_type, why) as (values
  ('public', 'invoices', 'id', 'uuid', 'payments.invoice_id is a uuid foreign key'),
  ('public', 'invoices', 'hospital_id', 'uuid', null),
  ('public', 'invoices', 'patient_id', 'uuid', null),
  ('public', 'invoices', 'visit_id', 'uuid', null),
  ('public', 'invoices', 'amount_kes', null, null),
  ('public', 'invoices', 'paid_kes', null, null),
  ('public', 'invoices', 'balance_kes', null, null),
  ('public', 'invoices', 'status', null, null),
  ('public', 'invoices', 'payment_method', null, null),
  ('public', 'invoices', 'paid_at', null, null),
  ('public', 'invoices', 'invoice_no', null, null),
  ('public', 'invoices', 'patient_name', null, null),
  ('public', 'hospitals', 'id', 'uuid', null),
  ('public', 'hospitals', 'owner_email', null, 'owner is always admin for payments'),
  ('public', 'hospital_users', 'user_id', 'uuid', null),
  ('public', 'hospital_users', 'hospital_id', 'uuid', null),
  ('public', 'hospital_users', 'role', null, null),
  ('public', 'staff', 'id', null, null),
  ('public', 'staff', 'hospital_id', 'uuid', null),
  ('public', 'staff', 'email', null, 'the job title is looked up by email'),
  ('public', 'staff', 'role', null, null),
  ('public', 'staff', 'status', null, 'suspended or terminated staff cannot take money'),
  ('public', 'audit_log', 'hospital_id', null, null),
  ('public', 'audit_log', 'action', null, null),
  ('public', 'audit_log', 'details', null, null),
  ('public', 'audit_log', 'target_id', null, null),
  ('auth', 'users', 'email', null, null)
),
data as (
  select
    case when h.inv then query_to_xml('select count(*)::text as v from public.invoices', false, true, '')::text end as total,
    case when h.inv then query_to_xml('select count(*) || '' invoices, KES '' || coalesce(sum(paid_kes), 0) as v from public.invoices where coalesce(paid_kes, 0) > 0 and hospital_id is not null', false, true, '')::text end as backfill,
    case when h.inv then query_to_xml('select count(*)::text as v from public.invoices where hospital_id is null', false, true, '')::text end as no_hosp,
    case when h.inv then query_to_xml('select count(*)::text as v from public.invoices where coalesce(paid_kes, 0) > coalesce(amount_kes, 0)', false, true, '')::text end as overpaid,
    case when h.inv then query_to_xml('select count(*)::text as v from public.invoices where status = ''Paid'' and coalesce(paid_kes, 0) < coalesce(amount_kes, 0)', false, true, '')::text end as paid_short,
    case when h.inv then query_to_xml('select string_agg(coalesce(payment_method, ''(blank)'') || ''='' || n, '', '' order by n desc) as v from (select payment_method, count(*) as n from public.invoices group by 1) x', false, true, '')::text end as methods,
    case when h.inv then query_to_xml('select string_agg(coalesce(status, ''(blank)'') || ''='' || n, '', '' order by n desc) as v from (select status, count(*) as n from public.invoices group by 1) x', false, true, '')::text end as statuses,
    case when h.hu then query_to_xml('select string_agg(coalesce(role, ''(blank)'') || ''='' || n, '', '' order by n desc) as v from (select role, count(*) as n from public.hospital_users group by 1) x', false, true, '')::text end as hu_roles,
    case when h.stf then query_to_xml('select string_agg(coalesce(role, ''(blank)'') || ''='' || n, '', '' order by n desc) as v from (select role, count(*) as n from public.staff group by 1) x', false, true, '')::text end as staff_roles,
    case when h.stf then query_to_xml('select count(*)::text as v from (select 1 from public.staff where email is not null group by hospital_id, lower(email) having count(*) > 1) x', false, true, '')::text end as dup_staff,
    case when h.stf and h.hu and h.hosp then query_to_xml('select count(*)::text as v from public.hospital_users hu join auth.users u on u.id = hu.user_id left join public.hospitals hs on hs.id = hu.hospital_id left join public.staff st on st.hospital_id = hu.hospital_id and lower(st.email) = lower(u.email) where lower(coalesce(hs.owner_email, '''')) <> lower(coalesce(u.email, '''')) and st.id is null and lower(coalesce(hu.role, '''')) in ('''', ''staff'')', false, true, '')::text end as no_staff_row
  from has h
),
d as (
  select
    substring(total from '<v>(.*)</v>') as total,
    substring(backfill from '<v>(.*)</v>') as backfill,
    substring(no_hosp from '<v>(.*)</v>') as no_hosp,
    substring(overpaid from '<v>(.*)</v>') as overpaid,
    substring(paid_short from '<v>(.*)</v>') as paid_short,
    replace(substring(methods from '<v>(.*)</v>'), chr(38) || 'amp' || chr(59), chr(38)) as methods,
    replace(substring(statuses from '<v>(.*)</v>'), chr(38) || 'amp' || chr(59), chr(38)) as statuses,
    replace(substring(hu_roles from '<v>(.*)</v>'), chr(38) || 'amp' || chr(59), chr(38)) as hu_roles,
    replace(substring(staff_roles from '<v>(.*)</v>'), chr(38) || 'amp' || chr(59), chr(38)) as staff_roles,
    substring(dup_staff from '<v>(.*)</v>') as dup_staff,
    substring(no_staff_row from '<v>(.*)</v>') as no_staff_row
  from data
),
checks(sev, chk, detail) as (
  select case when current_setting('server_version_num')::int >= 150000 then 'OK' else 'BLOCKER' end,
         'Postgres version', current_setting('server_version') || ' (15 or newer needed)'
  union all
  select case when exists (select 1 from pg_roles where rolname = 'authenticated')
               and exists (select 1 from pg_roles where rolname = 'service_role') then 'OK' else 'BLOCKER' end,
         'Supabase roles', 'authenticated and service_role present'
  union all
  select case when exists (select 1 from pg_publication where pubname = 'supabase_realtime') then 'OK' else 'WARN' end,
         'Realtime publication', 'supabase_realtime (live payment status in Billing)'
  union all
  select case when count(*) = 2 then 'OK' else 'WARN' end, 'pg_cron and pg_net',
         coalesce(string_agg(extname, ', '), 'none') || ' installed. Both are needed for the lost-webhook sweep (Database, Extensions)'
  from pg_extension where extname in ('pg_cron', 'pg_net')
  union all
  select 'INFO', 'Supabase Vault',
         case when exists (select 1 from pg_extension where extname = 'supabase_vault') then 'available (recommended later for gateway keys)' else 'not installed' end
  union all
  select case when cl.c is null then 'BLOCKER'
              when r.need_type is not null and cl.typ <> r.need_type then 'BLOCKER'
              else 'OK' end,
         'Column ' || r.s || '.' || r.t || '.' || r.c,
         case when cl.c is null then 'MISSING' || coalesce(' (' || r.why || ')', '')
              else 'type ' || cl.typ || coalesce(' (need ' || r.need_type || ')', '') end
  from required r left join cols cl on cl.s = r.s and cl.t = r.t and cl.c = r.c
  union all
  select 'INFO', 'Column public.hospital_users.active',
         case when exists (select 1 from cols where t = 'hospital_users' and c = 'active') then 'present (inactive links lose payment access)' else 'absent (fine)' end
  union all
  select case when to_regclass('public.mpesa_transactions') is null then 'WARN' else 'OK' end,
         'Table mpesa_transactions',
         case when to_regclass('public.mpesa_transactions') is null then 'missing, the M-Pesa screen will not work' else 'present (payment_id column will be added)' end
  union all
  select case when to_regclass('public.' || n) is null then 'OK' when h.installed then 'INFO'
              when n = 'payments' and substring(query_to_xml('select count(*) as c from public.payments', false, true, '')::text from '<c>(.*)</c>') = '0' then 'WARN'
              else 'BLOCKER' end,
         'Name free: public.' || n,
         case when to_regclass('public.' || n) is null then 'not used yet'
              when h.installed then 'already installed by this upgrade (re-run is safe)'
              when n = 'payments' and substring(query_to_xml('select count(*) as c from public.payments', false, true, '')::text from '<c>(.*)</c>') = '0'
                then 'old EMPTY payments table. The install moves it to payments_old_20261114 automatically'
              when n = 'payments' then 'old payments table WITH DATA. Send it to your developer before installing'
              else 'ALREADY EXISTS. Send me its columns before installing' end
  from unnest(array['payments', 'receipt_counters', 'payment_events', 'hospital_payment_settings',
                    'hospital_payment_credentials', 'payment_daily_summary']) as n, has h
  union all
  select 'WARN', 'Function name already used: ' || p.proname,
         pg_get_function_identity_arguments(p.oid) || ' returns ' || pg_get_function_result(p.oid)
           || '. The install REPLACES it. Tell me if your own code uses it'
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace, has h
  where ns.nspname = 'public' and not h.installed
    and p.proname in ('pay_canonical_role', 'pay_user_context', 'pay_access_level', 'pay_member_role', 'pay_is_member',
                      'can_take_payments', 'can_manage_payments', 'is_payments_admin', 'set_payment_credentials',
                      'payment_credentials_status', 'next_receipt_no', 'payment_ref_family', 'payments_before_write',
                      'recompute_invoice_payments', 'payments_after_write', 'payments_audit', 'invoice_open_amount',
                      'record_manual_payments', 'resolve_pending_payment', 'cancel_pending_payment', 'record_manual_refund',
                      'create_online_payment', 'create_gateway_refund', 'invoices_guard_ledger', 'invoices_sync_ledger')
  union all
  select 'INFO', 'Existing trigger on invoices: ' || tgname, pg_get_triggerdef(oid)
  from pg_trigger where tgrelid = to_regclass('public.invoices') and not tgisinternal
    and tgname not in ('trg_invoices_guard_ledger', 'trg_invoices_sync_ledger')
  union all
  select case when relrowsecurity then 'OK' else 'WARN' end, 'RLS on ' || relname,
         case when relrowsecurity then 'enabled' else 'DISABLED, any signed-in user can read and write every hospital''s rows' end
  from pg_class where oid in (to_regclass('public.invoices'), to_regclass('public.hospital_users'), to_regclass('public.staff'))
  union all
  select case when (coalesce(qual, '') || coalesce(with_check, '')) ~* 'auth\.uid\(\)\s*=\s*user_id|user_id\s*=\s*auth\.uid\(\)|auth\.email\(\)|email\s*=' then 'WARN' else 'INFO' end,
         'Write policy ' || tablename || '.' || policyname || ' (' || cmd || ')',
         'USING ' || coalesce(qual, '-') || ' CHECK ' || coalesce(with_check, '-')
           || case when (coalesce(qual, '') || coalesce(with_check, '')) ~* 'auth\.uid\(\)\s*=\s*user_id|user_id\s*=\s*auth\.uid\(\)|auth\.email\(\)|email\s*='
                   then '   <-- users may be able to edit their OWN role here (self-promotion to admin)' else '' end
  from pg_policies where schemaname = 'public' and tablename in ('hospital_users', 'staff') and cmd in ('UPDATE', 'ALL', 'INSERT')
  union all
  select 'INFO', 'Invoices total', coalesce(d.total, 'skipped (invoices columns missing)') from d
  union all
  select 'INFO', 'Invoices to back-fill into the ledger', coalesce(d.backfill, 'skipped') from d
  union all
  select case when coalesce(d.no_hosp, '0') = '0' then 'OK' else 'WARN' end,
         'Invoices with no hospital_id', coalesce(d.no_hosp, 'skipped') || ' (left out of the ledger)' from d
  union all
  select case when coalesce(d.overpaid, '0') = '0' then 'OK' else 'WARN' end,
         'Over-paid invoices (paid more than amount)', coalesce(d.overpaid, 'skipped') from d
  union all
  select case when coalesce(d.paid_short, '0') = '0' then 'OK' else 'WARN' end,
         'Invoices marked Paid but paid less than amount',
         coalesce(d.paid_short, 'skipped') || ' (they will show as Partial after install, insurer write-offs?)' from d
  union all
  select 'INFO', 'Invoice payment_method values', coalesce(d.methods, '-') from d
  union all
  select 'INFO', 'Invoice status values', coalesce(d.statuses, '-') from d
  union all
  select 'INFO', 'hospital_users.role values', coalesce(d.hu_roles, '-') from d
  union all
  select 'INFO', 'staff.role values (these decide who can take money)', coalesce(d.staff_roles, '-') from d
  union all
  select case when coalesce(d.dup_staff, '0') = '0' then 'OK' else 'WARN' end,
         'Duplicate staff emails in a hospital', coalesce(d.dup_staff, 'skipped') || ' (the active record wins)' from d
  union all
  select case when coalesce(d.no_staff_row, '0') = '0' then 'OK' else 'WARN' end,
         'Users with no staff record and role staff',
         coalesce(d.no_staff_row, 'skipped') || ' (view-only for payments until given a staff role)' from d
)
select sev as severity, chk as "check", detail
from checks
order by case sev when 'BLOCKER' then 0 when 'WARN' then 1 when 'INFO' then 2 else 3 end, chk;
