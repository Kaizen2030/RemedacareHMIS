-- =============================================================================
-- RemedacareHMS - EXECUTIVE, MATRON, PHARMACY AND CLAIMS DASHBOARDS
-- Generated from supabase/migrations/20261217000000_dashboards.sql - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.priv_is_admin(uuid)') is null then
    raise exception 'Run 11_audit_privacy.sql first. Nothing was changed.';
  end if;
end $$;

create or replace function public.dash_metric(p_sql text, p_hospital uuid, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  execute 'select to_jsonb(x) from (' || p_sql || ') x limit 1' into r using p_hospital, p_from, p_to;
  return r;
exception when others then
  return null;
end $$;

create or replace function public.dash_list(p_sql text, p_hospital uuid, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  execute 'select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from (' || p_sql || ') x' into r using p_hospital, p_from, p_to;
  return r;
exception when others then
  return null;
end $$;

create or replace function public.exec_dashboard(p_hospital uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $f$
declare h text := p_hospital::text;
begin
  if not public.priv_is_admin(p_hospital) then raise exception 'Only administrators can see the executive dashboard'; end if;
  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'visits', public.dash_metric($q$select count(*) total, count(*) filter (where lower(coalesce(to_jsonb(v)->>'visit_type', '')) ~ 'opd|out') opd
        from public.visits v where v.hospital_id::text = $1::text and v.created_at >= $2 and v.created_at < $3 + 1$q$, p_hospital, p_from, p_to),
    'admissions', public.dash_metric($q$select count(*) filter (where (to_jsonb(a)->>'admission_date')::date between $2 and $3) admitted,
        count(*) filter (where (to_jsonb(a)->>'discharge_date')::date between $2 and $3) discharged,
        round(avg(((to_jsonb(a)->>'discharge_date')::date - (to_jsonb(a)->>'admission_date')::date)) filter (where (to_jsonb(a)->>'discharge_date')::date between $2 and $3), 1) alos_days
        from public.admissions a where a.hospital_id::text = $1::text$q$, p_hospital, p_from, p_to),
    'beds', public.dash_metric($q$select count(*) total, count(*) filter (where patient_id is not null or lower(coalesce(status, '')) = 'occupied') occupied,
        count(*) filter (where lower(coalesce(status, '')) = 'cleaning') cleaning from public.beds where hospital_id::text = $1::text$q$, p_hospital),
    'emergency', public.dash_metric($q$select count(*) attendances, count(*) filter (where triage_colour in ('red', 'orange')) red_orange,
        count(*) filter (where disposition = 'lwbs') left_without_being_seen, count(*) filter (where disposition = 'admitted') admitted
        from public.ed_attendances where hospital_id = $1 and arrived_at >= $2 and arrived_at < $3 + 1$q$, p_hospital, p_from, p_to),
    'theatre', public.dash_metric($q$select count(*) filter (where status = 'completed') completed, count(*) filter (where status in ('cancelled', 'postponed')) cancelled,
        count(*) filter (where urgency = 'emergency' and status = 'completed') emergency from public.theatre_cases where hospital_id = $1 and scheduled_start >= $2 and scheduled_start < $3 + 1$q$, p_hospital, p_from, p_to),
    'maternity', public.dash_metric($q$select count(distinct d.id) deliveries, count(distinct d.id) filter (where d.mode = 'caesarean') caesareans,
        count(*) filter (where n.outcome = 'fresh_stillbirth') fresh_stillbirths, count(distinct d.id) filter (where d.maternal_outcome = 'died') maternal_deaths
        from public.deliveries d left join public.newborns n on n.delivery_id = d.id where d.hospital_id = $1 and d.delivered_at >= $2 and d.delivered_at < $3 + 1$q$, p_hospital, p_from, p_to),
    'icu', public.dash_metric($q$select count(*) admissions, count(*) filter (where outcome = 'died') deaths, count(*) filter (where discharged_at is null) in_unit
        from public.icu_admissions where hospital_id = $1 and (admitted_at >= $2 or discharged_at is null) and admitted_at < $3 + 1$q$, p_hospital, p_from, p_to),
    'deaths', public.dash_metric($q$select count(*) facility_deaths from public.mortuary_bodies where hospital_id = $1 and place_of_death in ('ward', 'emergency', 'theatre')
        and coalesce(died_at, admitted_at) >= $2 and coalesce(died_at, admitted_at) < $3 + 1$q$, p_hospital, p_from, p_to),
    'deteriorating_now', public.dash_metric($q$select count(distinct patient_id) patients from public.ward_observations
        where hospital_id = $1 and level = 'high' and observed_at > now() - interval '24 hours'$q$, p_hospital),
    'billing', public.dash_metric($q$select coalesce(sum(amount_kes), 0) billed, coalesce(sum(coalesce(amount_kes, 0) - coalesce(balance_kes, 0)), 0) settled,
        coalesce(sum(balance_kes) filter (where coalesce(status, '') not in ('Cancelled')), 0) outstanding
        from public.invoices where hospital_id::text = $1::text and created_at >= $2 and created_at < $3 + 1$q$, p_hospital, p_from, p_to),
    'collected', public.dash_metric($q$select coalesce(sum(case when kind = 'refund' then -amount else amount end), 0) total,
        coalesce(sum(amount) filter (where kind = 'payment' and method ilike '%mpesa%'), 0) mpesa, coalesce(sum(amount) filter (where kind = 'payment' and method ilike 'cash%'), 0) cash
        from public.payments where hospital_id = $1 and status = 'completed' and created_at >= $2 and created_at < $3 + 1$q$, p_hospital, p_from, p_to),
    'claims', public.dash_metric($q$select count(*) total, count(*) filter (where lower(coalesce(to_jsonb(c)->>'status', '')) like '%reject%') rejected,
        count(*) filter (where lower(coalesce(to_jsonb(c)->>'status', '')) ~ 'paid|settled') paid from public.sha_claims c where c.hospital_id::text = $1::text and c.created_at >= $2 and c.created_at < $3 + 1$q$, p_hospital, p_from, p_to),
    'lab', public.dash_metric($q$select count(*) ordered, count(*) filter (where coalesce(results_ready_at, resulted_at) is not null) resulted,
        count(*) filter (where validation_status = 'needs_review') awaiting_review from public.lab_tests where hospital_id::text = $1::text and created_at >= $2 and created_at < $3 + 1$q$, p_hospital, p_from, p_to),
    'pharmacy', public.dash_metric($q$select count(*) filter (where coalesce(quantity_in_stock, 0) <= 0) stock_outs,
        count(*) filter (where coalesce(quantity_in_stock, 0) > 0 and coalesce(quantity_in_stock, 0) <= coalesce(nullif(to_jsonb(i)->>'reorder_level', '')::numeric, 0)) below_reorder
        from public.pharmacy_inventory i where i.hospital_id::text = $1::text and coalesce((to_jsonb(i)->>'active')::boolean, true)$q$, p_hospital),
    'expiring', public.dash_metric($q$select count(*) batches_60d, coalesce(round(sum(coalesce(quantity_remaining, 0) * coalesce(nullif(to_jsonb(b)->>'unit_cost', '')::numeric, 0))), 0) value_60d
        from public.drug_batches b where b.hospital_id::text = $1::text and coalesce(quantity_remaining, 0) > 0 and expiry_date between current_date and current_date + 60$q$, p_hospital),
    'blood', public.dash_list($q$select blood_group, count(*) units from public.blood_bank_units where hospital_id = $1 and status in ('Available', 'Reserved') and expiry_at > now()
        and lower(component) in ('packed red cells', 'whole blood') group by blood_group order by blood_group$q$, p_hospital),
    'support', public.dash_metric($q$select count(*) filter (where status not in ('done', 'verified', 'cancelled')) open,
        count(*) filter (where status not in ('done', 'verified', 'cancelled') and due_at < now()) overdue from public.service_requests where hospital_id = $1$q$, p_hospital),
    'records', public.dash_metric($q$select count(*) filter (where status = 'missing') missing, count(*) filter (where status = 'out' and due_back < now()) overdue from public.record_files where hospital_id = $1$q$, p_hospital),
    'controlled_drugs', public.dash_metric($q$select count(*) unwitnessed_over_4h from public.cd_register where hospital_id = $1 and witness_by is null and created_at < now() - interval '4 hours'$q$, p_hospital)
  );
end $f$;

create or replace function public.matron_dashboard(p_hospital uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $f$
begin
  if not public.clin_can_access(p_hospital) then raise exception 'Only clinical staff can see the nursing dashboard'; end if;
  return jsonb_build_object(
    'wards', public.dash_list($q$select coalesce(w.name, 'No ward') ward, count(b.*) beds,
        count(b.*) filter (where b.patient_id is not null or lower(coalesce(b.status, '')) = 'occupied') occupied,
        count(b.*) filter (where lower(coalesce(b.status, '')) = 'cleaning') cleaning
        from public.beds b left join public.wards w on w.id::text = b.ward_id::text where b.hospital_id::text = $1::text group by w.name order by w.name$q$, p_hospital),
    'observations', public.dash_metric($q$with latest as (select distinct on (patient_id) * from public.ward_observations where hospital_id = $1 and observed_at > now() - interval '48 hours' order by patient_id, observed_at desc)
        select count(*) filter (where level = 'high') high, count(*) filter (where level in ('medium', 'low_medium')) medium,
               count(*) filter (where next_due_at < now()) overdue, count(*) filter (where level in ('high', 'medium') and escalated_to is null) not_escalated from latest$q$, p_hospital),
    'deteriorating', public.dash_list($q$with latest as (select distinct on (o.patient_id) o.* from public.ward_observations o where o.hospital_id = $1 and o.observed_at > now() - interval '48 hours' order by o.patient_id, o.observed_at desc)
        select p.full_name patient, l.bed_id bed, l.scale, l.score, l.level, l.observed_at, l.escalated_to from latest l left join public.patients p on p.id = l.patient_id
         where l.level in ('high', 'medium') order by l.score desc limit 30$q$, p_hospital),
    'risks', public.dash_metric($q$with latest as (select distinct on (patient_id, kind) * from public.ward_risk_assessments where hospital_id = $1 and assessed_at > now() - interval '14 days' order by patient_id, kind, assessed_at desc)
        select count(*) filter (where kind = 'morse' and risk = 'high') falls_high, count(*) filter (where kind = 'braden' and risk in ('high', 'very high')) pressure_high from latest$q$, p_hospital),
    'care_plans', public.dash_metric($q$select count(*) filter (where status = 'active') active, count(*) filter (where status = 'active' and review_by < current_date) review_overdue
        from public.ward_care_plans where hospital_id = $1$q$, p_hospital),
    'meds_due', public.dash_metric($q$select count(*) overdue from public.mar_doses where hospital_id::text = $1::text and lower(coalesce(to_jsonb(mar_doses)->>'status', '')) in ('due', 'scheduled', 'pending')
        and coalesce(nullif(to_jsonb(mar_doses)->>'due_at', '')::timestamptz, nullif(to_jsonb(mar_doses)->>'scheduled_at', '')::timestamptz) < now() - interval '1 hour'$q$, p_hospital)
  );
end $f$;

create or replace function public.pharmacy_dashboard(p_hospital uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $f$
begin
  if not (public.clin_can_access(p_hospital)) then raise exception 'Only pharmacy and clinical staff can see the pharmacy dashboard'; end if;
  return jsonb_build_object(
    'stock', public.dash_metric($q$select count(*) items, count(*) filter (where coalesce(quantity_in_stock, 0) <= 0) stock_outs,
        count(*) filter (where coalesce(quantity_in_stock, 0) > 0 and coalesce(quantity_in_stock, 0) <= coalesce(nullif(to_jsonb(i)->>'reorder_level', '')::numeric, 0)) below_reorder
        from public.pharmacy_inventory i where i.hospital_id::text = $1::text and coalesce((to_jsonb(i)->>'active')::boolean, true)$q$, p_hospital),
    'stock_outs', public.dash_list($q$select drug_name, coalesce(quantity_in_stock, 0) quantity, nullif(to_jsonb(i)->>'reorder_level', '')::numeric reorder_level
        from public.pharmacy_inventory i where i.hospital_id::text = $1::text and coalesce((to_jsonb(i)->>'active')::boolean, true)
         and coalesce(quantity_in_stock, 0) <= coalesce(nullif(to_jsonb(i)->>'reorder_level', '')::numeric, 0) order by coalesce(quantity_in_stock, 0), drug_name limit 30$q$, p_hospital),
    'expiry', public.dash_metric($q$select count(*) filter (where expiry_date < current_date and coalesce(quantity_remaining, 0) > 0 and lower(coalesce(status, '')) <> 'written off') expired_on_shelf,
        count(*) filter (where expiry_date between current_date and current_date + 30) d30, count(*) filter (where expiry_date between current_date + 31 and current_date + 90) d90,
        coalesce(round(sum(coalesce(quantity_remaining, 0) * coalesce(nullif(to_jsonb(b)->>'unit_cost', '')::numeric, 0)) filter (where expiry_date between current_date and current_date + 90)), 0) value_90d
        from public.drug_batches b where b.hospital_id::text = $1::text and coalesce(quantity_remaining, 0) > 0$q$, p_hospital),
    'expiring', public.dash_list($q$select drug_name, batch_number, expiry_date, quantity_remaining from public.drug_batches
        where hospital_id::text = $1::text and coalesce(quantity_remaining, 0) > 0 and expiry_date <= current_date + 60 and lower(coalesce(status, '')) <> 'written off' order by expiry_date limit 30$q$, p_hospital),
    'prescriptions', public.dash_metric($q$select count(*) filter (where status = 'Pending') pending, count(*) filter (where status = 'Approved') approved,
        count(*) filter (where status = 'Released' and nullif(to_jsonb(p)->>'dispensed_at', '')::date = current_date) dispensed_today from public.prescriptions p where p.hospital_id::text = $1::text$q$, p_hospital),
    'controlled', public.dash_metric($q$select count(*) filter (where witness_by is null) unwitnessed, count(*) filter (where witness_by is null and created_at < now() - interval '4 hours') unwitnessed_over_4h,
        count(*) filter (where entry_type = 'balance_check' and discrepancy <> 0 and created_at > now() - interval '30 days') discrepancies_30d from public.cd_register where hospital_id = $1$q$, p_hospital),
    'topups', public.dash_metric($q$select count(*) filter (where status = 'requested') waiting_issue, count(*) filter (where status = 'issued') waiting_receipt from public.ward_topup_requests where hospital_id = $1$q$, p_hospital)
  );
end $f$;

create or replace function public.claims_dashboard(p_hospital uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $f$
begin
  if not public.priv_is_admin(p_hospital) and not coalesce((select c.member and c.staff_active and (c.canonical = 'accountant' or lower(coalesce(c.raw_role, '')) ~ '(claim|insurance)')
                                                            from public.pay_user_context(p_hospital, auth.uid()) c), false) then
    raise exception 'Only administrators, finance and claims staff can see the claims dashboard';
  end if;
  return jsonb_build_object(
    'by_payer', public.dash_list($q$select coalesce(nullif(to_jsonb(i)->>'insurer', ''), case when coalesce(i.payment_method, '') ~* 'sha|nhif' then 'SHA' else 'Self-pay' end) payer,
        count(*) invoices, coalesce(sum(amount_kes), 0) billed, coalesce(sum(balance_kes) filter (where coalesce(status, '') not in ('Cancelled')), 0) outstanding
        from public.invoices i where i.hospital_id::text = $1::text and i.created_at >= $2 and i.created_at < $3 + 1 group by 1 order by billed desc$q$, p_hospital, p_from, p_to),
    'aging', public.dash_metric($q$select coalesce(sum(balance_kes) filter (where now() - created_at <= interval '30 days'), 0) d0_30,
        coalesce(sum(balance_kes) filter (where now() - created_at > interval '30 days' and now() - created_at <= interval '60 days'), 0) d31_60,
        coalesce(sum(balance_kes) filter (where now() - created_at > interval '60 days' and now() - created_at <= interval '90 days'), 0) d61_90,
        coalesce(sum(balance_kes) filter (where now() - created_at > interval '90 days'), 0) d90_plus
        from public.invoices i where i.hospital_id::text = $1::text and coalesce(balance_kes, 0) > 0 and coalesce(status, '') not in ('Cancelled', 'Paid')
         and (coalesce(to_jsonb(i)->>'insurer', '') <> '' or coalesce(i.payment_method, '') ~* 'sha|nhif|insur')$q$, p_hospital),
    'sha_claims', public.dash_list($q$select coalesce(nullif(to_jsonb(c)->>'status', ''), 'unknown') status, count(*) claims,
        coalesce(sum(nullif(coalesce(to_jsonb(c)->>'amount_kes', to_jsonb(c)->>'claim_amount', to_jsonb(c)->>'total_kes'), '')::numeric), 0) amount
        from public.sha_claims c where c.hospital_id::text = $1::text and c.created_at >= $2 and c.created_at < $3 + 1 group by 1 order by claims desc$q$, p_hospital, p_from, p_to),
    'rejections', public.dash_list($q$select coalesce(nullif(coalesce(to_jsonb(c)->>'rejection_reason', to_jsonb(c)->>'response_message', to_jsonb(c)->>'notes'), ''), 'No reason recorded') reason, count(*) claims
        from public.sha_claims c where c.hospital_id::text = $1::text and lower(coalesce(to_jsonb(c)->>'status', '')) like '%reject%'
         and c.created_at >= $2 and c.created_at < $3 + 1 group by 1 order by claims desc limit 10$q$, p_hospital, p_from, p_to)
  );
end $f$;

revoke execute on function public.dash_metric(text, uuid, date, date), public.dash_list(text, uuid, date, date) from public, anon, authenticated;
revoke execute on function public.exec_dashboard(uuid, date, date), public.matron_dashboard(uuid), public.pharmacy_dashboard(uuid), public.claims_dashboard(uuid, date, date) from public, anon;
grant execute on function public.exec_dashboard(uuid, date, date), public.matron_dashboard(uuid), public.pharmacy_dashboard(uuid), public.claims_dashboard(uuid, date, date) to authenticated, service_role;

commit;

select 'dashboard functions' as check_name, case when to_regprocedure('public.exec_dashboard(uuid,date,date)') is not null and to_regprocedure('public.matron_dashboard(uuid)') is not null and not has_function_privilege('authenticated', 'public.dash_metric(text,uuid,date,date)', 'execute') then 'OK' else 'PROBLEM' end as result;
