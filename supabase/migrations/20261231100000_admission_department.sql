-- Inpatients per department: every admission records the department / team it is under (admitting_department), so each
-- department page can list its inpatients. Existing admissions are filled in from the visit's department, using the
-- proper department name when docs/sql/47 (department_canonical) is installed.

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
