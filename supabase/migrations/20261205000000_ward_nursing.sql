-- Ward nursing: observation chart with early warning scores computed by the database (adults NEWS2 — Royal College of
-- Physicians 2017; children Brighton PEWS), the required response and next-observation time, escalation that must be
-- acknowledged (high scores also post a hospital alert), risk assessments (Braden pressure injury, Morse falls) and
-- nursing care plans with evaluations. Clinical staff only. Thresholds can be adjusted to local policy here.

create table if not exists public.ward_observations (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid not null,
  patient_id       uuid not null,
  visit_id         text,
  bed_id           text,
  scale            text not null default 'news2' check (scale in ('news2', 'pews')),
  observed_at      timestamptz not null default now(),
  obs              jsonb not null default '{}'::jsonb,
  score            smallint,
  any_three        boolean not null default false,        -- a single parameter scoring 3
  level            text check (level in ('routine', 'low', 'low_medium', 'medium', 'high')),
  response         text,
  next_due_at      timestamptz,
  escalated_to     text,
  escalated_at     timestamptz,
  reviewed_at      timestamptz,
  review_note      text,
  recorded_by      uuid default auth.uid(),
  recorded_by_name text,
  created_at       timestamptz not null default now()
);
create index if not exists ward_observations_patient on public.ward_observations(hospital_id, patient_id, observed_at desc);

create table if not exists public.ward_risk_assessments (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  patient_id  uuid not null,
  visit_id    text,
  kind        text not null check (kind in ('braden', 'morse')),
  answers     jsonb not null,
  total       smallint not null,
  risk        text not null,
  assessed_by uuid default auth.uid(),
  assessed_at timestamptz not null default now()
);
create index if not exists ward_risk_patient on public.ward_risk_assessments(hospital_id, patient_id, assessed_at desc);

create table if not exists public.ward_care_plans (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null,
  patient_id    uuid not null,
  visit_id      text,
  problem       text not null,
  goal          text not null,
  interventions jsonb not null default '[]'::jsonb check (jsonb_typeof(interventions) = 'array'),
  evaluations   jsonb not null default '[]'::jsonb check (jsonb_typeof(evaluations) = 'array'),
  status        text not null default 'active' check (status in ('active', 'resolved', 'discontinued')),
  review_by     date,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  resolved_at   timestamptz
);
create index if not exists ward_care_plans_patient on public.ward_care_plans(hospital_id, patient_id, status);

-- NEWS2 (RCP 2017). obs: rr, spo2, spo2_scale (1 | 2), oxygen (bool), sbp, hr, consciousness (A | C | V | P | U), temp
create or replace function public.news2_score(o jsonb)
returns jsonb language plpgsql immutable as $$
declare
  rr numeric := nullif(o->>'rr', '')::numeric; sp numeric := nullif(o->>'spo2', '')::numeric;
  sbp numeric := nullif(o->>'sbp', '')::numeric; hr numeric := nullif(o->>'hr', '')::numeric;
  t numeric := nullif(o->>'temp', '')::numeric; o2 boolean := coalesce((o->>'oxygen')::boolean, false);
  scale2 boolean := coalesce(o->>'spo2_scale', '1') = '2'; c text := upper(coalesce(o->>'consciousness', 'A'));
  p jsonb := '{}'; v int;
begin
  v := case when rr is null then null when rr <= 8 then 3 when rr <= 11 then 1 when rr <= 20 then 0 when rr <= 24 then 2 else 3 end; p := p || jsonb_build_object('rr', v);
  if not scale2 then
    v := case when sp is null then null when sp <= 91 then 3 when sp <= 93 then 2 when sp <= 95 then 1 else 0 end;
  else
    v := case when sp is null then null when sp <= 83 then 3 when sp <= 85 then 2 when sp <= 87 then 1
              when sp <= 92 or not o2 then 0 when sp <= 94 then 1 when sp <= 96 then 2 else 3 end;
  end if;
  p := p || jsonb_build_object('spo2', v);
  p := p || jsonb_build_object('oxygen', case when o2 then 2 else 0 end);
  v := case when sbp is null then null when sbp <= 90 then 3 when sbp <= 100 then 2 when sbp <= 110 then 1 when sbp <= 219 then 0 else 3 end; p := p || jsonb_build_object('sbp', v);
  v := case when hr is null then null when hr <= 40 then 3 when hr <= 50 then 1 when hr <= 90 then 0 when hr <= 110 then 1 when hr <= 130 then 2 else 3 end; p := p || jsonb_build_object('hr', v);
  p := p || jsonb_build_object('consciousness', case when c = 'A' then 0 else 3 end);
  v := case when t is null then null when t <= 35.0 then 3 when t <= 36.0 then 1 when t <= 38.0 then 0 when t <= 39.0 then 1 else 2 end; p := p || jsonb_build_object('temp', v);
  return jsonb_build_object('parts', p,
    'score', (select coalesce(sum(value::text::int), 0) from jsonb_each(p) where jsonb_typeof(value) = 'number'),
    'any_three', exists (select 1 from jsonb_each(p) where value::text = '3'),
    'missing', (select coalesce(jsonb_agg(key), '[]'::jsonb) from jsonb_each(p) where jsonb_typeof(value) = 'null'));
end $$;

-- Brighton PEWS: behaviour, cardiovascular, respiratory (0–3 each, chosen by the nurse against the child's age norms)
-- + 2 for quarter-hourly nebulisers + 2 for persistent vomiting after surgery
create or replace function public.pews_score(o jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'score', coalesce(nullif(o->>'behaviour', '')::int, 0) + coalesce(nullif(o->>'cardiovascular', '')::int, 0) + coalesce(nullif(o->>'respiratory', '')::int, 0)
             + case when coalesce((o->>'nebs')::boolean, false) then 2 else 0 end + case when coalesce((o->>'vomiting')::boolean, false) then 2 else 0 end,
    'any_three', '3' in (o->>'behaviour', o->>'cardiovascular', o->>'respiratory'),
    'missing', (select coalesce(jsonb_agg(k), '[]'::jsonb) from unnest(array['behaviour', 'cardiovascular', 'respiratory']) k where coalesce(o->>k, '') = ''))
$$;

-- Clinical response and observation frequency for a score
create or replace function public.ews_response(p_scale text, p_score integer, p_any_three boolean)
returns jsonb language sql immutable as $$
  select case
    when p_scale = 'news2' and p_score >= 7 then '{"level":"high","minutes":15,"response":"Emergency response: clinician with critical-care skills to assess now; continuous monitoring; consider transfer to HDU/ICU."}'::jsonb
    when p_scale = 'news2' and p_score >= 5 then '{"level":"medium","minutes":60,"response":"Urgent response: inform the doctor in charge now for urgent review; observations at least hourly."}'::jsonb
    when p_scale = 'news2' and p_any_three then '{"level":"low_medium","minutes":60,"response":"A single parameter scores 3: urgent ward-based review by a clinician; observations at least hourly."}'::jsonb
    when p_scale = 'news2' and p_score >= 1 then '{"level":"low","minutes":240,"response":"Inform the nurse in charge, who decides whether review or more frequent observations are needed; observations at least 4-hourly."}'::jsonb
    when p_scale = 'news2' then '{"level":"routine","minutes":720,"response":"Continue routine monitoring; observations at least 12-hourly."}'::jsonb
    when p_score >= 5 or p_any_three then '{"level":"high","minutes":15,"response":"Urgent medical review now (registrar / senior); consider HDU/ICU; continuous monitoring."}'::jsonb
    when p_score = 4 then '{"level":"medium","minutes":30,"response":"Inform the doctor for review within 30 minutes; observations every 30 minutes."}'::jsonb
    when p_score = 3 then '{"level":"low_medium","minutes":60,"response":"Inform the nurse in charge; increase observations to hourly."}'::jsonb
    when p_score >= 1 then '{"level":"low","minutes":240,"response":"Continue observations 4-hourly; reassess if worried."}'::jsonb
    else '{"level":"routine","minutes":240,"response":"Routine observations."}'::jsonb end
$$;

create or replace function public.ward_observations_before()
returns trigger language plpgsql as $$
declare r jsonb; resp jsonb;
begin
  if tg_op = 'UPDATE' then
    -- the observations themselves never change; only the escalation / review can be completed
    if (to_jsonb(new) - array['escalated_to', 'escalated_at', 'reviewed_at', 'review_note']) is distinct from (to_jsonb(old) - array['escalated_to', 'escalated_at', 'reviewed_at', 'review_note']) then
      raise exception 'Observations cannot be changed; record a new set';
    end if;
    if new.escalated_to is not null and old.escalated_to is null then new.escalated_at := coalesce(new.escalated_at, now()); end if;
    return new;
  end if;
  r := case new.scale when 'pews' then public.pews_score(new.obs) else public.news2_score(new.obs) end;
  new.score := (r->>'score')::int;
  new.any_three := (r->>'any_three')::boolean;
  resp := public.ews_response(new.scale, new.score, new.any_three);
  new.level := resp->>'level';
  new.response := resp->>'response';
  new.next_due_at := new.observed_at + make_interval(mins => (resp->>'minutes')::int);
  return new;
end $$;
drop trigger if exists trg_ward_observations_before on public.ward_observations;
create trigger trg_ward_observations_before before insert or update on public.ward_observations for each row execute function public.ward_observations_before();

create or replace function public.ward_observations_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.level = 'high' then
    begin
      execute 'insert into public.notifications(hospital_id, notification_type, title, message, target_path, payload_json)
               values ($1, ''alert'', ''Deteriorating patient'', $2, ''/wards'', $3)'
        using new.hospital_id, upper(new.scale) || ' ' || new.score || ': ' || new.response,
              jsonb_build_object('observation_id', new.id, 'patient_id', new.patient_id, 'bed_id', new.bed_id);
    exception when others then raise warning 'deterioration alert skipped: %', sqlerrm;
    end;
  end if;
  return null;
end $$;
drop trigger if exists trg_ward_observations_after on public.ward_observations;
create trigger trg_ward_observations_after after insert on public.ward_observations for each row execute function public.ward_observations_after();

-- Braden (6–23, lower = higher risk) and Morse (0–125) totals and risk bands are computed here
create or replace function public.ward_risk_before()
returns trigger language plpgsql as $$
declare a jsonb := new.answers; t int;
begin
  if new.kind = 'braden' then
    t := coalesce((a->>'sensory')::int, 0) + coalesce((a->>'moisture')::int, 0) + coalesce((a->>'activity')::int, 0)
       + coalesce((a->>'mobility')::int, 0) + coalesce((a->>'nutrition')::int, 0) + coalesce((a->>'friction')::int, 0);
    if t < 6 then raise exception 'Answer all six Braden items'; end if;
    new.total := t;
    new.risk := case when t <= 9 then 'very high' when t <= 12 then 'high' when t <= 14 then 'moderate' when t <= 18 then 'mild' else 'no risk' end;
  else
    t := coalesce((a->>'history')::int, 0) + coalesce((a->>'secondary_dx')::int, 0) + coalesce((a->>'aid')::int, 0)
       + coalesce((a->>'iv')::int, 0) + coalesce((a->>'gait')::int, 0) + coalesce((a->>'mental')::int, 0);
    new.total := t;
    new.risk := case when t >= 45 then 'high' when t >= 25 then 'moderate' else 'low' end;
  end if;
  return new;
end $$;
drop trigger if exists trg_ward_risk_before on public.ward_risk_assessments;
create trigger trg_ward_risk_before before insert on public.ward_risk_assessments for each row execute function public.ward_risk_before();

create or replace function public.ward_care_plans_before()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status <> 'active' and (tg_op = 'INSERT' or old.status = 'active') then new.resolved_at := now(); end if;
  if tg_op = 'UPDATE' and old.status <> 'active' and new.status is distinct from old.status then raise exception 'This care plan is closed; start a new one'; end if;
  return new;
end $$;
drop trigger if exists trg_ward_care_plans_before on public.ward_care_plans;
create trigger trg_ward_care_plans_before before insert or update on public.ward_care_plans for each row execute function public.ward_care_plans_before();

alter table public.ward_observations enable row level security;
alter table public.ward_risk_assessments enable row level security;
alter table public.ward_care_plans enable row level security;
drop policy if exists ward_observations_clinical on public.ward_observations;
drop policy if exists ward_risk_clinical on public.ward_risk_assessments;
drop policy if exists ward_care_plans_clinical on public.ward_care_plans;
create policy ward_observations_clinical on public.ward_observations for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
create policy ward_risk_clinical on public.ward_risk_assessments for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
create policy ward_care_plans_clinical on public.ward_care_plans for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
revoke all on public.ward_observations, public.ward_risk_assessments, public.ward_care_plans from anon;
grant select, insert, update on public.ward_observations, public.ward_care_plans to authenticated;
grant select, insert on public.ward_risk_assessments to authenticated;
grant all on public.ward_observations, public.ward_risk_assessments, public.ward_care_plans to service_role;
revoke execute on function public.ward_observations_before(), public.ward_observations_after(), public.ward_risk_before(), public.ward_care_plans_before() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['ward_observations', 'ward_care_plans', 'ward_risk_assessments'] loop
    if to_regprocedure('public.audit_row_change()') is not null then
      execute format('drop trigger if exists trg_audit_change on public.%I', t);
      execute format('create trigger trg_audit_change after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
    end if;
  end loop;
end $$;
