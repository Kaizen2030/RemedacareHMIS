-- Server-only functions must not be callable by logged-in users.
-- Supabase grants EXECUTE on every new function to anon, authenticated and service_role by default. Several earlier
-- migrations revoked it from public/anon but not from authenticated, so any signed-in account could call functions
-- meant only for the edge functions — e.g. portal_request_code (get a sign-in code for any phone), create_gateway_refund
-- and create_online_payment (they trust a p_user argument), referral_share_resolve, fhir_client_by_key.
-- The edge functions use the service role, which keeps access. Nothing the browser uses is affected.

do $$
declare
  f text;
  fns text[] := array[
    -- payments: called by the payments-* edge functions with the caller's verified id
    'public.pay_user_context(uuid, uuid)', 'public.pay_access_level(uuid, uuid)',
    'public.create_online_payment(uuid, uuid, text, text, numeric, text, text, text, text, boolean)',
    'public.create_gateway_refund(uuid, uuid, numeric, text)',
    -- roles / scheduling / registers / reports (already revoked in their own migrations; repeated so this list is complete)
    'public.sec_is_hospital_admin(uuid, uuid)', 'public.sec_is_hr(uuid, uuid)', 'public.sec_caller_email()',
    'public.sched_flag_missed(interval)', 'public.sched_confirm_by_token(text)', 'public.sched_patient_phone(text)',
    'public.ncd_recall_sweep(date)', 'public.ncd_refresh_enrolment(uuid)', 'public.hiv_refresh(uuid)', 'public.anc_refresh(uuid)',
    'public.mar_flag_missed(interval)', 'public.report_run_due()',
    -- FHIR, secrets, referral links, portal, networks
    'public.fhir_client_by_key(text)', 'public.secret_store(uuid, text, text)', 'public.hospital_secret_get(uuid, text)',
    'public.referral_share_resolve(text)',
    'public.portal_patients(text)', 'public.portal_request_code(text)', 'public.portal_verify(text, text)',
    'public.portal_session_phone(text)', 'public.portal_logout(text)', 'public.net_facilities(uuid)'
  ];
begin
  foreach f in array fns loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', f);
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;
