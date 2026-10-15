-- ============================================================================
-- Basma CRM v1.2 — Sales Operations Upgrade
-- ============================================================================
-- Safe to run multiple times: CREATE TABLE/COLUMN use IF NOT EXISTS, every
-- trigger uses DROP TRIGGER IF EXISTS, every notification insert uses
-- ON CONFLICT (dedupe_key) DO NOTHING. Same conventions as CRM-SETUP.sql,
-- APPOINTMENTS-SETUP.sql and CRM-AUTO-FOLLOWUP-TASKS.sql.
--
-- Does NOT modify CRM-SETUP.sql or CRM-AUTO-FOLLOWUP-TASKS.sql. This file is
-- purely additive: one new table (crm_notifications), two new columns on
-- the existing crm_companies table, and new trigger functions attached to
-- crm_leads / crm_meetings / crm_proposals. Not executed against the live
-- database by the assistant — run this in the Supabase SQL editor when
-- ready, same as every previous migration in this project.
--
-- PRECONDITION: CRM-SETUP.sql and CRM-AUTO-FOLLOWUP-TASKS.sql already run.
-- ============================================================================

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'crm_leads') then
    raise exception 'public.crm_leads was not found. Run CRM-SETUP.sql first.';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'crm_tasks') then
    raise exception 'public.crm_tasks was not found. Run CRM-SETUP.sql first.';
  end if;
end $$;

-- ============================================================================
-- 0. Timezone helpers — Asia/Gaza business-day boundaries (v1.2.2).
-- ============================================================================
-- Every stored timestamp in this schema stays exactly as-is (timestamptz,
-- UTC internally) — these helpers only convert AT THE POINT OF COMPARISON,
-- for deciding what counts as "today"/"this week" from the business's point
-- of view. Asia/Gaza is a named IANA zone (not a fixed +02/+03 offset), so
-- `AT TIME ZONE 'Asia/Gaza'` automatically follows Palestine's actual DST
-- rules for whatever date is being evaluated — nothing here hard-codes an
-- offset, and nothing here depends on the calling session's `TimeZone`
-- setting (Supabase's default session zone is UTC, but even if a caller
-- changed it, these functions would still be correct, since the zone name
-- is always spelled out explicitly).
create or replace function public.crm_gaza_date(ts timestamptz default now())
returns date
language sql
stable
as $$
  select (ts AT TIME ZONE 'Asia/Gaza')::date
$$;

-- Returns the instant (timestamptz) corresponding to local midnight
-- (00:00:00) in Asia/Gaza for the given calendar date (defaults to "today"
-- in Gaza). Built by interpreting a naive midnight timestamp AS Gaza-local
-- wall-clock time and converting it to an absolute instant — this is the
-- standard Postgres idiom for DST-correct local-midnight computation, and
-- is intentionally NOT implemented as "start of a fixed 24h block" or via
-- `+ interval '1 day'` arithmetic on a timestamptz (that form's day-length
-- silently depends on the session's `TimeZone` GUC, which we do not control
-- or want to rely on here).
create or replace function public.crm_gaza_day_start(d date default null)
returns timestamptz
language sql
stable
as $$
  select (coalesce(d, public.crm_gaza_date(now()))::text || ' 00:00:00')::timestamp AT TIME ZONE 'Asia/Gaza'
$$;

grant execute on function public.crm_gaza_date(timestamptz) to authenticated;
grant execute on function public.crm_gaza_day_start(date) to authenticated;

-- ============================================================================
-- 1. crm_notifications — the in-app Notification Center's data store.
-- ============================================================================
-- dedupe_key is the single deterministic duplicate-prevention mechanism for
-- EVERY notification type in this file: every insert below goes through
-- "ON CONFLICT (dedupe_key) DO NOTHING", so the exact same logical event
-- (e.g. "meeting X's 24h reminder") can never produce two rows, no matter
-- how many times a trigger re-fires or the refresh function re-runs.
create table if not exists public.crm_notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in (
    'lead_new_website', 'lead_new_booking', 'lead_new_manual',
    'meeting_scheduled', 'meeting_reminder_24h', 'meeting_reminder_today',
    'task_due_today', 'task_overdue',
    'proposal_created', 'proposal_status_changed',
    'lead_stage_changed', 'lead_won', 'lead_lost',
    'lead_no_activity_3d', 'lead_inactive_7d'
  )),
  title text not null check (char_length(btrim(title)) > 0),
  description text,
  lead_id uuid references public.crm_leads(id) on delete cascade,
  company_id uuid references public.crm_companies(id) on delete cascade,
  link text,
  dedupe_key text not null,
  is_read boolean not null default false,
  read_at timestamptz,
  read_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists crm_notifications_dedupe_key_uidx on public.crm_notifications (dedupe_key);
create index if not exists crm_notifications_is_read_idx on public.crm_notifications (is_read);
create index if not exists crm_notifications_created_at_idx on public.crm_notifications (created_at desc);
create index if not exists crm_notifications_lead_id_idx on public.crm_notifications (lead_id);

alter table public.crm_notifications enable row level security;
revoke all on public.crm_notifications from anon, authenticated;
grant select, insert, update on public.crm_notifications to authenticated;
-- No delete policy/grant on purpose: notifications are archived by marking
-- read, never deleted, so the audit trail of what fired and when stays
-- intact — matches this project's existing "activities are never deleted"
-- convention.

drop policy if exists crm_notifications_select on public.crm_notifications;
create policy crm_notifications_select on public.crm_notifications
for select to authenticated
using (public.crm_can_read());

drop policy if exists crm_notifications_insert on public.crm_notifications;
create policy crm_notifications_insert on public.crm_notifications
for insert to authenticated
with check (public.crm_can_write());

drop policy if exists crm_notifications_update on public.crm_notifications;
create policy crm_notifications_update on public.crm_notifications
for update to authenticated
using (public.crm_can_write())
with check (public.crm_can_write());
-- Deliberately crm_can_write(), not crm_can_read() — matches the UPDATE
-- policy shape used for every other CRM table in CRM-SETUP.sql. A VIEWER
-- must stay strictly read-only with zero exceptions (Phase 10 requirement),
-- even for something as low-stakes as a read/unread flag, so Viewers can
-- see their notifications and unread badge but cannot mark them read; only
-- Admin/Manager/Sales can. This is a deliberate trade-off, documented here
-- rather than silently made.

-- ============================================================================
-- 2. crm_companies — two new columns for the outreach workspace (Phase 5).
-- ============================================================================
-- Inspected CRM-SETUP.sql first: crm_companies already has name, website,
-- country, city, industry, phone, email, linkedin_url, address, notes —
-- every field Phase 5 lists except "assigned salesperson" and "outreach
-- status", which have no equivalent existing column anywhere on this
-- table. Both are added additively with safe defaults so existing rows
-- are unaffected.
alter table public.crm_companies add column if not exists assigned_to uuid references auth.users(id) on delete set null;
alter table public.crm_companies add column if not exists outreach_status text not null default 'not_contacted' check (outreach_status in (
  'not_contacted', 'researching', 'contacted', 'replied',
  'meeting_scheduled', 'proposal_sent', 'negotiating', 'won', 'lost'
));

create index if not exists crm_companies_assigned_to_idx on public.crm_companies (assigned_to);
create index if not exists crm_companies_outreach_status_idx on public.crm_companies (outreach_status);

-- ============================================================================
-- 3. Event-driven notification triggers.
-- ============================================================================

-- 3a. New Lead (any source) -> lead_new_website / lead_new_booking / lead_new_manual
create or replace function public.crm_notify_new_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
  v_title text;
begin
  if new.source = 'Website' then
    v_type := 'lead_new_website';
    v_title := 'Lead جديد من نموذج التواصل';
  elsif new.source = 'Website Booking' then
    v_type := 'lead_new_booking';
    v_title := 'حجز استشارة جديد';
  else
    v_type := 'lead_new_manual';
    v_title := 'Lead جديد تمت إضافته يدويًا';
  end if;

  insert into public.crm_notifications (type, title, description, lead_id, company_id, link, dedupe_key)
  values (
    v_type, v_title, new.title, new.id, new.company_id,
    '/crm/lead-details.html?id=' || new.id,
    v_type || ':' || new.id
  )
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

drop trigger if exists crm_leads_notify_new on public.crm_leads;
create trigger crm_leads_notify_new
after insert on public.crm_leads
for each row execute function public.crm_notify_new_lead();

-- 3b. Lead stage changed -> lead_stage_changed, plus lead_won / lead_lost
-- when the derived status actually flips (status is set by the pre-existing
-- crm_sync_lead_status BEFORE trigger from CRM-SETUP.sql, which always runs
-- before this AFTER trigger, so new.status is already correct here).
create or replace function public.crm_notify_lead_stage_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stage_labels jsonb := '{"new":"جديد","contacted":"تم التواصل","qualified":"مؤهل","meeting_scheduled":"اجتماع مجدول","proposal_sent":"أرسل العرض","negotiation":"تفاوض","won":"فاز","lost":"خسر"}'::jsonb;
begin
  if old.stage is distinct from new.stage then
    insert into public.crm_notifications (type, title, description, lead_id, company_id, link, dedupe_key)
    values (
      'lead_stage_changed', 'تغيّرت مرحلة Lead',
      new.title || ' → ' || coalesce(v_stage_labels->>new.stage, new.stage),
      new.id, new.company_id, '/crm/lead-details.html?id=' || new.id,
      'lead_stage_changed:' || new.id || ':' || new.stage || ':' || extract(epoch from new.updated_at)::text
    )
    on conflict (dedupe_key) do nothing;

    if new.status = 'won' and old.status is distinct from new.status then
      insert into public.crm_notifications (type, title, description, lead_id, company_id, link, dedupe_key)
      values ('lead_won', 'صفقة رابحة 🎉', new.title, new.id, new.company_id, '/crm/lead-details.html?id=' || new.id, 'lead_won:' || new.id)
      on conflict (dedupe_key) do nothing;
    elsif new.status = 'lost' and old.status is distinct from new.status then
      insert into public.crm_notifications (type, title, description, lead_id, company_id, link, dedupe_key)
      values ('lead_lost', 'صفقة خاسرة', new.title, new.id, new.company_id, '/crm/lead-details.html?id=' || new.id, 'lead_lost:' || new.id)
      on conflict (dedupe_key) do nothing;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists crm_leads_notify_stage_change on public.crm_leads;
create trigger crm_leads_notify_stage_change
after update of stage on public.crm_leads
for each row execute function public.crm_notify_lead_stage_changed();

-- 3c. Meeting scheduled
create or replace function public.crm_notify_meeting_scheduled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.crm_notifications (type, title, description, lead_id, company_id, link, dedupe_key)
  values (
    'meeting_scheduled', 'تم جدولة اجتماع', new.title, new.lead_id, new.company_id,
    case when new.lead_id is not null then '/crm/lead-details.html?id=' || new.lead_id else '/crm/meetings.html' end,
    'meeting_scheduled:' || new.id
  )
  on conflict (dedupe_key) do nothing;
  return new;
end;
$$;

drop trigger if exists crm_meetings_notify_scheduled on public.crm_meetings;
create trigger crm_meetings_notify_scheduled
after insert on public.crm_meetings
for each row execute function public.crm_notify_meeting_scheduled();

-- 3d. Proposal created / status changed
create or replace function public.crm_notify_proposal_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.crm_notifications (type, title, description, lead_id, company_id, link, dedupe_key)
  values (
    'proposal_created', 'تم إنشاء عرض سعر', new.proposal_number || ' — ' || new.title, new.lead_id, new.company_id,
    case when new.lead_id is not null then '/crm/lead-details.html?id=' || new.lead_id else '/crm/proposals.html' end,
    'proposal_created:' || new.id
  )
  on conflict (dedupe_key) do nothing;
  return new;
end;
$$;

drop trigger if exists crm_proposals_notify_created on public.crm_proposals;
create trigger crm_proposals_notify_created
after insert on public.crm_proposals
for each row execute function public.crm_notify_proposal_created();

create or replace function public.crm_notify_proposal_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status_labels jsonb := '{"draft":"مسودة","sent":"أُرسل","viewed":"تمت مشاهدته","accepted":"مقبول","rejected":"مرفوض","expired":"منتهي الصلاحية"}'::jsonb;
begin
  if old.status is distinct from new.status then
    insert into public.crm_notifications (type, title, description, lead_id, company_id, link, dedupe_key)
    values (
      'proposal_status_changed', 'تغيّرت حالة عرض السعر',
      new.proposal_number || ' → ' || coalesce(v_status_labels->>new.status, new.status),
      new.lead_id, new.company_id,
      case when new.lead_id is not null then '/crm/lead-details.html?id=' || new.lead_id else '/crm/proposals.html' end,
      'proposal_status_changed:' || new.id || ':' || new.status
    )
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists crm_proposals_notify_status_change on public.crm_proposals;
create trigger crm_proposals_notify_status_change
after update of status on public.crm_proposals
for each row execute function public.crm_notify_proposal_status_changed();

-- ============================================================================
-- 4. Time-based notifications (Task due/overdue, Meeting reminders, stale
--    Leads). These cannot be trigger-driven — nothing in the database
--    *changes* when a clock simply ticks past a deadline. Call
--    crm_refresh_time_based_notifications() to (re-)evaluate current state
--    and insert any newly-true conditions; every insert is dedupe_key-
--    guarded so calling this 100 times a day is always safe and never
--    produces a duplicate. The CRM frontend calls this once per page load
--    (see crm/assets/crm-client.js) — see the accompanying report for why
--    this project intentionally does not use pg_cron/Vercel Cron here.
-- ============================================================================
create or replace function public.crm_refresh_time_based_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  -- "Today" here means the Gaza calendar day, not the UTC calendar day —
  -- see crm_gaza_day_start()/crm_gaza_date() above. v_gaza_tomorrow_start is
  -- the exclusive upper bound (>= today_start AND < tomorrow_start), which
  -- avoids the old "<= end-of-day minus a millisecond" pattern entirely.
  v_gaza_today_start timestamptz := public.crm_gaza_day_start();
  v_gaza_tomorrow_start timestamptz := public.crm_gaza_day_start(public.crm_gaza_date(now()) + 1);
begin
  -- Tasks due today, IN GAZA LOCAL TIME (not yet completed/cancelled). The
  -- dedupe_key is stamped with the Gaza calendar date (not current_date,
  -- which is the UTC/session date) so a task due-today doesn't get a stale
  -- date label near the Gaza midnight rollover while the UTC day hasn't
  -- turned over yet (or vice versa) — that mismatch was the exact bug this
  -- hardening pass exists to close.
  insert into public.crm_notifications (type, title, description, lead_id, company_id, link, dedupe_key)
  select 'task_due_today', 'مهمة مستحقة اليوم', t.title, t.lead_id, t.company_id,
    case when t.lead_id is not null then '/crm/lead-details.html?id=' || t.lead_id else '/crm/tasks.html' end,
    'task_due_today:' || t.id || ':' || public.crm_gaza_date(now())::text
  from public.crm_tasks t
  where t.status not in ('completed', 'cancelled')
    and t.due_at is not null
    and t.due_at >= v_gaza_today_start
    and t.due_at < v_gaza_tomorrow_start
  on conflict (dedupe_key) do nothing;

  -- Overdue tasks — elapsed-time comparison against the current instant
  -- (due_at < now()), not a calendar-day boundary, so it is correct exactly
  -- as written regardless of timezone and needs no Gaza conversion. Fires
  -- once per task, ever — no daily repeat spam.
  insert into public.crm_notifications (type, title, description, lead_id, company_id, link, dedupe_key)
  select 'task_overdue', 'مهمة متأخرة', t.title, t.lead_id, t.company_id,
    case when t.lead_id is not null then '/crm/lead-details.html?id=' || t.lead_id else '/crm/tasks.html' end,
    'task_overdue:' || t.id
  from public.crm_tasks t
  where t.status not in ('completed', 'cancelled')
    and t.due_at is not null
    and t.due_at < now()
  on conflict (dedupe_key) do nothing;

  -- Meetings within the next 24 hours — a true elapsed 24-hour duration
  -- from "right now", not a calendar-day boundary. Correct as written,
  -- regardless of timezone; left unchanged on purpose (requirement: 24h
  -- durations must remain true elapsed 24-hour durations).
  insert into public.crm_notifications (type, title, description, lead_id, company_id, link, dedupe_key)
  select 'meeting_reminder_24h', 'اجتماع خلال 24 ساعة', m.title, m.lead_id, m.company_id,
    case when m.lead_id is not null then '/crm/lead-details.html?id=' || m.lead_id else '/crm/meetings.html' end,
    'meeting_reminder_24h:' || m.id
  from public.crm_meetings m
  where m.status = 'scheduled'
    and m.scheduled_at >= now()
    and m.scheduled_at <= now() + interval '24 hours'
  on conflict (dedupe_key) do nothing;

  -- Meetings happening today, IN GAZA LOCAL TIME (fires once per meeting —
  -- its dedupe_key has no date component, so no change needed there).
  insert into public.crm_notifications (type, title, description, lead_id, company_id, link, dedupe_key)
  select 'meeting_reminder_today', 'اجتماع اليوم', m.title, m.lead_id, m.company_id,
    case when m.lead_id is not null then '/crm/lead-details.html?id=' || m.lead_id else '/crm/meetings.html' end,
    'meeting_reminder_today:' || m.id
  from public.crm_meetings m
  where m.status = 'scheduled'
    and m.scheduled_at >= v_gaza_today_start
    and m.scheduled_at < v_gaza_tomorrow_start
  on conflict (dedupe_key) do nothing;

  -- Open leads with no activity/meeting/task touch in the last 3 days —
  -- elapsed-time comparison against "now() - interval '3 days'", not a
  -- calendar-day boundary, so reviewed and left unchanged (correct as
  -- written regardless of timezone; fires once ever per lead, does not
  -- re-fire if it goes stale again after being touched).
  insert into public.crm_notifications (type, title, description, lead_id, company_id, link, dedupe_key)
  select 'lead_no_activity_3d', 'Lead بدون نشاط منذ 3 أيام', l.title, l.id, l.company_id,
    '/crm/lead-details.html?id=' || l.id, 'lead_no_activity_3d:' || l.id
  from public.crm_leads l
  where l.status = 'open'
    and greatest(
      l.created_at,
      coalesce(l.last_contact_at, l.created_at),
      coalesce((select max(a.created_at) from public.crm_activities a where a.lead_id = l.id), l.created_at)
    ) < now() - interval '3 days'
  on conflict (dedupe_key) do nothing;

  -- Open leads inactive 7+ days — a stronger "needs attention" flag, never
  -- auto-closes the lead, purely a surfaced alert (fires once ever).
  insert into public.crm_notifications (type, title, description, lead_id, company_id, link, dedupe_key)
  select 'lead_inactive_7d', 'Lead يحتاج انتباهًا — 7 أيام بدون نشاط', l.title, l.id, l.company_id,
    '/crm/lead-details.html?id=' || l.id, 'lead_inactive_7d:' || l.id
  from public.crm_leads l
  where l.status = 'open'
    and greatest(
      l.created_at,
      coalesce(l.last_contact_at, l.created_at),
      coalesce((select max(a.created_at) from public.crm_activities a where a.lead_id = l.id), l.created_at)
    ) < now() - interval '7 days'
  on conflict (dedupe_key) do nothing;
end;
$$;

grant execute on function public.crm_refresh_time_based_notifications() to authenticated;
grant execute on function public.crm_notify_new_lead() to authenticated;
grant execute on function public.crm_notify_lead_stage_changed() to authenticated;
grant execute on function public.crm_notify_meeting_scheduled() to authenticated;
grant execute on function public.crm_notify_proposal_created() to authenticated;
grant execute on function public.crm_notify_proposal_status_changed() to authenticated;

-- ============================================================================
-- 5. crm_dashboard_snapshot() — single-call aggregate for the Dashboard.
-- ============================================================================
-- Replaces the dashboard's old pattern of fetching every crm_leads row and
-- every open crm_tasks row to the browser and aggregating client-side (an
-- unbounded "load all records" query that grows with the business). This
-- function does every count/sum/group-by inside Postgres and returns one
-- small jsonb payload. security invoker (not definer) — it must run under
-- the calling user's role so the existing crm_can_read() RLS policies on
-- crm_leads/crm_tasks/crm_meetings/crm_activities still apply exactly as
-- they do for direct queries; nothing here bypasses row-level security.
-- crm/index.html calls this first and falls back to the previous bounded
-- per-table queries if the function does not exist yet (pre-migration),
-- same feature-detection pattern already used for outreach_status/assigned_to.
create or replace function public.crm_dashboard_snapshot()
returns jsonb
language plpgsql
security invoker
stable
set search_path = public
as $$
declare
  v_now timestamptz := now();
  -- "Today"/"this week" business-day boundaries are computed in Asia/Gaza,
  -- not the database/session's UTC day — see crm_gaza_day_start() above.
  -- v_today_start/v_tomorrow_start bound an exclusive [start, end) range
  -- for every "today" metric below; the old inclusive "<= end-of-day minus
  -- a millisecond" pattern has been retired in favor of this cleaner and
  -- more precise form. Rolling/elapsed-duration metrics (leads_this_week,
  -- meetings_next_24h, stale_leads_7d) are reviewed but intentionally left
  -- as plain now()-relative windows — they are true elapsed durations, not
  -- calendar-day concepts, so they need no timezone conversion.
  v_today_start timestamptz := public.crm_gaza_day_start();
  v_tomorrow_start timestamptz := public.crm_gaza_day_start(public.crm_gaza_date(v_now) + 1);
  v_week_ago timestamptz := v_now - interval '7 days';
  v_in_24h timestamptz := v_now + interval '24 hours';
  v_result jsonb;
begin
  select jsonb_build_object(
    'total_leads', (select count(*) from crm_leads),
    'kpis', jsonb_build_object(
      'open_leads', (select count(*) from crm_leads where status = 'open'),
      'leads_today', (select count(*) from crm_leads where created_at >= v_today_start and created_at < v_tomorrow_start),
      'leads_this_week', (select count(*) from crm_leads where created_at >= v_week_ago),
      'website_leads_today', (select count(*) from crm_leads where source = 'Website' and created_at >= v_today_start and created_at < v_tomorrow_start),
      'bookings_today', (select count(*) from crm_leads where source = 'Website Booking' and created_at >= v_today_start and created_at < v_tomorrow_start),
      'meetings_today', (select count(*) from crm_meetings where status = 'scheduled' and scheduled_at >= v_today_start and scheduled_at < v_tomorrow_start),
      'meetings_upcoming', (select count(*) from crm_meetings where status = 'scheduled' and scheduled_at >= v_now),
      'meetings_next_24h', (select count(*) from crm_meetings where status = 'scheduled' and scheduled_at >= v_now and scheduled_at <= v_in_24h),
      'tasks_due_today', (select count(*) from crm_tasks where status not in ('completed', 'cancelled') and due_at >= v_today_start and due_at < v_tomorrow_start),
      'tasks_overdue', (select count(*) from crm_tasks where status not in ('completed', 'cancelled') and due_at < v_now),
      'won_deals', (select count(*) from crm_leads where status = 'won'),
      'lost_deals', (select count(*) from crm_leads where status = 'lost'),
      'pipeline_value', (select coalesce(sum(estimated_value), 0) from crm_leads where status = 'open'),
      'weighted_pipeline_value', (select coalesce(sum(estimated_value * probability / 100.0), 0) from crm_leads where status = 'open'),
      'avg_deal_value', (select coalesce(avg(estimated_value), 0) from crm_leads where status = 'won'),
      'conversion_rate', (
        select case when count(*) filter (where status in ('won', 'lost')) = 0 then 0
        else round(100.0 * count(*) filter (where status = 'won') / count(*) filter (where status in ('won', 'lost')))
        end
        from crm_leads
      ),
      'follow_ups_today', (select count(*) from crm_leads where next_follow_up_at >= v_today_start and next_follow_up_at < v_tomorrow_start),
      'overdue_follow_ups', (select count(*) from crm_leads where status = 'open' and next_follow_up_at < v_today_start),
      'stale_leads_7d', (select count(*) from crm_leads where status = 'open' and (last_contact_at is null or last_contact_at < v_week_ago))
    ),
    'by_source', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select coalesce(source, 'غير محدد') as source, count(*) as count
        from crm_leads group by source order by count(*) desc limit 8
      ) x
    ),
    'by_service', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select coalesce(service_interest, 'غير محدد') as service_interest, count(*) as count
        from crm_leads group by service_interest order by count(*) desc limit 8
      ) x
    ),
    'by_stage', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select stage, count(*) as count
        from crm_leads group by stage order by count(*) desc limit 8
      ) x
    ),
    'by_country', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select coalesce(country, 'غير محدد') as country, count(*) as count
        from crm_leads group by country order by count(*) desc limit 8
      ) x
    ),
    'value_by_stage', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select stage, sum(estimated_value) as value
        from crm_leads where status = 'open' group by stage order by sum(estimated_value) desc limit 8
      ) x
    ),
    -- 30 daily buckets, each one a real Gaza calendar day. Deliberately NOT
    -- built via `generate_series(timestamptz, timestamptz, interval '1 day')`
    -- + a naive `created_at::date` join (the original v1.2.1 approach): that
    -- pattern buckets by whatever the session's implicit TimeZone happens to
    -- be, and advancing a timestamptz by "1 day" is itself ambiguous across
    -- a DST transition. Instead each day's [start, end) instant boundary is
    -- computed independently via crm_gaza_day_start(), so a 23-hour or
    -- 25-hour Gaza calendar day (spring-forward/fall-back) is still counted
    -- as exactly one correct bucket.
    'trend_30d', (
      select coalesce(jsonb_agg(
        jsonb_build_object('day', to_char(b.day, 'YYYY-MM-DD'), 'count', coalesce(cnt.c, 0))
        order by b.day
      ), '[]'::jsonb)
      from (
        select (public.crm_gaza_date(v_now) - n) as day
        from generate_series(0, 29) as n
      ) b
      left join lateral (
        select count(*) as c
        from crm_leads l
        where l.created_at >= public.crm_gaza_day_start(b.day)
          and l.created_at < public.crm_gaza_day_start(b.day + 1)
      ) cnt on true
    ),
    'recent_activities', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select id, subject, activity_type, activity_at, created_at
        from crm_activities order by created_at desc limit 8
      ) x
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.crm_dashboard_snapshot() to authenticated;

-- ============================================================================
-- 6. Additional indexes for the new pagination/sort columns introduced by
--    this round of UX work (leads.html/companies.html/contacts.html/
--    proposals.html now sort + range-paginate on these columns server-side).
--    crm_tasks.due_at, crm_meetings.scheduled_at and crm_activities.activity_at
--    already have indexes from CRM-SETUP.sql and need nothing new.
-- ============================================================================
create index if not exists crm_leads_created_at_idx on public.crm_leads (created_at desc);
create index if not exists crm_companies_name_idx on public.crm_companies (name);
create index if not exists crm_contacts_full_name_idx on public.crm_contacts (full_name);
create index if not exists crm_proposals_created_at_idx on public.crm_proposals (created_at desc);

-- ============================================================================
-- 7. crm_notifications.type — widen the CHECK constraint to add
--    'whatsapp_logged' (WhatsApp activity notification feature).
-- ============================================================================
-- No table/column was added — this only widens an existing CHECK constraint,
-- per explicit user approval, to represent one new notification type:
-- "a WhatsApp activity was just logged for a lead/company". Written as the
-- standard idempotent DROP-IF-EXISTS + ADD pattern, safe to re-run. The
-- constraint name below (`<table>_<column>_check`) is Postgres's own default
-- auto-generated name for an inline `column ... check (...)` clause (as used
-- when crm_notifications was first created in Section 1 of this file), and
-- was confirmed against a real Postgres engine (pglite) before being relied
-- on here — see the test suite for the exact assertion.
alter table public.crm_notifications drop constraint if exists crm_notifications_type_check;
alter table public.crm_notifications add constraint crm_notifications_type_check
  check (type in (
    'lead_new_website', 'lead_new_booking', 'lead_new_manual',
    'meeting_scheduled', 'meeting_reminder_24h', 'meeting_reminder_today',
    'task_due_today', 'task_overdue',
    'proposal_created', 'proposal_status_changed',
    'lead_stage_changed', 'lead_won', 'lead_lost',
    'lead_no_activity_3d', 'lead_inactive_7d',
    'whatsapp_logged'
  ));

-- ============================================================================
-- 8. crm_import_batch — atomic per-batch write for the CSV Import System
--    (v1.3.1). One RPC call = one Postgres transaction: every company/
--    contact/lead/note in p_rows is written together, or — if any single
--    row in the call raises an error (a constraint violation, an update
--    target that no longer exists, etc.) — NONE of it is, because an
--    unhandled exception inside a PL/pgSQL function aborts the entire
--    enclosing transaction and Postgres rolls back everything the function
--    did, automatically, with no explicit BEGIN/COMMIT needed (a plain
--    top-level RPC call already runs as its own transaction).
--
--    security invoker (the default, but stated explicitly): the function
--    runs with the CALLING user's own privileges, so crm_can_write()'s
--    RLS-backed INSERT/UPDATE policies on crm_companies/crm_contacts/
--    crm_leads/crm_activities are still enforced per statement inside the
--    function — identical to what happens when the browser issues those
--    inserts directly. This is the same documented trade-off already used
--    by crm_dashboard_snapshot() above (Section 5).
--
--    p_rows: jsonb array, one element per CSV row that needs a DB write
--    (rows the client already decided to skip are never sent here — a skip
--    has nothing to roll back, so there is no reason to spend a transaction
--    on it). Each element:
--      { "line": <csv line number, for error reporting>,
--        "action": "create" | "update",
--        "existing_company_id": "<uuid>" | null,   -- required when action = "update"
--        "company": { name, industry, country, city, website, linkedin_url, email, phone },
--        "contact": { full_name, email, phone, job_title } | null,
--        "lead": { title, source, stage, priority, estimated_value, notes } | null }
--    p_options: { "create_contacts": bool, "create_leads": bool }
--
--    Returns jsonb: { companies_created, companies_updated, contacts_created,
--    leads_created, touched_company_ids: [uuid, ...] }. touched_company_ids
--    feeds the CRM's "Open Imported Companies" review screen.
--
--    The client (crm/import-companies.html) calls this once per batch of up
--    to 100 rows. If a batch call fails, the client bisects it into halves
--    and retries each half as its own atomic call, isolating exactly which
--    row(s) are bad instead of sacrificing every good row in that batch —
--    see the CRM-v1.3.1 report for the full strategy write-up.
--
--    UNLIKE crm_dashboard_snapshot() above, this function does NOT have a
--    silent client-side fallback if it hasn't been deployed yet. A missing-
--    dashboard-RPC fallback only degrades to a slower read; a missing-
--    import-RPC fallback would mean silently reverting to non-atomic
--    multi-statement writes — exactly the partial-write risk this function
--    exists to eliminate. So the importer instead detects PostgREST's
--    "function not found" error, stops the import immediately, and tells
--    the user to run this migration first. A weaker guarantee should never
--    be handed out silently when atomicity was explicitly requested.
-- ============================================================================
create or replace function public.crm_import_batch(p_rows jsonb, p_options jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row jsonb;
  v_company jsonb;
  v_contact jsonb;
  v_lead jsonb;
  v_action text;
  v_company_id uuid;
  v_contact_id uuid;
  v_lead_id uuid;
  v_companies_created int := 0;
  v_companies_updated int := 0;
  v_contacts_created int := 0;
  v_leads_created int := 0;
  v_touched_company_ids uuid[] := '{}';
  v_create_contacts boolean := coalesce((p_options->>'create_contacts')::boolean, true);
  v_create_leads boolean := coalesce((p_options->>'create_leads')::boolean, true);
begin
  if not public.crm_can_write() then
    raise exception 'insufficient_privilege: current user cannot write to the CRM';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_action := v_row->>'action';
    v_company := v_row->'company';
    v_contact := v_row->'contact';
    v_lead := v_row->'lead';
    -- jsonb quirk: a JSON `null` value (e.g. {"lead": null}) comes back from
    -- `->` as the jsonb scalar 'null', which is NOT the same thing as SQL
    -- NULL — "v_lead is not null" would still be true for it. Normalize both
    -- optional sub-objects to real SQL NULL so the "is not null" checks
    -- below behave as intended (this was caught by the pglite test suite:
    -- an update-only row with lead=null was incorrectly also creating a
    -- lead, because coalesce(v_lead->>'title','') fell through to the
    -- company name).
    if jsonb_typeof(v_contact) = 'null' then v_contact := null; end if;
    if jsonb_typeof(v_lead) = 'null' then v_lead := null; end if;
    v_company_id := null;
    v_contact_id := null;
    v_lead_id := null;

    if v_action = 'update' then
      v_company_id := (v_row->>'existing_company_id')::uuid;
      update public.crm_companies set
        name = coalesce(nullif(v_company->>'name', ''), name),
        industry = coalesce(nullif(v_company->>'industry', ''), industry),
        country = coalesce(nullif(v_company->>'country', ''), country),
        city = coalesce(nullif(v_company->>'city', ''), city),
        website = coalesce(nullif(v_company->>'website', ''), website),
        linkedin_url = coalesce(nullif(v_company->>'linkedin_url', ''), linkedin_url),
        email = coalesce(nullif(v_company->>'email', ''), email),
        phone = coalesce(nullif(v_company->>'phone', ''), phone)
      where id = v_company_id;
      if not found then
        raise exception 'update_target_missing: crm_companies.id % not found (csv line %)', v_company_id, (v_row->>'line');
      end if;
      v_companies_updated := v_companies_updated + 1;
    elsif v_action = 'create' then
      insert into public.crm_companies (name, industry, country, city, website, linkedin_url, email, phone)
      values (
        v_company->>'name', nullif(v_company->>'industry', ''), nullif(v_company->>'country', ''),
        nullif(v_company->>'city', ''), nullif(v_company->>'website', ''), nullif(v_company->>'linkedin_url', ''),
        nullif(v_company->>'email', ''), nullif(v_company->>'phone', '')
      )
      returning id into v_company_id;
      v_companies_created := v_companies_created + 1;
    else
      raise exception 'unknown_action: % (csv line %)', v_action, (v_row->>'line');
    end if;

    v_touched_company_ids := v_touched_company_ids || v_company_id;

    if v_create_contacts and v_contact is not null and coalesce(v_contact->>'full_name', '') <> '' then
      insert into public.crm_contacts (company_id, full_name, email, phone, job_title, is_primary)
      values (v_company_id, v_contact->>'full_name', nullif(v_contact->>'email', ''), nullif(v_contact->>'phone', ''), nullif(v_contact->>'job_title', ''), true)
      returning id into v_contact_id;
      v_contacts_created := v_contacts_created + 1;
    end if;

    if v_create_leads and v_lead is not null and (coalesce(v_lead->>'title', '') <> '' or coalesce(v_company->>'name', '') <> '') then
      insert into public.crm_leads (title, company_id, contact_id, source, stage, priority, estimated_value, currency)
      values (
        coalesce(nullif(v_lead->>'title', ''), 'Lead: ' || (v_company->>'name')),
        v_company_id, v_contact_id,
        coalesce(nullif(v_lead->>'source', ''), 'CSV Import'),
        coalesce(nullif(v_lead->>'stage', ''), 'new'),
        coalesce(nullif(v_lead->>'priority', ''), 'medium'),
        coalesce(nullif(v_lead->>'estimated_value', '')::numeric, 0),
        'USD'
      )
      returning id into v_lead_id;
      v_leads_created := v_leads_created + 1;

      if coalesce(v_lead->>'notes', '') <> '' then
        insert into public.crm_activities (lead_id, company_id, activity_type, subject, details)
        values (v_lead_id, v_company_id, 'note', 'ملاحظة الاستيراد', v_lead->>'notes');
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'companies_created', v_companies_created,
    'companies_updated', v_companies_updated,
    'contacts_created', v_contacts_created,
    'leads_created', v_leads_created,
    'touched_company_ids', to_jsonb(v_touched_company_ids)
  );
end;
$$;

grant execute on function public.crm_import_batch(jsonb, jsonb) to authenticated;

-- ============================================================================
-- End of migration. Not executed against the live database by the
-- assistant — run this in the Supabase SQL editor when ready.
-- ============================================================================
