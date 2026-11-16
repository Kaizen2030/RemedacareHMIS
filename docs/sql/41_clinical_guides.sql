-- =============================================================================
-- RemedacareHMS - CLINICAL GUIDES: HOSPITAL APPROVAL (CLINICAL LEAD / MTC SIGN-OFF)
-- Generated from supabase/migrations/20261223000000_clinical_guides.sql - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.clin_can_access(uuid)') is null then
    raise exception 'Run 08_hiv_tb_maternity.sql first. Nothing was changed.';
  end if;
end $$;

create table if not exists public.clinical_guide_approvals (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid not null,
  guide_id       text not null,
  version        text not null,
  approver_name  text not null,
  approver_role  text,
  committee_ref  text,
  note           text,
  approved_by    uuid default auth.uid(),
  approved_at    timestamptz not null default now(),
  withdrawn_at   timestamptz,
  withdrawn_by   uuid,
  withdraw_reason text
);
create unique index if not exists clinical_guide_approvals_active on public.clinical_guide_approvals(hospital_id, guide_id, version) where withdrawn_at is null;

/** Administrators, consultants, medical directors / superintendents, clinical leads, heads of department and pharmacists. */
create or replace function public.guide_can_approve(p_hospital uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select c.member and c.staff_active and (c.canonical = 'admin'
            or lower(coalesce(c.raw_role, '')) ~ '(consultant|medical director|medical superintendent|clinical lead|head of|\yhod\y|pharmac|chief)')
          from public.pay_user_context(p_hospital, auth.uid()) c), false)
$$;

create or replace function public.clinical_guide_approvals_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public.guide_can_approve(new.hospital_id) then raise exception 'Only a consultant, clinical lead, head of department, pharmacist or administrator can approve clinical guides'; end if;
    if coalesce(trim(new.approver_name), '') = '' then raise exception 'Enter the approver''s name'; end if;
    new.approved_by := auth.uid(); new.approved_at := now(); new.withdrawn_at := null; new.withdrawn_by := null; new.withdraw_reason := null;
  else
    if old.withdrawn_at is not null then raise exception 'This approval was already withdrawn'; end if;
    if (to_jsonb(new) - array['withdrawn_at', 'withdrawn_by', 'withdraw_reason']) is distinct from (to_jsonb(old) - array['withdrawn_at', 'withdrawn_by', 'withdraw_reason']) then
      raise exception 'Approvals cannot be edited; withdraw and approve again';
    end if;
    if new.withdrawn_at is not null then
      if not public.guide_can_approve(new.hospital_id) then raise exception 'Only an approver can withdraw an approval'; end if;
      if coalesce(trim(new.withdraw_reason), '') = '' then raise exception 'Give the reason for withdrawing'; end if;
      new.withdrawn_by := auth.uid(); new.withdrawn_at := now();
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_clinical_guide_approvals_before on public.clinical_guide_approvals;
create trigger trg_clinical_guide_approvals_before before insert or update on public.clinical_guide_approvals for each row execute function public.clinical_guide_approvals_before();

alter table public.clinical_guide_approvals enable row level security;
drop policy if exists clinical_guide_approvals_read on public.clinical_guide_approvals;
drop policy if exists clinical_guide_approvals_write on public.clinical_guide_approvals;
create policy clinical_guide_approvals_read on public.clinical_guide_approvals for select to authenticated using (public.pay_is_member(hospital_id));
create policy clinical_guide_approvals_write on public.clinical_guide_approvals for all to authenticated using (public.guide_can_approve(hospital_id)) with check (public.guide_can_approve(hospital_id));
revoke all on public.clinical_guide_approvals from anon;
grant select, insert, update on public.clinical_guide_approvals to authenticated;
grant all on public.clinical_guide_approvals to service_role;
revoke execute on function public.clinical_guide_approvals_before() from public, anon, authenticated;
revoke execute on function public.guide_can_approve(uuid) from public, anon;
grant execute on function public.guide_can_approve(uuid) to authenticated, service_role;

commit;

select 'guide approvals' as check_name, case when to_regclass('public.clinical_guide_approvals') is not null and exists (select 1 from pg_trigger where tgname = 'trg_clinical_guide_approvals_before') then 'OK' else 'PROBLEM' end as result;
