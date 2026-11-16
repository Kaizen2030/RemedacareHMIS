-- Multi-facility (hospital networks). Each facility is a row in hospitals; facilities of one organisation share a
-- network_id. Data, access rules and per-site roles were already per facility (hospital_id + hospital_users). This adds:
--   * one patient across facilities: patients.mpi_id (master patient index). Registering a patient who is already
--     known at a sister facility copies their details (not their clinical record) and links the two.
--   * network search: staff find a patient registered at a sister facility (exact ID / phone / patient number, or
--     name) without re-typing them; confidential patients never appear.
--   * network history: clinical staff see a linked patient's visits, diagnoses and medicines at sister facilities;
--     every look is written to the access log of the facility that holds the record.
--   * network summary for administrators: today's activity per facility they administer.

do $$ begin
  execute 'alter table public.patients add column if not exists mpi_id uuid';
  execute 'create index if not exists patients_mpi on public.patients(mpi_id) where mpi_id is not null';
end $$;

-- Facilities in the same network as p_hospital (including itself)
create or replace function public.net_facilities(p_hospital uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select h.id from public.hospitals h
   where h.id = p_hospital
      or (to_jsonb(h)->>'network_id' is not null
          and to_jsonb(h)->>'network_id' = (select to_jsonb(x)->>'network_id' from public.hospitals x where x.id = p_hospital))
$$;

create or replace function public.network_patient_search(p_hospital uuid, p_query text)
returns table (patient_id uuid, hospital_id uuid, hospital_name text, full_name text, gender text, age text,
               national_id_hint text, phone_hint text, already_here boolean)
language plpgsql stable security definer set search_path = public as $$
declare q text := trim(coalesce(p_query, '')); v_phone text := public.portal_phone_norm(p_query);
begin
  if not public.pay_is_member(p_hospital) then raise exception 'You do not belong to this facility'; end if;
  if length(q) < 3 then raise exception 'Type at least 3 characters'; end if;
  return query execute
    'with p as (
       select p.*, to_jsonb(p) as j, public.ref_try_uuid(p.hospital_id::text) as hid from public.patients p
        where public.ref_try_uuid(p.hospital_id::text) in (select public.net_facilities($1))
          and public.ref_try_uuid(p.hospital_id::text) <> $1
          and coalesce((to_jsonb(p)->>''confidential'')::boolean, false) = false
          and (   to_jsonb(p)->>''national_id'' = $2
               or to_jsonb(p)->>''sha_member_no'' = $2
               or to_jsonb(p)->>''patient_number'' = $2
               or ($3 is not null and public.portal_phone_norm(to_jsonb(p)->>''phone'') = $3)
               or (length($2) >= 3 and $2 !~ ''^[0-9 +]+$'' and p.full_name ilike ''%'' || replace(replace($2, ''%'', ''''), ''_'', '''') || ''%''))
        limit 25)
     select p.id, p.hid, h.name::text, p.full_name::text, (p.j->>''gender'')::text,
            coalesce(p.j->>''age'', case when p.j->>''dob'' ~ ''^\d{4}'' then extract(year from age(current_date, (p.j->>''dob'')::date))::int::text end)::text,
            case when p.j->>''national_id'' is not null then ''…'' || right(p.j->>''national_id'', 3) end,
            case when p.j->>''phone'' is not null then ''…'' || right(regexp_replace(p.j->>''phone'', ''[^0-9]'', '''', ''g''), 3) end,
            exists (select 1 from public.patients here where public.ref_try_uuid(here.hospital_id::text) = $1
                     and here.mpi_id is not null and here.mpi_id = coalesce(p.mpi_id, p.id))
       from p left join public.hospitals h on h.id = p.hid
      order by p.full_name'
    using p_hospital, q, v_phone;
end $$;

-- Register a sister facility's patient here: demographics only, linked by mpi_id. Returns the new (or existing) id.
create or replace function public.network_patient_import(p_hospital uuid, p_source uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare src jsonb; v_src_h uuid; v_mpi uuid; v_existing uuid; v_row jsonb; v_cols text; v_new uuid;
begin
  if not public.pay_is_member(p_hospital) then raise exception 'You do not belong to this facility'; end if;
  select to_jsonb(p), public.ref_try_uuid(p.hospital_id::text) into src, v_src_h from public.patients p where p.id = p_source;
  if src is null or v_src_h = p_hospital or v_src_h not in (select public.net_facilities(p_hospital)) then
    raise exception 'That patient is not registered at a facility in your network';
  end if;
  if coalesce((src->>'confidential')::boolean, false) then raise exception 'Confidential records cannot be copied between facilities'; end if;
  v_mpi := coalesce((src->>'mpi_id')::uuid, p_source);
  update public.patients set mpi_id = v_mpi where id = p_source and mpi_id is null;
  select id into v_existing from public.patients where mpi_id = v_mpi and public.ref_try_uuid(hospital_id::text) = p_hospital limit 1;
  if v_existing is not null then return v_existing; end if;

  v_new := gen_random_uuid();
  v_row := jsonb_strip_nulls(src - array['id', 'hospital_id', 'patient_number', 'created_at', 'updated_at', 'confidential', 'mpi_id'])
           || jsonb_build_object('id', v_new, 'hospital_id', p_hospital, 'mpi_id', v_mpi);
  select string_agg(quote_ident(c.column_name), ', ') into v_cols
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'patients' and c.is_generated = 'NEVER' and coalesce(c.is_identity, 'NO') = 'NO'
     and v_row ? c.column_name;
  execute format('insert into public.patients (%s) select %s from jsonb_populate_record(null::public.patients, $1)', v_cols, v_cols) using v_row;
  perform public.payments_audit(p_hospital, 'insert:patients', v_new, jsonb_build_object('copied_from_facility', v_src_h, 'source_patient', p_source));
  return v_new;
end $$;

-- A linked patient's visits, diagnoses and medicines at the other facilities of the network (clinical staff only)
create or replace function public.network_patient_history(p_hospital uuid, p_patient uuid)
returns table (hospital_name text, happened_at timestamptz, kind text, summary text)
language plpgsql security definer set search_path = public as $$
declare v_mpi uuid; r record;
begin
  if not public.clin_can_access(p_hospital) then raise exception 'Only clinical staff can view records from other facilities'; end if;
  select coalesce(mpi_id, id) into v_mpi from public.patients where id = p_patient and public.ref_try_uuid(hospital_id::text) = p_hospital;
  if v_mpi is null then raise exception 'Patient not found at this facility'; end if;
  for r in select p.id, public.ref_try_uuid(p.hospital_id::text) as hid from public.patients p
            where (p.mpi_id = v_mpi or p.id = v_mpi) and p.id <> p_patient
              and public.ref_try_uuid(p.hospital_id::text) in (select public.net_facilities(p_hospital))
              and coalesce((to_jsonb(p)->>'confidential')::boolean, false) = false loop
    begin
      insert into public.patient_access_log(hospital_id, patient_id, user_id, user_email, action, context)
      values (r.hid, r.id, auth.uid(), (select email from auth.users where id = auth.uid()), 'view', 'network history from another facility');
    exception when others then null;
    end;
    return query execute
      'select h.name::text, v.created_at::timestamptz, ''Visit''::text, concat_ws('' · '', to_jsonb(v)->>''visit_type'', to_jsonb(v)->>''speciality'', to_jsonb(v)->>''status'')
         from public.visits v left join public.hospitals h on h.id = $2 where v.patient_id::text = $1::text
       union all
       select h.name::text, c.created_at::timestamptz, ''Diagnosis''::text, concat_ws('' '', to_jsonb(c)->>''icd10_code'', to_jsonb(c)->>''diagnosis'')
         from public.consultations c left join public.hospitals h on h.id = $2 where c.patient_id::text = $1::text and coalesce(to_jsonb(c)->>''diagnosis'', to_jsonb(c)->>''icd10_code'') is not null
       union all
       select h.name::text, rx.created_at::timestamptz, ''Medicine''::text, concat_ws('' '', to_jsonb(rx)->>''drug_name'', to_jsonb(rx)->>''dosage'', to_jsonb(rx)->>''frequency'', to_jsonb(rx)->>''duration'')
         from public.prescriptions rx left join public.hospitals h on h.id = $2 where rx.patient_id::text = $1::text'
      using r.id, r.hid;
  end loop;
end $$;

-- Today's activity at every facility of the network that the caller administers
create or replace function public.network_summary(p_hospital uuid)
returns table (hospital_id uuid, hospital_name text, patients bigint, visits_today bigint, visits_month bigint, open_balance numeric)
language plpgsql stable security definer set search_path = public as $$
declare f uuid;
begin
  for f in select public.net_facilities(p_hospital) loop
    if not public.priv_is_admin(f) then continue; end if;
    return query execute
      'select $1, (select name::text from public.hospitals where id = $1),
              (select count(*) from public.patients where public.ref_try_uuid(hospital_id::text) = $1),
              (select count(*) from public.visits where public.ref_try_uuid(hospital_id::text) = $1 and created_at >= date_trunc(''day'', now())),
              (select count(*) from public.visits where public.ref_try_uuid(hospital_id::text) = $1 and created_at >= date_trunc(''month'', now())),
              (select coalesce(sum(coalesce((to_jsonb(i)->>''balance_kes'')::numeric, 0)), 0) from public.invoices i
                where public.ref_try_uuid(i.hospital_id::text) = $1 and coalesce(i.status, '''') not in (''Cancelled'', ''Paid''))'
      using f;
  end loop;
end $$;

revoke execute on function public.net_facilities(uuid), public.network_patient_search(uuid, text), public.network_patient_import(uuid, uuid),
  public.network_patient_history(uuid, uuid), public.network_summary(uuid) from public, anon;
grant execute on function public.network_patient_search(uuid, text), public.network_patient_import(uuid, uuid),
  public.network_patient_history(uuid, uuid), public.network_summary(uuid) to authenticated, service_role;
grant execute on function public.net_facilities(uuid) to service_role;
