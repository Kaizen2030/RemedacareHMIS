-- =============================================================================
-- RemedacareHMS - DEPARTMENT REFERRAL INBOX / OUTBOX (REFERRING DEPARTMENT, DECLINE REASON)
-- Generated from supabase/migrations/20261231000000_department_referrals.sql - do not edit by hand.
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
  if to_regclass('public.referrals') is null then raise exception 'The referrals table is missing (base RemedacareHMS schema). Nothing was changed.'; end if;
end $$;

alter table public.referrals add column if not exists referring_department text;
alter table public.referrals add column if not exists declined_reason text;
alter table public.referrals add column if not exists declined_at timestamptz;

create index if not exists referrals_receiving_department on public.referrals(hospital_id, receiving_department, status);
create index if not exists referrals_referring_department on public.referrals(hospital_id, referring_department, created_at desc);

commit;

select 'department referral columns' as check_name, case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'referrals' and column_name in ('referring_department', 'declined_reason', 'declined_at')) = 3 then 'OK' else 'PROBLEM' end as result;
