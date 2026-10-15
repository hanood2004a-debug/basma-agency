-- ============================================================================
-- Basma CRM v1.4 — Sales Outreach Hub
-- ============================================================================
-- A SEPARATE migration file, as requested — does not live inside
-- CRM-SALES-OPS-UPGRADE.sql. Safe to run multiple times: every statement
-- uses IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS guards, the
-- same convention as every other migration in this project.
--
-- No external services (Gmail/WhatsApp/LinkedIn APIs) are used anywhere in
-- this file or in the pages that call it — every "Email/LinkedIn/WhatsApp/
-- Phone" concept here is a STATUS the CRM user records manually after
-- doing that outreach themselves; nothing sends anything on your behalf.
--
-- PRECONDITION: assumes CRM-SETUP.sql, CRM-AUTO-FOLLOWUP-TASKS.sql, and the
-- CURRENT CRM-SALES-OPS-UPGRADE.sql (the one that already defines
-- crm_import_batch(), crm_gaza_date()/crm_gaza_day_start(), and
-- crm_refresh_time_based_notifications()) have already been run. This file
-- extends two of those functions with CREATE OR REPLACE further down —
-- that is a normal, safe pattern already used repeatedly in this project
-- (e.g. the Gaza-timezone hardening pass redefined a v1.2 function from a
-- separate file without touching the original).
-- ============================================================================

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'crm_companies') then
    raise exception 'public.crm_companies was not found. Run CRM-SETUP.sql first.';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'crm_can_write' and n.nspname = 'public') then
    raise exception 'public.crm_can_write() was not found. Run CRM-SETUP.sql first.';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'crm_gaza_date' and n.nspname = 'public') then
    raise exception 'public.crm_gaza_date() was not found. Run the current CRM-SALES-OPS-UPGRADE.sql first (Section 0).';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'crm_import_batch' and n.nspname = 'public') then
    raise exception 'public.crm_import_batch() was not found. Run the current CRM-SALES-OPS-UPGRADE.sql first (Section 8).';
  end if;
end $$;

-- ============================================================================
-- 1. crm_outreach — ONE row per company (1:1), holding the four
--    per-channel outreach statuses plus follow-up scheduling, priority,
--    a client flag, and free-text notes. Deliberately a NEW table rather
--    than more columns bolted onto crm_companies: it keeps crm_companies
--    focused on "who the company is" and this table focused on "where we
--    are with them", and it's the only additive option that doesn't touch
--    the existing table at all.
-- ============================================================================
create table if not exists public.crm_outreach (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.crm_companies(id) on delete cascade,

  email_status text not null default 'not_sent' check (email_status in (
    'not_sent', 'sent', 'opened', 'replied', 'interested', 'not_interested'
  )),
  linkedin_status text not null default 'not_contacted' check (linkedin_status in (
    'not_contacted', 'connection_sent', 'connected', 'message_sent', 'replied'
  )),
  whatsapp_status text not null default 'not_sent' check (whatsapp_status in (
    'not_sent', 'sent', 'read', 'replied'
  )),
  phone_status text not null default 'not_called' check (phone_status in (
    'not_called', 'called', 'follow_up_required'
  )),

  -- "Next Follow-up Date" / "Follow-up Time" / "Reminder" / "Priority".
  -- Time is stored separately from the date because the request lists them
  -- as two distinct fields; the in-app reminder (Section 8 below) fires on
  -- the Gaza CALENDAR DAY matching next_follow_up_date, the same
  -- day-level granularity as every other "due today" notification in this
  -- CRM (task_due_today, meeting_reminder_today) — it does not attempt a
  -- minute-precise alert at next_follow_up_time, which would need a real
  -- background scheduler this project doesn't have (see the v1.2 email
  -- follow-up notes on why: no deploy means no cron).
  next_follow_up_date date,
  next_follow_up_time time,
  reminder_enabled boolean not null default true,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),

  -- "Client" is a distinct business outcome from any single channel's
  -- status (a company can become a client without every channel having
  -- been marked "replied"), so it is its own flag, not derived.
  is_client boolean not null default false,

  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.crm_outreach is 'Basma CRM v1.4 — one row per company: multi-channel outreach status, follow-up scheduling, and notes. No external service is contacted by this table or anything that writes to it.';

drop trigger if exists crm_outreach_set_updated_at on public.crm_outreach;
create trigger crm_outreach_set_updated_at
before update on public.crm_outreach
for each row execute function public.crm_set_updated_at();

create index if not exists crm_outreach_next_follow_up_date_idx on public.crm_outreach (next_follow_up_date);
create index if not exists crm_outreach_priority_idx on public.crm_outreach (priority);
create index if not exists crm_outreach_email_status_idx on public.crm_outreach (email_status);
create index if not exists crm_outreach_linkedin_status_idx on public.crm_outreach (linkedin_status);
create index if not exists crm_outreach_whatsapp_status_idx on public.crm_outreach (whatsapp_status);
create index if not exists crm_outreach_phone_status_idx on public.crm_outreach (phone_status);
create index if not exists crm_outreach_is_client_idx on public.crm_outreach (is_client);

alter table public.crm_outreach enable row level security;
revoke all on public.crm_outreach from anon, authenticated;
-- No delete grant on purpose: a crm_outreach row only ever disappears via
-- its company's ON DELETE CASCADE — there is no direct "delete the
-- outreach record but keep the company" use case, so no delete policy
-- exists (mirrors "notifications are never deleted directly" from v1.2).
grant select, insert, update on public.crm_outreach to authenticated;

drop policy if exists crm_outreach_select on public.crm_outreach;
create policy crm_outreach_select on public.crm_outreach
for select to authenticated
using (public.crm_can_read());

drop policy if exists crm_outreach_insert on public.crm_outreach;
create policy crm_outreach_insert on public.crm_outreach
for insert to authenticated
with check (public.crm_can_write());

drop policy if exists crm_outreach_update on public.crm_outreach;
create policy crm_outreach_update on public.crm_outreach
for update to authenticated
using (public.crm_can_write())
with check (public.crm_can_write());

-- Backfill: every company that already existed before this migration
-- (including the batch you already imported) gets a default outreach row
-- now, so the app never has to special-case "no outreach row yet".
insert into public.crm_outreach (company_id)
select id from public.crm_companies
on conflict (company_id) do nothing;

-- From now on, every NEW company automatically gets one too.
create or replace function public.crm_create_outreach_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.crm_outreach (company_id) values (new.id)
  on conflict (company_id) do nothing;
  return new;
end;
$$;

drop trigger if exists crm_companies_create_outreach on public.crm_companies;
create trigger crm_companies_create_outreach
after insert on public.crm_companies
for each row execute function public.crm_create_outreach_row();

-- ============================================================================
-- 2. crm_outreach_templates — reusable Email / LinkedIn / WhatsApp /
--    Proposal / Meeting message templates. Plain text storage only; no
--    external service is involved in creating, editing, or "sending" one
--    (there is no send action at all yet — see the v1.4 report).
-- ============================================================================
create table if not exists public.crm_outreach_templates (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('email', 'linkedin', 'whatsapp', 'proposal', 'meeting')),
  name text not null check (char_length(btrim(name)) > 0),
  subject text,
  body text not null check (char_length(btrim(body)) > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists crm_outreach_templates_set_updated_at on public.crm_outreach_templates;
create trigger crm_outreach_templates_set_updated_at
before update on public.crm_outreach_templates
for each row execute function public.crm_set_updated_at();

create index if not exists crm_outreach_templates_type_idx on public.crm_outreach_templates (type);

alter table public.crm_outreach_templates enable row level security;
revoke all on public.crm_outreach_templates from anon, authenticated;
grant select, insert, update, delete on public.crm_outreach_templates to authenticated;

drop policy if exists crm_outreach_templates_select on public.crm_outreach_templates;
create policy crm_outreach_templates_select on public.crm_outreach_templates
for select to authenticated
using (public.crm_can_read());

drop policy if exists crm_outreach_templates_insert on public.crm_outreach_templates;
create policy crm_outreach_templates_insert on public.crm_outreach_templates
for insert to authenticated
with check (public.crm_can_write());

drop policy if exists crm_outreach_templates_update on public.crm_outreach_templates;
create policy crm_outreach_templates_update on public.crm_outreach_templates
for update to authenticated
using (public.crm_can_write())
with check (public.crm_can_write());

-- Delete is admin-only, matching every other table's delete policy in this
-- project (crm_companies, crm_leads, etc. — see CRM-SETUP.sql Section 11).
drop policy if exists crm_outreach_templates_delete on public.crm_outreach_templates;
create policy crm_outreach_templates_delete on public.crm_outreach_templates
for delete to authenticated
using (coalesce(public.is_admin(), false));

-- ============================================================================
-- 3. crm_activities.activity_type — widen the existing CHECK constraint to
--    add 'linkedin' and 'company_imported'. This is the ONE necessary
--    modification to an existing table in this migration: the alternative
--    (a brand-new parallel "outreach timeline" table) would duplicate both
--    the storage AND the rendering logic that company-details.html /
--    lead-details.html already have for crm_activities — reusing this
--    table means the Outreach card's status changes show up in the
--    EXISTING timeline for free, with zero new timeline code.
-- ============================================================================
alter table public.crm_activities drop constraint if exists crm_activities_activity_type_check;
alter table public.crm_activities add constraint crm_activities_activity_type_check
  check (activity_type in (
    'note', 'call', 'email', 'whatsapp', 'meeting', 'follow_up', 'status_change', 'proposal',
    'linkedin', 'company_imported'
  ));

-- ============================================================================
-- 4. crm_notifications.type — widen to add 'outreach_followup_due'.
-- ============================================================================
alter table public.crm_notifications drop constraint if exists crm_notifications_type_check;
alter table public.crm_notifications add constraint crm_notifications_type_check
  check (type in (
    'lead_new_website', 'lead_new_booking', 'lead_new_manual',
    'meeting_scheduled', 'meeting_reminder_24h', 'meeting_reminder_today',
    'task_due_today', 'task_overdue',
    'proposal_created', 'proposal_status_changed',
    'lead_stage_changed', 'lead_won', 'lead_lost',
    'lead_no_activity_3d', 'lead_inactive_7d',
    'whatsapp_logged',
    'outreach_followup_due'
  ));

-- ============================================================================
-- 5. crm_outreach_dashboard_snapshot() — the Outreach Hub's KPI + chart
--    data in one call, same shape/spirit as crm_dashboard_snapshot() from
--    CRM-SALES-OPS-UPGRADE.sql: one small jsonb payload, security invoker
--    so RLS still applies per user, no client-side full-table scans.
-- ============================================================================
create or replace function public.crm_outreach_dashboard_snapshot()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'kpis', jsonb_build_object(
      'total_companies', (select count(*) from public.crm_companies),
      -- "Contacted": at least one channel has moved off its default state.
      'contacted', (
        select count(*) from public.crm_outreach
        where email_status <> 'not_sent' or linkedin_status <> 'not_contacted'
           or whatsapp_status <> 'not_sent' or phone_status <> 'not_called'
      ),
      -- "Waiting Reply": contacted on some channel, but no channel has a
      -- reply yet and email hasn't been marked interested/not interested.
      'waiting_reply', (
        select count(*) from public.crm_outreach
        where (email_status <> 'not_sent' or linkedin_status <> 'not_contacted'
               or whatsapp_status <> 'not_sent' or phone_status <> 'not_called')
          and email_status not in ('replied', 'interested', 'not_interested')
          and linkedin_status <> 'replied'
          and whatsapp_status <> 'replied'
      ),
      'replied', (
        select count(*) from public.crm_outreach
        where email_status = 'replied' or linkedin_status = 'replied' or whatsapp_status = 'replied'
      ),
      'interested', (select count(*) from public.crm_outreach where email_status = 'interested'),
      'meetings', (select count(*) from public.crm_meetings where company_id is not null),
      'proposals', (select count(*) from public.crm_proposals where company_id is not null),
      'clients', (select count(*) from public.crm_outreach where is_client = true)
    ),
    'by_email_status', (
      select coalesce(jsonb_agg(x order by x.count desc), '[]'::jsonb)
      from (select email_status as status, count(*) as count from public.crm_outreach group by email_status) x
    ),
    'by_linkedin_status', (
      select coalesce(jsonb_agg(x order by x.count desc), '[]'::jsonb)
      from (select linkedin_status as status, count(*) as count from public.crm_outreach group by linkedin_status) x
    ),
    'by_whatsapp_status', (
      select coalesce(jsonb_agg(x order by x.count desc), '[]'::jsonb)
      from (select whatsapp_status as status, count(*) as count from public.crm_outreach group by whatsapp_status) x
    ),
    'by_phone_status', (
      select coalesce(jsonb_agg(x order by x.count desc), '[]'::jsonb)
      from (select phone_status as status, count(*) as count from public.crm_outreach group by phone_status) x
    ),
    'by_industry', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select coalesce(industry, 'غير محدد') as label, count(*) as count
        from public.crm_companies group by 1 order by count(*) desc limit 8
      ) x
    ),
    'by_country', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select coalesce(country, 'غير محدد') as label, count(*) as count
        from public.crm_companies group by 1 order by count(*) desc limit 8
      ) x
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.crm_outreach_dashboard_snapshot() to authenticated;

-- ============================================================================
-- 6. crm_refresh_time_based_notifications() — CREATE OR REPLACE with one
--    new block appended (outreach follow-ups due today, Gaza-local). Every
--    line above the new block is copied unchanged from the current
--    CRM-SALES-OPS-UPGRADE.sql definition so nothing from the timezone-
--    hardening pass is lost by this redefinition.
-- ============================================================================
create or replace function public.crm_refresh_time_based_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gaza_today_start timestamptz := public.crm_gaza_day_start();
  v_gaza_tomorrow_start timestamptz := public.crm_gaza_day_start(public.crm_gaza_date(now()) + 1);
begin
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

  insert into public.crm_notifications (type, title, description, lead_id, company_id, link, dedupe_key)
  select 'task_overdue', 'مهمة متأخرة', t.title, t.lead_id, t.company_id,
    case when t.lead_id is not null then '/crm/lead-details.html?id=' || t.lead_id else '/crm/tasks.html' end,
    'task_overdue:' || t.id
  from public.crm_tasks t
  where t.status not in ('completed', 'cancelled')
    and t.due_at is not null
    and t.due_at < now()
  on conflict (dedupe_key) do nothing;

  insert into public.crm_notifications (type, title, description, lead_id, company_id, link, dedupe_key)
  select 'meeting_reminder_24h', 'اجتماع خلال 24 ساعة', m.title, m.lead_id, m.company_id,
    case when m.lead_id is not null then '/crm/lead-details.html?id=' || m.lead_id else '/crm/meetings.html' end,
    'meeting_reminder_24h:' || m.id
  from public.crm_meetings m
  where m.status = 'scheduled'
    and m.scheduled_at >= now()
    and m.scheduled_at <= now() + interval '24 hours'
  on conflict (dedupe_key) do nothing;

  insert into public.crm_notifications (type, title, description, lead_id, company_id, link, dedupe_key)
  select 'meeting_reminder_today', 'اجتماع اليوم', m.title, m.lead_id, m.company_id,
    case when m.lead_id is not null then '/crm/lead-details.html?id=' || m.lead_id else '/crm/meetings.html' end,
    'meeting_reminder_today:' || m.id
  from public.crm_meetings m
  where m.status = 'scheduled'
    and m.scheduled_at >= v_gaza_today_start
    and m.scheduled_at < v_gaza_tomorrow_start
  on conflict (dedupe_key) do nothing;

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

  -- NEW (v1.4): Outreach follow-ups due today, Gaza-local calendar day —
  -- same day-level granularity as task_due_today/meeting_reminder_today
  -- above, not a minute-precise alert (see crm_outreach's next_follow_up_time
  -- comment for why). Respects reminder_enabled so a user can silence a
  -- specific follow-up without clearing its date. Fires once per
  -- (company, date) — changing the date to a new value is a fresh reminder.
  insert into public.crm_notifications (type, title, description, company_id, link, dedupe_key)
  select 'outreach_followup_due', 'موعد متابعة تواصل اليوم', co.name, o.company_id,
    '/crm/company-details.html?id=' || o.company_id,
    'outreach_followup_due:' || o.company_id || ':' || o.next_follow_up_date::text
  from public.crm_outreach o
  join public.crm_companies co on co.id = o.company_id
  where o.reminder_enabled = true
    and o.next_follow_up_date is not null
    and o.next_follow_up_date = public.crm_gaza_date(now())
  on conflict (dedupe_key) do nothing;
end;
$$;

-- ============================================================================
-- 7. crm_import_batch() — CREATE OR REPLACE with ONE addition: log a
--    'company_imported' activity when a row's action is 'create' (never on
--    'update' — updating an existing company via CSV is not "importing" a
--    new one). This is the only change to this function; everything else,
--    including the atomicity guarantees and the jsonb-null fix, is
--    unchanged from CRM-SALES-OPS-UPGRADE.sql Section 8.
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

      -- NEW (v1.4): timeline entry, reusing crm_activities (see Section 3
      -- above for why this doesn't need a new table). Note: crm_outreach's
      -- own AFTER INSERT trigger (Section 1) also fires here automatically
      -- to give this company its default outreach row — same transaction,
      -- same atomicity guarantee as everything else in this function.
      insert into public.crm_activities (company_id, activity_type, subject)
      values (v_company_id, 'company_imported', 'تم استيراد الشركة عبر CSV');
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
-- 8. crm_outreach_bulk_add_note() — backs the Outreach Hub's "Add Note"
--    bulk action. Interpreted the same way notes work everywhere else in
--    this CRM (e.g. lead-details.html's edit-form note field): a note is
--    logged as a crm_activities timeline entry per company, NOT written
--    into crm_outreach.notes — overwriting one shared free-text field
--    across many different companies at once would destroy whatever each
--    company's notes already said. One RPC call = one transaction, so a
--    bulk note either lands on every selected company or none of them.
-- ============================================================================
create or replace function public.crm_outreach_bulk_add_note(p_company_ids uuid[], p_note text)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if not public.crm_can_write() then
    raise exception 'insufficient_privilege: current user cannot write to the CRM';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'empty_note: note text is required';
  end if;

  insert into public.crm_activities (company_id, activity_type, subject, details)
  select id, 'note', 'ملاحظة جماعية (Outreach Hub)', p_note
  from public.crm_companies
  where id = any(p_company_ids);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.crm_outreach_bulk_add_note(uuid[], text) to authenticated;

-- ============================================================================
-- End of migration. Not executed against the live database by the
-- assistant — run this in the Supabase SQL editor when ready.
-- ============================================================================
