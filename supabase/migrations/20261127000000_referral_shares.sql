-- Referral letter links. The QR code on a printed referral letter opens one visit summary at the receiving
-- facility without a RemedacareHMS account. The link carries a random token (only its hash is stored), opens only
-- that visit, expires (default 30 days), allows at most 100 openings, can be revoked, and every opening is logged.

create table if not exists public.referral_shares (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null,
  referral_id  text not null,
  visit_id     text not null,
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  max_uses     integer not null default 100,
  use_count    integer not null default 0,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists referral_shares_referral on public.referral_shares(hospital_id, referral_id);

-- Clinical staff create a link for one referral; returns the token once.
create or replace function public.referral_share_create(p_referral text, p_days integer default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_token text; v_id uuid; v_exp timestamptz;
begin
  execute 'select ref_try_uuid(hospital_id::text) as hospital_id, visit_id::text as visit_id from public.referrals where id::text = $1'
    into r using p_referral;
  if r.hospital_id is null then raise exception 'Referral not found'; end if;
  if not public.clin_can_access(r.hospital_id) then raise exception 'Only clinical staff can share referral records'; end if;
  if r.visit_id is null then raise exception 'Link the referral to a visit first'; end if;
  v_token := 'rcs_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_exp := now() + make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90));
  insert into public.referral_shares(hospital_id, referral_id, visit_id, token_hash, expires_at)
  values (r.hospital_id, p_referral, r.visit_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_exp)
  returning id into v_id;
  perform public.payments_audit(r.hospital_id, 'insert:referral_shares', v_id, jsonb_build_object('referral_id', p_referral, 'expires_at', v_exp));
  return jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_exp);
end $$;

-- Server only: the share for a token (counts the opening). Nothing for unknown, expired, revoked or used-up links.
create or replace function public.referral_share_resolve(p_token text)
returns table (id uuid, hospital_id uuid, referral_id text, visit_id text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.referral_shares s set use_count = s.use_count + 1, last_used_at = now()
   where s.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
     and s.revoked_at is null and s.expires_at > now() and s.use_count < s.max_uses
  returning s.id, s.hospital_id, s.referral_id, s.visit_id, s.expires_at;
end $$;

alter table public.referral_shares enable row level security;
drop policy if exists referral_shares_clinical_read on public.referral_shares;
drop policy if exists referral_shares_clinical_revoke on public.referral_shares;
create policy referral_shares_clinical_read on public.referral_shares for select to authenticated using (public.clin_can_access(hospital_id));
create policy referral_shares_clinical_revoke on public.referral_shares for update to authenticated
  using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
revoke all on public.referral_shares from anon, authenticated;
grant select (id, hospital_id, referral_id, visit_id, expires_at, max_uses, use_count, last_used_at, revoked_at, created_by, created_at) on public.referral_shares to authenticated;
grant update (revoked_at) on public.referral_shares to authenticated;
grant all on public.referral_shares to service_role;

revoke execute on function public.referral_share_create(text, integer), public.referral_share_resolve(text) from public, anon;
grant execute on function public.referral_share_create(text, integer) to authenticated, service_role;
grant execute on function public.referral_share_resolve(text) to service_role;
