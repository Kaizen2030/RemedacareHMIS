-- =============================================================================
-- RemedacareHMS - INPATIENTS PER DEPARTMENT (ADMITTING DEPARTMENT ON ADMISSIONS, FILLED IN FOR EXISTING ADMISSIONS)
-- Generated from supabase/migrations/20261231100000_admission_department.sql - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.pay_is_member(uuid)') is null then
    raise exception 'Run 02_install_payments.sql first. Nothing was changed.';
  end if;
end $$;

do $$ begin
  if to_regclass('public.admissions') is null then raise exception 'The admissions table is missing (base RemedacareHMS schema). Nothing was changed.'; end if;
end $$;

alter table public.admissions add column if not exists admitting_department text;
create index if not exists admissions_department_active on public.admissions(hospital_id, admitting_department, status);

do $$
declare v_canon boolean := to_regprocedure('public.department_canonical(text)') is not null;
begin
  if to_regclass('public.visits') is null then return; end if;
  execute format($q$
    update public.admissions a
       set admitting_department = %s
      from public.visits v
     where v.id::text = a.visit_id::text
       and a.admitting_department is null
       and coalesce(v.speciality, '') <> ''
       and lower(coalesce(v.speciality, '')) not in ('admitted', 'admission requested', 'inpatient / wards', 'general')$q$,
    case when v_canon then 'public.department_canonical(v.speciality)' else 'v.speciality' end);
end $$;

commit;

select 'admitting department' as check_name, case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'admissions' and column_name = 'admitting_department') then 'OK' else 'PROBLEM' end as result
    union all select 'active admissions without a department', (select count(*)::text from public.admissions where status = 'Active' and admitting_department is null);
