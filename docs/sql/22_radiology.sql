-- =============================================================================
-- RemedacareHMS - RADIOLOGY: WORKLISTS, SCHEDULING, STRUCTURED REPORTS, CRITICAL RESULTS, DOSE AND CONTRAST
-- Generated from supabase/migrations/20261204000000_radiology.sql - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.clin_can_access(uuid)') is null then
    raise exception 'Run 08_hiv_tb_maternity.sql first. Nothing was changed.';
  end if;
end $$;

do $$ begin
  if to_regclass('public.radiology_orders') is null then
    raise exception 'radiology_orders table not found: Radiology needs it (created with the original RemedacareHMS schema).';
  end if;
end $$;

create sequence if not exists public.radiology_accession_seq;

alter table public.radiology_orders add column if not exists accession_number text;
alter table public.radiology_orders add column if not exists room text;
alter table public.radiology_orders add column if not exists scheduled_at timestamptz;
alter table public.radiology_orders add column if not exists duration_min integer;
alter table public.radiology_orders add column if not exists performed_at timestamptz;
alter table public.radiology_orders add column if not exists performed_by text;
alter table public.radiology_orders add column if not exists pregnancy_check text;
alter table public.radiology_orders add column if not exists contrast jsonb;
alter table public.radiology_orders add column if not exists dose jsonb;
alter table public.radiology_orders add column if not exists template text;
alter table public.radiology_orders add column if not exists structured jsonb;
alter table public.radiology_orders add column if not exists reported_at timestamptz;
alter table public.radiology_orders add column if not exists reported_by uuid;
alter table public.radiology_orders add column if not exists reporter_name text;
alter table public.radiology_orders add column if not exists verified_at timestamptz;
alter table public.radiology_orders add column if not exists verified_by uuid;
alter table public.radiology_orders add column if not exists critical boolean not null default false;
alter table public.radiology_orders add column if not exists critical_finding text;
alter table public.radiology_orders add column if not exists critical_notified_at timestamptz;
alter table public.radiology_orders add column if not exists critical_ack_at timestamptz;
alter table public.radiology_orders add column if not exists critical_ack_by uuid;
alter table public.radiology_orders add column if not exists critical_ack_name text;
alter table public.radiology_orders add column if not exists cancel_reason text;
create index if not exists radiology_orders_worklist on public.radiology_orders(hospital_id, status, scheduled_at);
create unique index if not exists radiology_orders_accession on public.radiology_orders(accession_number) where accession_number is not null;

do $$ begin
  alter table public.radiology_orders add constraint radiology_pregnancy_check check (pregnancy_check is null or pregnancy_check in ('not_pregnant', 'pregnant_justified', 'unknown_justified', 'na'));
exception when duplicate_object then null;
end $$;

create or replace function public.rad_is_ionising(p_modality text)
returns boolean language sql immutable as $$
  select coalesce(p_modality, '') ~* '(x-?ray|radiograph|\yct\y|computed|fluoro|mammo|dexa|interventional|angio)'   -- \y = word boundary in PostgreSQL
$$;

create or replace function public.radiology_orders_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new); o jsonb; v_status text := coalesce(new.status, 'Requested'); v_clash text; v_dur int;
begin
  o := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  if new.accession_number is null then
    new.accession_number := 'RAD' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('public.radiology_accession_seq')::text, 5, '0');
  end if;

  if tg_op = 'UPDATE' and coalesce(old.status, '') = 'Verified' then
    if (j - array['critical_ack_at', 'critical_ack_by', 'critical_ack_name', 'updated_at']) is distinct from (o - array['critical_ack_at', 'critical_ack_by', 'critical_ack_name', 'updated_at']) then
      raise exception 'This report is verified and locked; ask the radiologist for an addendum order';
    end if;
  end if;

  if new.scheduled_at is not null and new.room is not null and v_status not in ('Cancelled', 'Reported', 'Verified') then
    v_dur := coalesce(new.duration_min, 20);
    execute 'select coalesce(modality, ''exam'') from public.radiology_orders r
              where r.id <> $1 and r.room = $2 and r.scheduled_at is not null and coalesce(r.status, ''Requested'') not in (''Cancelled'', ''Reported'', ''Verified'')
                and tstzrange(r.scheduled_at, r.scheduled_at + make_interval(mins => coalesce(r.duration_min, 20))) && tstzrange($3, $3 + make_interval(mins => $4))
                and r.hospital_id::text = $5 limit 1'
      into v_clash using new.id, new.room, new.scheduled_at, v_dur, new.hospital_id::text;
    if v_clash is not null then raise exception '% is already booked in that room at that time (%)', new.room, v_clash; end if;
  end if;

  if v_status in ('In Progress', 'Reported', 'Verified') and v_status is distinct from coalesce(o->>'status', '')
     and coalesce(o->>'status', '') not in ('In Progress', 'Reported', 'Verified')
     and public.rad_is_ionising(new.modality) and new.pregnancy_check is null then
    raise exception 'Record the pregnancy check before an X-ray / CT / fluoroscopy examination (choose "not applicable" for men and children)';
  end if;
  if v_status = 'In Progress' and coalesce(o->>'status', '') <> 'In Progress' then new.performed_at := coalesce(new.performed_at, now()); end if;

  if v_status in ('Reported', 'Verified') and v_status is distinct from coalesce(o->>'status', '') then
    if coalesce(trim(j->>'report_text'), '') = '' and coalesce(trim(j->>'impression'), '') = '' then
      raise exception 'Write the findings or impression before reporting';
    end if;
    new.performed_at := coalesce(new.performed_at, now());
    if coalesce(o->>'status', '') not in ('Reported', 'Verified') then
      new.reported_at := now(); new.reported_by := auth.uid();
    end if;
  end if;
  if v_status = 'Verified' and coalesce(o->>'status', '') <> 'Verified' then
    if new.reported_at is null then raise exception 'Report the examination before verifying'; end if;
    new.verified_at := now(); new.verified_by := auth.uid();
  end if;

  if new.critical then
    if coalesce(trim(new.critical_finding), '') = '' then raise exception 'Describe the critical finding'; end if;
    if v_status in ('Reported', 'Verified') and new.critical_notified_at is null then new.critical_notified_at := now(); end if;
  end if;
  if new.critical_ack_at is not null and (tg_op = 'INSERT' or old.critical_ack_at is null) then new.critical_ack_by := auth.uid(); end if;
  if v_status = 'Cancelled' and coalesce(trim(new.cancel_reason), '') = '' then raise exception 'Give the reason for cancelling'; end if;
  return new;
end $$;

create or replace function public.radiology_orders_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.critical and new.critical_notified_at is not null and (tg_op = 'INSERT' or old.critical_notified_at is null) then
    begin
      execute 'insert into public.notifications(hospital_id, notification_type, title, message, target_path, payload_json)
               values ($1, ''alert'', ''Critical imaging result'', $2, ''/radiology'', $3)'
        using new.hospital_id, concat_ws(' — ', new.modality, new.body_region, new.critical_finding, 'for ' || coalesce(new.requesting_doctor, 'the requesting clinician')),
              jsonb_build_object('radiology_order_id', new.id, 'patient_id', new.patient_id, 'visit_id', new.visit_id);
    exception when others then
      begin
        execute 'insert into public.notifications(hospital_id, title, message) values ($1, ''Critical imaging result'', $2)'
          using new.hospital_id, concat_ws(' — ', new.modality, new.critical_finding);
      exception when others then raise warning 'critical result notification skipped: %', sqlerrm;
      end;
    end;
  end if;
  return null;
end $$;

drop trigger if exists trg_radiology_orders_before on public.radiology_orders;
create trigger trg_radiology_orders_before before insert or update on public.radiology_orders for each row execute function public.radiology_orders_before();
drop trigger if exists trg_radiology_orders_after on public.radiology_orders;
create trigger trg_radiology_orders_after after insert or update on public.radiology_orders for each row execute function public.radiology_orders_after();

create or replace function public.radiology_stats(p_hospital uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.clin_can_access(p_hospital) then raise exception 'Only clinical staff can see radiology statistics'; end if;
  with o as (
    select * from public.radiology_orders
     where public.ref_try_uuid(hospital_id::text) = p_hospital and created_at >= p_from and created_at < p_to + 1
  )
  select jsonb_build_object(
    'orders', (select count(*) from o),
    'by_modality', (select coalesce(jsonb_object_agg(coalesce(modality, 'Other'), jsonb_build_object(
        'orders', n, 'order_to_exam_h', a, 'exam_to_report_h', b)), '{}'::jsonb) from (
        select modality, count(*) n,
               round((percentile_cont(0.5) within group (order by extract(epoch from performed_at - created_at) / 3600))::numeric, 1) a,
               round((percentile_cont(0.5) within group (order by extract(epoch from reported_at - performed_at) / 3600))::numeric, 1) b
          from o group by modality) x),
    'unreported', (select count(*) from o where coalesce(status, 'Requested') not in ('Reported', 'Verified', 'Cancelled')),
    'critical', (select count(*) from o where critical),
    'critical_unacknowledged', (select count(*) from o where critical and critical_ack_at is null),
    'critical_ack_median_min', (select round((percentile_cont(0.5) within group (order by extract(epoch from critical_ack_at - critical_notified_at) / 60))::numeric, 0) from o where critical and critical_ack_at is not null),
    'contrast_reactions', (select count(*) from o where coalesce(contrast->>'reaction', 'none') not in ('none', '')),
    'ct_dlp_median', (select percentile_cont(0.5) within group (order by (dose->>'dlp')::numeric) from o where (dose->>'dlp') ~ '^[0-9.]+$'),
    'cancelled', (select count(*) from o where status = 'Cancelled')
  ) into r;
  return r;
end $$;

create or replace function public.radiology_patient_dose(p_patient uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ct_exams', count(*) filter (where (dose->>'dlp') ~ '^[0-9.]+$'),
                            'dlp_total', coalesce(sum((dose->>'dlp')::numeric) filter (where (dose->>'dlp') ~ '^[0-9.]+$'), 0),
                            'ionising_exams', count(*) filter (where public.rad_is_ionising(modality)))
    from public.radiology_orders
   where patient_id::text = p_patient::text and created_at > now() - interval '12 months'
     and public.clin_can_access(public.ref_try_uuid(hospital_id::text))
$$;

revoke execute on function public.radiology_orders_before(), public.radiology_orders_after() from public, anon, authenticated;
revoke execute on function public.radiology_stats(uuid, date, date), public.radiology_patient_dose(uuid) from public, anon;
grant execute on function public.radiology_stats(uuid, date, date), public.radiology_patient_dose(uuid) to authenticated, service_role;
grant usage on sequence public.radiology_accession_seq to authenticated, service_role;

do $$ begin
  if to_regprocedure('public.audit_row_change()') is not null then
    execute 'drop trigger if exists trg_audit_change on public.radiology_orders';
    execute 'create trigger trg_audit_change after insert or update or delete on public.radiology_orders for each row execute function public.audit_row_change()';
  end if;
end $$;

commit;

select 'radiology extended' as check_name, case when exists (select 1 from information_schema.columns where table_name = 'radiology_orders' and column_name = 'critical_ack_at') and exists (select 1 from pg_trigger where tgname = 'trg_radiology_orders_before') then 'OK' else 'PROBLEM' end as result
    union all select 'accession numbers given to existing orders', (select count(*) || ' orders without one' from public.radiology_orders where accession_number is null);
