-- Department-to-department referrals. A referral made from a department's Review patient panel is now a real
-- referrals row (internal: receiving facility = this hospital), so the receiving department sees it in its inbox and can
-- accept or decline it, and the referring department can follow it in its outbox.
--   referring_department  department that made the referral (proper name, see department_canonical)
--   declined_reason       why the receiving department declined (the visit goes back to the referring department)

do $$ begin
  if to_regclass('public.referrals') is null then raise exception 'The referrals table is missing (base RemedacareHMS schema). Nothing was changed.'; end if;
end $$;

alter table public.referrals add column if not exists referring_department text;
alter table public.referrals add column if not exists declined_reason text;
alter table public.referrals add column if not exists declined_at timestamptz;

create index if not exists referrals_receiving_department on public.referrals(hospital_id, receiving_department, status);
create index if not exists referrals_referring_department on public.referrals(hospital_id, referring_department, created_at desc);
