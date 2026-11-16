-- =============================================================================
-- RemedacareHMS - SERVER-ONLY FUNCTIONS: REMOVE ACCESS FOR SIGNED-IN USERS
-- Generated from supabase/migrations/20261130000000_server_only_functions.sql - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.pay_is_member(uuid)') is null then
    raise exception 'Run 02_install_payments.sql first. Nothing was changed.';
  end if;
end $$;

do $$
declare
  f text;
  fns text[] := array[
    'public.pay_user_context(uuid, uuid)', 'public.pay_access_level(uuid, uuid)',
    'public.create_online_payment(uuid, uuid, text, text, numeric, text, text, text, text, boolean)',
    'public.create_gateway_refund(uuid, uuid, numeric, text)',
    'public.sec_is_hospital_admin(uuid, uuid)', 'public.sec_is_hr(uuid, uuid)', 'public.sec_caller_email()',
    'public.sched_flag_missed(interval)', 'public.sched_confirm_by_token(text)', 'public.sched_patient_phone(text)',
    'public.ncd_recall_sweep(date)', 'public.ncd_refresh_enrolment(uuid)', 'public.hiv_refresh(uuid)', 'public.anc_refresh(uuid)',
    'public.mar_flag_missed(interval)', 'public.report_run_due()',
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

commit;

select 'server-only functions callable by signed-in users' as check_name,
      coalesce(nullif(string_agg(f, ', '), ''), 'none - OK') as result
      from unnest(array['public.pay_user_context(uuid, uuid)', 'public.pay_access_level(uuid, uuid)',
        'public.create_online_payment(uuid, uuid, text, text, numeric, text, text, text, text, boolean)', 'public.create_gateway_refund(uuid, uuid, numeric, text)',
        'public.fhir_client_by_key(text)', 'public.secret_store(uuid, text, text)', 'public.hospital_secret_get(uuid, text)', 'public.referral_share_resolve(text)',
        'public.portal_patients(text)', 'public.portal_request_code(text)', 'public.portal_verify(text, text)', 'public.portal_session_phone(text)',
        'public.portal_logout(text)', 'public.net_facilities(uuid)']) f
     where to_regprocedure(f) is not null and has_function_privilege('authenticated', f, 'execute');
