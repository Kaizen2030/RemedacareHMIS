-- =============================================================================
-- RemedacareHMS - SECURITY FIX: stop users making themselves admin or joining other hospitals
-- Generated from supabase/migrations/20261115000000_harden_roles.sql - do not edit by hand.
-- Run AFTER 02_install_payments.sql. Paste the whole file into SQL Editor, Run, choose
-- "Run without RLS" if asked. One transaction: if anything fails, nothing changes.
-- The last result lists everyone who has admin rights. Check you recognise every name.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.pay_canonical_role(text)') is null then
    raise exception 'Run 02_install_payments.sql first. Nothing was changed.';
  end if;
end $$;

create or replace function public.sec_caller_email()
returns text language sql stable security definer set search_path = public as $$
  select lower(email) from auth.users where id = auth.uid()
$$;

create or replace function public.sec_is_hospital_admin(p_hospital uuid, p_user uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_email text; v_network text;
begin
  if p_hospital is null or p_user is null then return false; end if;
  select lower(email) into v_email from auth.users where id = p_user;
  if exists (select 1 from public.hospitals h where h.id = p_hospital
              and v_email is not null and lower(h.owner_email) = v_email) then
    return true;
  end if;
  if exists (select 1 from public.hospital_users hu
              where hu.hospital_id = p_hospital and hu.user_id = p_user
                and lower(coalesce(hu.role, '')) = 'admin'
                and coalesce((to_jsonb(hu)->>'active')::boolean, true)) then
    return true;
  end if;
  select to_jsonb(h)->>'network_id' into v_network from public.hospitals h where h.id = p_hospital;
  if v_network is not null and exists (
       select 1 from public.hospital_users hu join public.hospitals hx on hx.id = hu.hospital_id
        where hu.user_id = p_user and lower(coalesce(hu.role, '')) = 'admin'
          and coalesce((to_jsonb(hu)->>'active')::boolean, true)
          and to_jsonb(hx)->>'network_id' = v_network) then
    return true;
  end if;
  return false;
end $$;

create or replace function public.sec_is_hr(p_hospital uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff s join auth.users u on lower(u.email) = lower(s.email)
     where u.id = p_user and s.hospital_id = p_hospital
       and lower(coalesce(s.status, 'active')) not in ('suspended','terminated','rejected','pending approval','inactive','deceased')
       and (lower(trim(s.role)) in ('hr', 'hr manager', 'hr officer') or lower(s.role) like '%human resource%'))
$$;

create or replace function public.sec_guard_hospital_users()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_staff_role text; v_staff_status text;
begin
  if v_uid is null then return coalesce(new, old); end if;

  if tg_op = 'DELETE' then
    if old.user_id = v_uid or public.sec_is_hospital_admin(old.hospital_id, v_uid) then return old; end if;
    raise exception 'Only an administrator can remove another user from a hospital';
  end if;

  if tg_op = 'UPDATE' and new.hospital_id is distinct from old.hospital_id
     and not public.sec_is_hospital_admin(old.hospital_id, v_uid) then
    raise exception 'Only an administrator can move a user to another hospital';
  end if;
  if public.sec_is_hospital_admin(new.hospital_id, v_uid) then return new; end if;

  if new.user_id is distinct from v_uid then
    raise exception 'Only an administrator can add or change another user''s hospital access';
  end if;
  if tg_op = 'UPDATE' and (new.user_id is distinct from old.user_id or new.hospital_id is distinct from old.hospital_id
                           or (to_jsonb(new)->'active') is distinct from (to_jsonb(old)->'active')) then
    raise exception 'Only an administrator can change hospital access';
  end if;

  if tg_op = 'INSERT' or new.role is distinct from old.role then
    select s.role, s.status into v_staff_role, v_staff_status from public.staff s
     where s.hospital_id = new.hospital_id and lower(s.email) = public.sec_caller_email()
     order by (lower(coalesce(s.status, 'active')) = 'active') desc limit 1;
    if tg_op = 'INSERT' and (v_staff_role is null
         or lower(coalesce(v_staff_status, 'active')) in ('suspended','terminated','rejected','deceased')) then
      raise exception 'You have not been added to this hospital. Ask its administrator to invite you.';
    end if;
    if lower(coalesce(new.role, '')) not in ('staff', lower(coalesce(v_staff_role, ''))) then
      raise exception 'Your role is set by an administrator';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_sec_guard_hospital_users on public.hospital_users;
create trigger trg_sec_guard_hospital_users
  before insert or update or delete on public.hospital_users
  for each row execute function public.sec_guard_hospital_users();

create or replace function public.sec_guard_staff()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_hosp uuid; v_hr boolean; v_me text; v_own boolean;
begin
  if v_uid is null then return coalesce(new, old); end if;
  v_hosp := coalesce(new.hospital_id, old.hospital_id);

  if tg_op = 'UPDATE' and new.hospital_id is distinct from old.hospital_id then
    if public.sec_is_hospital_admin(old.hospital_id, v_uid) and public.sec_is_hospital_admin(new.hospital_id, v_uid) then
      return new;
    end if;
    raise exception 'Only an administrator can move staff between hospitals';
  end if;
  if public.sec_is_hospital_admin(v_hosp, v_uid) then return coalesce(new, old); end if;

  v_hr := public.sec_is_hr(v_hosp, v_uid);
  v_me := public.sec_caller_email();

  if tg_op = 'INSERT' then
    if v_hr and public.pay_canonical_role(new.role) <> 'admin' then return new; end if;
    raise exception 'Only an administrator can add staff';
  end if;

  v_own := v_me is not null and lower(coalesce(old.email, '')) = v_me;

  if tg_op = 'DELETE' then
    if v_hr and not v_own and public.pay_canonical_role(old.role) <> 'admin' then return old; end if;
    raise exception 'Only an administrator can remove staff';
  end if;

  if lower(coalesce(new.email, '')) is distinct from lower(coalesce(old.email, '')) then
    raise exception 'Only an administrator can change a staff e-mail';
  end if;
  if new.role is distinct from old.role
     and not (v_hr and not v_own and public.pay_canonical_role(old.role) <> 'admin'
              and public.pay_canonical_role(new.role) <> 'admin') then
    raise exception 'Only an administrator can change a job title';
  end if;
  if new.status is distinct from old.status
     and not (v_hr and not v_own and public.pay_canonical_role(old.role) <> 'admin') then
    raise exception 'Only an administrator or HR can change a staff member''s status';
  end if;
  return new;
end $$;

drop trigger if exists trg_sec_guard_staff on public.staff;
create trigger trg_sec_guard_staff
  before insert or update or delete on public.staff
  for each row execute function public.sec_guard_staff();

create or replace function public.sec_guard_hospitals()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_net text; v_old_net text;
begin
  if v_uid is null then return coalesce(new, old); end if;
  v_net := to_jsonb(new)->>'network_id';

  if tg_op = 'INSERT' then
    if lower(coalesce(new.owner_email, '')) is distinct from public.sec_caller_email() then
      raise exception 'A new hospital must be owned by the account creating it';
    end if;
  else
    v_old_net := to_jsonb(old)->>'network_id';
    if new.id is distinct from old.id then raise exception 'A hospital id cannot change'; end if;
    if lower(coalesce(new.owner_email, '')) is distinct from lower(coalesce(old.owner_email, ''))
       and not public.sec_is_hospital_admin(old.id, v_uid) then
      raise exception 'Only an administrator can change the hospital owner';
    end if;
    if v_net is not distinct from v_old_net then return new; end if;
    if not public.sec_is_hospital_admin(old.id, v_uid) then
      raise exception 'Only an administrator can change the hospital network';
    end if;
  end if;

  if v_net is not null and exists (
       select 1 from public.hospitals hx where to_jsonb(hx)->>'network_id' = v_net and hx.id <> new.id)
     and not exists (
       select 1 from public.hospitals hx where to_jsonb(hx)->>'network_id' = v_net and hx.id <> new.id
          and public.sec_is_hospital_admin(hx.id, v_uid)) then
    raise exception 'Only an administrator of that network can add a hospital to it';
  end if;
  return new;
end $$;

drop trigger if exists trg_sec_guard_hospitals on public.hospitals;
create trigger trg_sec_guard_hospitals
  before insert or update on public.hospitals
  for each row execute function public.sec_guard_hospitals();

revoke execute on function public.sec_is_hospital_admin(uuid, uuid), public.sec_is_hr(uuid, uuid),
  public.sec_caller_email() from public, anon, authenticated;
grant execute on function public.sec_is_hospital_admin(uuid, uuid), public.sec_is_hr(uuid, uuid),
  public.sec_caller_email() to service_role;

commit;

select 'CHECK' as kind, check_name as name, case when ok then 'OK' else 'PROBLEM' end as detail from (
  select 'guard on hospital_users' as check_name, exists (select 1 from pg_trigger where tgname = 'trg_sec_guard_hospital_users') as ok
  union all select 'guard on staff', exists (select 1 from pg_trigger where tgname = 'trg_sec_guard_staff')
  union all select 'guard on hospitals', exists (select 1 from pg_trigger where tgname = 'trg_sec_guard_hospitals')
  union all select 'helpers hidden from browser', not has_function_privilege('authenticated', 'public.sec_is_hospital_admin(uuid, uuid)', 'execute')
) c
union all
select 'ADMIN (please review)', coalesce(h.name, hu.hospital_id::text), coalesce(u.email, hu.user_id::text) ||
       case when lower(coalesce(h.owner_email, '')) = lower(coalesce(u.email, '-')) then '  (owner)' else '  (admin link)' end
from public.hospital_users hu
left join public.hospitals h on h.id = hu.hospital_id
left join auth.users u on u.id = hu.user_id
where lower(coalesce(hu.role, '')) = 'admin'
union all
select 'REVIEW: trigger on auth.users', tgname, 'runs ' || tgfoid::regproc::text || ' when accounts are created. Send me its definition if it adds people to hospitals'
from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal
union all
select 'REVIEW: set_staff_role', p.oid::regprocedure::text,
       case when p.prosecdef and p.prosrc !~* 'raise' then 'has no permission check of its own (the new guards still block misuse). Send me its definition to tidy up'
            else 'looks guarded' end
from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'set_staff_role'
order by 1, 2;
