-- =============================================================================
-- RemedacareHMS - MERGE DUPLICATE DEPARTMENTS (PSYCHIATRY / MENTAL HEALTH, OPHTHALMOLOGY / EYE CLINIC, SPELLING VARIANTS) AND MOVE STAFF TO THE KEPT ONE
-- Generated from supabase/migrations/20261229000000_merge_duplicate_departments.sql - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.priv_is_admin(uuid)') is null then
    raise exception 'Run 11_audit_privacy.sql first. Nothing was changed.';
  end if;
end $$;

create or replace function public.department_canonical(p_name text)
returns text language sql immutable as $$
  with t as (select regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g') as tidy),
  k as (select tidy, lower(tidy) as key from t)
  select case
    when key = '' then null
    when key in ('mental health', 'mental health & psychiatry', 'mental health and psychiatry', 'psychiatry', 'psychiatric', 'psychiatric unit', 'psychiatric clinic', 'psychiatry clinic', 'mental health clinic', 'mental health unit') then 'Mental Health & Psychiatry'
    when key in ('eye clinic', 'eye', 'eye unit', 'eye / optical', 'eye/optical', 'optical', 'ophthalmology', 'opthalmology', 'ophthamology', 'ophamology', 'opthamology', 'ophthalmology clinic') then 'Eye Clinic'
    when key in ('dental', 'dentistry', 'dental clinic', 'dental unit', 'dental services') then 'Dental'
    when key in ('nutrition', 'nutrition & dietetics', 'nutrition and dietetics', 'dietetics', 'nutrition and dietetic', 'nutrition department') then 'Nutrition & Dietetics'
    when key in ('obstetrics & gynaecology', 'obstetrics and gynaecology', 'obstetrics & gynecology', 'obstetrics and gynecology', 'obs & gyn', 'obs & gynae', 'obs gyn', 'obs/gyn', 'obs / gyn', 'obgyn', 'ob/gyn', 'ob-gyn', 'o&g', 'obs and gynae', 'gynaecology', 'gynecology') then 'Obstetrics & Gynaecology'
    when key in ('orthopaedics', 'orthopedics', 'orthopaedic', 'orthopedic', 'ortho', 'aorthopaedics', 'orthopaedic clinic') then 'Orthopaedics'
    when key in ('ent', 'e.n.t', 'e.n.t.', 'ear nose & throat', 'ear, nose & throat', 'ear nose and throat', 'ear, nose and throat', 'ent clinic') then 'ENT'
    when key in ('paediatrics', 'pediatrics', 'paeds', 'peds', 'peadiatrics', 'paediatric', 'pediatric', 'paediatric clinic') then 'Paediatrics'
    when key in ('physiotherapy', 'physio', 'physical therapy', 'physiotherapy unit') then 'Physiotherapy'
    when key in ('general medicine', 'medicine', 'internal medicine', 'medical department') then 'General Medicine'
    when key in ('mortuary', 'morgue', 'funeral home') then 'Mortuary'
    when key in ('cardiology', 'cardiac clinic', 'cardiac unit', 'heart clinic') then 'Cardiology'
    when key in ('dermatology', 'skin clinic', 'derm') then 'Dermatology'
    when key in ('neurology', 'neuro', 'neurology clinic') then 'Neurology'
    when key in ('oncology', 'cancer clinic', 'cancer centre', 'cancer center', 'oncology unit') then 'Oncology'
    when key in ('urology', 'urology clinic') then 'Urology'
    when key in ('community health', 'community health services', 'public health', 'community health department') then 'Community Health'
    when key in ('radiology', 'imaging', 'radiology & imaging', 'radiology and imaging', 'x-ray', 'xray', 'x ray') then 'Radiology & Imaging'
    when key in ('laboratory', 'lab', 'labs', 'medical laboratory') then 'Laboratory'
    when key in ('it', 'ict', 'it & systems', 'it and systems', 'information technology', 'ict department') then 'IT & Systems'
    else tidy end
  from k
$$;

create or replace function public.department_merge_allowed(p_hospital uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return true; end if;
  return coalesce(public.priv_is_admin(p_hospital), false);
exception when undefined_function then
  return false;
end $$;

create or replace function public.department_merge_preview(p_hospital uuid)
returns table(department text, keep_name text, merge_names text[], rows_removed int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.department_merge_allowed(p_hospital) then raise exception 'Only an administrator can merge departments'; end if;
  return query
    with d as (select id, name, public.department_canonical(name) as canon, to_jsonb(dep) as j from public.departments dep where dep.hospital_id = p_hospital),
    g as (
      select canon,
             (array_agg(name order by (name = canon) desc, j->>'created_at' nulls last, id::text))[1] as keep,
             array_agg(name order by name) as names, count(*)::int as n
        from d where canon is not null group by canon)
    select g.canon, g.keep, g.names, g.n - 1 from g
     where g.n > 1 or g.keep <> g.canon
     order by g.canon;
end $$;

create or replace function public.department_merge(p_hospital uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_keep uuid; v_merged int := 0; v_renamed int := 0; v_removed int := 0; v_staff int := 0; v_n int;
  v_has_staff_dept boolean; v_has_beds boolean; v_beds int; v_out jsonb := '[]'::jsonb;
begin
  if not public.department_merge_allowed(p_hospital) then raise exception 'Only an administrator can merge departments'; end if;
  v_has_staff_dept := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'staff' and column_name = 'department');
  v_has_beds := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'departments' and column_name = 'bed_count');
  for r in select * from public.department_merge_preview(p_hospital) loop
    select id into v_keep from public.departments
     where hospital_id = p_hospital and name = r.keep_name
     order by (to_jsonb(departments)->>'created_at') nulls last, id::text limit 1;
    if v_has_beds then
      execute 'select max(coalesce(bed_count, 0))::int from public.departments where hospital_id = $1 and public.department_canonical(name) = $2' into v_beds using p_hospital, r.department;
      execute 'update public.departments set bed_count = $1 where id = $2' using v_beds, v_keep;
    end if;
    delete from public.departments where hospital_id = p_hospital and public.department_canonical(name) = r.department and id <> v_keep;
    get diagnostics v_n = row_count; v_removed := v_removed + v_n;
    update public.departments set name = r.department where id = v_keep and name <> r.department;
    get diagnostics v_n = row_count; v_renamed := v_renamed + v_n;
    if v_has_staff_dept then
      execute 'update public.staff set department = $1 where hospital_id = $2 and department is distinct from $1 and public.department_canonical(department) = $1'
        using r.department, p_hospital;
      get diagnostics v_n = row_count; v_staff := v_staff + v_n;
    end if;
    v_merged := v_merged + 1;
    v_out := v_out || jsonb_build_object('department', r.department, 'from', to_jsonb(r.merge_names));
  end loop;
  return jsonb_build_object('departments_fixed', v_merged, 'rows_removed', v_removed, 'renamed', v_renamed, 'staff_moved', v_staff, 'details', v_out);
end $$;

revoke execute on function public.department_merge_allowed(uuid), public.department_merge_preview(uuid), public.department_merge(uuid) from public, anon;
grant execute on function public.department_canonical(text) to authenticated, service_role;
grant execute on function public.department_merge_preview(uuid), public.department_merge(uuid) to authenticated, service_role;

commit;

select coalesce(h.name, d.hospital_id::text) as hospital, public.department_merge(d.hospital_id) as what_was_merged
      from (select distinct hospital_id from public.departments) d left join public.hospitals h on h.id = d.hospital_id;
