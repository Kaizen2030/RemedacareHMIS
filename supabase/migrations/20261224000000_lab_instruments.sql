-- =============================================================================
-- RemedacareHMS — laboratory analyser interface (haematology, chemistry, immunoassay).
--   A small "lab bridge" program on the lab PC (tools/lab-bridge) listens to analysers over ASTM E1381/E1394 or
--   HL7 v2 (MLLP), by network or serial cable, and posts results to the lab-ingest edge function with the
--   analyser's own API key. Results are matched to the order by the sample barcode, analyser codes are mapped to
--   the result template (with unit conversion), and they wait in the instrument inbox until a laboratory scientist
--   accepts them (or are accepted automatically when the analyser is set to auto-accept and everything mapped).
--   Accepting writes the structured result to lab_tests, which runs the delta check, auto-validation and the
--   critical-results loop.
-- Requires 34 (lab_tests result_json, lab_rules) and 11 (priv_is_admin). Safe to re-run.
-- =============================================================================

create table if not exists public.lab_instruments (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null,
  name          text not null,
  model         text,
  protocol      text not null default 'astm' check (protocol in ('astm', 'hl7', 'csv')),
  department    text not null default 'chemistry' check (department in ('haematology', 'chemistry', 'immunoassay', 'microbiology', 'other')),
  auto_accept   boolean not null default false,
  key_prefix    text not null,
  key_hash      text not null unique,
  active        boolean not null default true,
  last_seen_at  timestamptz,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz
);

create table if not exists public.lab_instrument_maps (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid,                         -- null = shipped default
  instrument_id uuid references public.lab_instruments(id) on delete cascade,
  external_code text not null,
  unit          text,                         -- when set, the row applies only to results in this unit
  template_key  text not null,
  analyte       text not null,
  factor        numeric not null default 1,   -- multiply the analyser value by this (unit conversion)
  created_at    timestamptz not null default now()
);
create unique index if not exists lab_instrument_maps_key on public.lab_instrument_maps(
  coalesce(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(instrument_id, '00000000-0000-0000-0000-000000000000'::uuid), upper(external_code), coalesce(lower(unit), ''));

-- Common analyser codes → RemedacareHMS templates (fbc, rfts, lft), with conversions to the template units.
insert into public.lab_instrument_maps(hospital_id, instrument_id, external_code, unit, template_key, analyte, factor) values
  (null, null, 'WBC', null, 'fbc', 'wbc', 1),
  (null, null, 'HGB', null, 'fbc', 'haemoglobin', 1), (null, null, 'HGB', 'g/L', 'fbc', 'haemoglobin', 0.1), (null, null, 'HB', null, 'fbc', 'haemoglobin', 1),
  (null, null, 'HB', 'g/L', 'fbc', 'haemoglobin', 0.1),
  (null, null, 'PLT', null, 'fbc', 'platelets', 1),
  (null, null, 'NA', null, 'rfts', 'sodium', 1), (null, null, 'NA+', null, 'rfts', 'sodium', 1), (null, null, 'SOD', null, 'rfts', 'sodium', 1),
  (null, null, 'K', null, 'rfts', 'potassium', 1), (null, null, 'K+', null, 'rfts', 'potassium', 1), (null, null, 'POT', null, 'rfts', 'potassium', 1),
  (null, null, 'CL', null, 'rfts', 'chloride', 1), (null, null, 'CL-', null, 'rfts', 'chloride', 1),
  (null, null, 'UREA', null, 'rfts', 'urea', 1), (null, null, 'UREA', 'mg/dL', 'rfts', 'urea', 0.1665),
  (null, null, 'CREA', null, 'rfts', 'creatinine', 1), (null, null, 'CREA', 'mg/dL', 'rfts', 'creatinine', 88.4),
  (null, null, 'CREAT', null, 'rfts', 'creatinine', 1), (null, null, 'CREAT', 'mg/dL', 'rfts', 'creatinine', 88.4),
  (null, null, 'CRE', null, 'rfts', 'creatinine', 1), (null, null, 'CRE', 'mg/dL', 'rfts', 'creatinine', 88.4),
  (null, null, 'ALT', null, 'lft', 'alt', 1), (null, null, 'GPT', null, 'lft', 'alt', 1), (null, null, 'ALTL', null, 'lft', 'alt', 1),
  (null, null, 'AST', null, 'lft', 'ast', 1), (null, null, 'GOT', null, 'lft', 'ast', 1), (null, null, 'ASTL', null, 'lft', 'ast', 1),
  (null, null, 'TBIL', null, 'lft', 'bilirubin', 1), (null, null, 'TBIL', 'mg/dL', 'lft', 'bilirubin', 17.1), (null, null, 'BIL-T', null, 'lft', 'bilirubin', 1),
  (null, null, 'BIL-T', 'mg/dL', 'lft', 'bilirubin', 17.1),
  (null, null, 'ALB', null, 'lft', 'albumin', 1), (null, null, 'ALB', 'g/dL', 'lft', 'albumin', 10)
on conflict do nothing;

create table if not exists public.lab_instrument_results (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null,
  instrument_id uuid not null references public.lab_instruments(id) on delete cascade,
  sample_id     text not null,
  measured_at   timestamptz,
  received_at   timestamptz not null default now(),
  lab_test_id   text,
  patient_name  text,
  test_type     text,
  template_key  text,
  result_values jsonb not null default '{}'::jsonb,      -- { analyte: value } in template units
  flags         jsonb not null default '{}'::jsonb,      -- { analyte: analyser flag (H, L, HH, LL, A, …) }
  unmapped      jsonb not null default '[]'::jsonb,      -- [{ code, value, unit }]
  raw           text,
  status        text not null default 'pending' check (status in ('pending', 'unmatched', 'accepted', 'rejected')),
  accepted_by   uuid,
  accepted_at   timestamptz,
  reject_reason text,
  unique (instrument_id, sample_id, measured_at)
);
create index if not exists lab_instrument_results_inbox on public.lab_instrument_results(hospital_id, status, received_at desc);

-- ================================================================= keys
create or replace function public.lab_instrument_can_manage(p_hospital uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.priv_is_admin(p_hospital) or coalesce((select c.member and c.staff_active and lower(coalesce(c.raw_role, '')) ~ '(lab(oratory)? (manager|in-?charge|supervisor)|pathologist|chief (lab|medical lab))'
                   from public.pay_user_context(p_hospital, auth.uid()) c), false)
$$;

/** Register an analyser; returns its key ONCE (only a hash is stored). */
create or replace function public.lab_instrument_create(p_hospital uuid, p_name text, p_model text, p_protocol text, p_department text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_key text; v_id uuid;
begin
  if not public.lab_instrument_can_manage(p_hospital) then raise exception 'Only an administrator or the laboratory manager can connect analysers'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the analyser a name'; end if;
  v_key := 'rcl_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.lab_instruments(hospital_id, name, model, protocol, department, key_prefix, key_hash)
  values (p_hospital, trim(p_name), nullif(trim(p_model), ''), coalesce(p_protocol, 'astm'), coalesce(p_department, 'chemistry'), left(v_key, 12),
          encode(sha256(convert_to(v_key, 'UTF8')), 'hex'))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'key', v_key);
end $$;

-- ================================================================= ingest (edge function, service role)
/**
 * p_payload: { results: [ { sample_id, measured_at, records: [ { code, value, unit, flag } ], raw } ] }
 * Matches the order by sample barcode, maps codes, converts units and files each sample in the inbox.
 */
create or replace function public.lab_instrument_ingest(p_key text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ins public.lab_instruments; r jsonb; rec jsonb; m public.lab_instrument_maps; t jsonb; v_vals jsonb; v_flags jsonb; v_unmapped jsonb; v_tpl text;
        v_by_tpl jsonb; v_id uuid; n_new int := 0; n_unmatched int := 0; n_auto int := 0; v_num numeric; v_measured timestamptz;
begin
  update public.lab_instruments set last_seen_at = now()
   where key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex') and active and revoked_at is null
  returning * into ins;
  if ins.id is null then raise exception 'Unknown or revoked analyser key'; end if;

  for r in select * from jsonb_array_elements(coalesce(p_payload->'results', '[]'::jsonb)) loop
    if coalesce(trim(r->>'sample_id'), '') = '' then continue; end if;
    v_by_tpl := '{}'::jsonb; v_flags := '{}'::jsonb; v_unmapped := '[]'::jsonb;
    for rec in select * from jsonb_array_elements(coalesce(r->'records', '[]'::jsonb)) loop
      select * into m from public.lab_instrument_maps x
       where upper(x.external_code) = upper(trim(rec->>'code'))
         and (x.hospital_id = ins.hospital_id or x.hospital_id is null) and (x.instrument_id = ins.id or x.instrument_id is null)
         and (x.unit is null or lower(x.unit) = lower(coalesce(rec->>'unit', '')))
       order by (x.instrument_id is null), (x.hospital_id is null), (x.unit is null) limit 1;
      v_num := public.lab_num(rec->>'value');
      if m.id is null or v_num is null then
        v_unmapped := v_unmapped || jsonb_build_object('code', rec->>'code', 'value', rec->>'value', 'unit', rec->>'unit');
        continue;
      end if;
      v_by_tpl := jsonb_set(v_by_tpl, array[m.template_key], coalesce(v_by_tpl->m.template_key, '{}'::jsonb) || jsonb_build_object(m.analyte, round(v_num * m.factor, 2)), true);
      if coalesce(rec->>'flag', '') <> '' then v_flags := v_flags || jsonb_build_object(m.analyte, rec->>'flag'); end if;
    end loop;
    -- match the order by barcode
    execute 'select to_jsonb(l) from public.lab_tests l where l.hospital_id::text = $1 and upper(coalesce(to_jsonb(l)->>''sample_barcode'', '''')) = upper($2)
              order by l.created_at desc limit 1' into t using ins.hospital_id::text, trim(r->>'sample_id');
    v_tpl := coalesce(t->>'result_template_key', (select k from jsonb_each(v_by_tpl) e(k, v) order by (select count(*) from jsonb_object_keys(e.v)) desc limit 1));
    v_vals := coalesce(v_by_tpl->v_tpl, '{}'::jsonb);
    v_measured := coalesce(nullif(r->>'measured_at', '')::timestamptz, now());
    insert into public.lab_instrument_results(hospital_id, instrument_id, sample_id, measured_at, lab_test_id, patient_name, test_type, template_key, result_values, flags, unmapped, raw, status)
    -- result_values keeps every mapped template ({ template: { analyte: value } }); accepting applies the order's template
    values (ins.hospital_id, ins.id, trim(r->>'sample_id'), v_measured, t->>'id', t->>'patient_name', t->>'test_type', v_tpl, v_by_tpl, v_flags,
            v_unmapped, left(r->>'raw', 20000), case when t is null then 'unmatched' else 'pending' end)
    on conflict (instrument_id, sample_id, measured_at) do nothing
    returning id into v_id;
    if v_id is null then continue; end if;
    n_new := n_new + 1;
    if t is null then n_unmatched := n_unmatched + 1;
    elsif ins.auto_accept and jsonb_array_length(v_unmapped) = 0 and v_vals <> '{}'::jsonb then
      perform public.lab_instrument_apply(v_id, null);
      n_auto := n_auto + 1;
    end if;
  end loop;
  return jsonb_build_object('received', n_new, 'unmatched', n_unmatched, 'auto_accepted', n_auto);
end $$;

/** Write an inbox result into the order (used by accept and by auto-accept). */
create or replace function public.lab_instrument_apply(p_result uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare x public.lab_instrument_results; ins public.lab_instruments; v jsonb;
begin
  select * into x from public.lab_instrument_results where id = p_result for update;
  select * into ins from public.lab_instruments where id = x.instrument_id;
  if x.lab_test_id is null then raise exception 'Match the result to an order first'; end if;
  if x.status = 'accepted' then raise exception 'Already accepted'; end if;
  v := coalesce(x.result_values->x.template_key, '{}'::jsonb);
  if v = '{}'::jsonb then raise exception 'No mapped values for this order''s result template (%); map the analyser codes first', coalesce(x.template_key, 'none'); end if;
  begin
    execute 'update public.lab_tests set result_json = coalesce(result_json, ''{}''::jsonb) || $2, result_template_key = coalesce(result_template_key, $3),
               status = ''Complete'', sample_status = ''Resulted'', performed_by = $4, resulted_at = coalesce($5, now()), results_ready_at = now()
             where id::text = $1'
      using x.lab_test_id, v, x.template_key, 'Analyser: ' || ins.name, x.measured_at;
  exception when undefined_column then
    execute 'update public.lab_tests set result_json = coalesce(result_json, ''{}''::jsonb) || $2, result_template_key = coalesce(result_template_key, $3),
               status = ''Complete'', resulted_at = coalesce($4, now()), results_ready_at = now() where id::text = $1'
      using x.lab_test_id, v, x.template_key, x.measured_at;
  end;
  update public.lab_instrument_results set status = 'accepted', accepted_by = p_user, accepted_at = now() where id = p_result;
end $$;

-- ================================================================= inbox actions (laboratory staff)
create or replace function public.lab_instrument_accept(p_result uuid)
returns void language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  select hospital_id into h from public.lab_instrument_results where id = p_result;
  if h is null then raise exception 'Result not found'; end if;
  if not public.clin_can_access(h) then raise exception 'Laboratory or clinical staff only'; end if;
  perform public.lab_instrument_apply(p_result, auth.uid());
end $$;

create or replace function public.lab_instrument_match(p_result uuid, p_lab_test text)
returns void language plpgsql security definer set search_path = public as $$
declare x public.lab_instrument_results; t jsonb;
begin
  select * into x from public.lab_instrument_results where id = p_result for update;
  if x.id is null then raise exception 'Result not found'; end if;
  if not public.clin_can_access(x.hospital_id) then raise exception 'Laboratory or clinical staff only'; end if;
  if x.status in ('accepted', 'rejected') then raise exception 'This result is closed'; end if;
  execute 'select to_jsonb(l) from public.lab_tests l where l.id::text = $1 and l.hospital_id::text = $2' into t using p_lab_test, x.hospital_id::text;
  if t is null then raise exception 'Order not found in this hospital'; end if;
  update public.lab_instrument_results set lab_test_id = t->>'id', patient_name = t->>'patient_name', test_type = t->>'test_type', status = 'pending',
         template_key = coalesce(t->>'result_template_key', template_key) where id = p_result;
end $$;

create or replace function public.lab_instrument_reject(p_result uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare x public.lab_instrument_results;
begin
  select * into x from public.lab_instrument_results where id = p_result for update;
  if x.id is null then raise exception 'Result not found'; end if;
  if not public.clin_can_access(x.hospital_id) then raise exception 'Laboratory or clinical staff only'; end if;
  if x.status in ('accepted', 'rejected') then raise exception 'This result is closed'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason (e.g. QC failed, clotted sample, wrong patient, repeat run)'; end if;
  update public.lab_instrument_results set status = 'rejected', reject_reason = trim(p_reason), accepted_by = auth.uid(), accepted_at = now() where id = p_result;
end $$;

-- ================================================================= security
alter table public.lab_instruments enable row level security;
alter table public.lab_instrument_maps enable row level security;
alter table public.lab_instrument_results enable row level security;
drop policy if exists lab_instruments_read on public.lab_instruments;
drop policy if exists lab_instruments_manage on public.lab_instruments;
drop policy if exists lab_instrument_maps_read on public.lab_instrument_maps;
drop policy if exists lab_instrument_maps_write on public.lab_instrument_maps;
drop policy if exists lab_instrument_results_read on public.lab_instrument_results;
create policy lab_instruments_read on public.lab_instruments for select to authenticated using (public.clin_can_access(hospital_id) or public.lab_instrument_can_manage(hospital_id));
create policy lab_instruments_manage on public.lab_instruments for update to authenticated using (public.lab_instrument_can_manage(hospital_id)) with check (public.lab_instrument_can_manage(hospital_id));
create policy lab_instrument_maps_read on public.lab_instrument_maps for select to authenticated using (hospital_id is null or public.clin_can_access(hospital_id));
create policy lab_instrument_maps_write on public.lab_instrument_maps for all to authenticated using (hospital_id is not null and public.clin_can_access(hospital_id)) with check (hospital_id is not null and public.clin_can_access(hospital_id));
create policy lab_instrument_results_read on public.lab_instrument_results for select to authenticated using (public.clin_can_access(hospital_id));
revoke all on public.lab_instruments, public.lab_instrument_maps, public.lab_instrument_results from anon;
revoke all on public.lab_instruments from authenticated;
grant select (id, hospital_id, name, model, protocol, department, auto_accept, key_prefix, active, last_seen_at, created_at, revoked_at) on public.lab_instruments to authenticated;
grant update (active, revoked_at, auto_accept) on public.lab_instruments to authenticated;
grant select, insert, update, delete on public.lab_instrument_maps to authenticated;
grant select on public.lab_instrument_results to authenticated;
grant all on public.lab_instruments, public.lab_instrument_maps, public.lab_instrument_results to service_role;

revoke execute on function public.lab_instrument_ingest(text, jsonb), public.lab_instrument_apply(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lab_instrument_ingest(text, jsonb) to service_role;
revoke execute on function public.lab_instrument_create(uuid, text, text, text, text), public.lab_instrument_accept(uuid), public.lab_instrument_match(uuid, text),
  public.lab_instrument_reject(uuid, text), public.lab_instrument_can_manage(uuid) from public, anon;
grant execute on function public.lab_instrument_create(uuid, text, text, text, text), public.lab_instrument_accept(uuid), public.lab_instrument_match(uuid, text),
  public.lab_instrument_reject(uuid, text), public.lab_instrument_can_manage(uuid) to authenticated, service_role;
