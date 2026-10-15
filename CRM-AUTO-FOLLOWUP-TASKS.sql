-- ============================================================================
-- Basma CRM v1.1 — Automatic follow-up task creation
-- ============================================================================
-- Safe to run multiple times: every statement uses CREATE OR REPLACE /
-- DROP TRIGGER IF EXISTS guards, exactly like CRM-SETUP.sql.
--
-- WHAT THIS FILE IS: three PL/pgSQL trigger functions attached to the
-- EXISTING public.crm_leads table. Nothing here creates a table, adds a
-- column, or alters a column on crm_leads, crm_tasks, or crm_activities.
-- Only INSERT/UPDATE/DELETE statements are issued against the existing
-- columns of the existing crm_tasks and crm_activities tables.
--
-- WHY A DATABASE TRIGGER (not application code in api/contact-lead.js /
-- api/book-appointment.js / crm/leads.html): the requirement explicitly
-- covers "any future API endpoint". No amount of editing today's
-- JavaScript files can guarantee that a Lead created by an endpoint that
-- doesn't exist yet will also get a follow-up task — only a trigger on the
-- table itself fires unconditionally for every INSERT into crm_leads,
-- regardless of which client or code path performed it (service-role REST
-- call from a serverless function, or an authenticated browser session
-- inserting directly via supabase-js in crm/leads.html). This is also why
-- ZERO changes were needed in any existing .js/.html file — see the
-- accompanying report for the offline re-verification of those flows.
--
-- PRECONDITION: assumes CRM-SETUP.sql has already been run (crm_leads,
-- crm_tasks, crm_activities, crm_members all already exist).
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'crm_leads'
  ) then
    raise exception 'public.crm_leads was not found. Run CRM-SETUP.sql first, then re-run this file.';
  end if;
end $$;

-- ============================================================================
-- 1. AFTER INSERT on crm_leads — create the follow-up task + activity log.
-- ============================================================================
-- Identification rule used everywhere in this file: an auto-generated
-- follow-up task for a given lead is a row in crm_tasks where
--   lead_id = <that lead's id> AND title LIKE 'متابعة العميل: %'
-- A LIKE-prefix match (not an exact match against the lead's *current*
-- title) is used deliberately so that later steps (won/lost completion,
-- lead deletion) keep recognizing the task correctly even if the lead's
-- title is edited after the task was created.
create or replace function public.crm_create_followup_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_default_sales_user uuid;
  v_existing_task_id uuid;
begin
  v_title := 'متابعة العميل: ' || new.title;

  -- Requirement 2: do not create a duplicate if an open task with this
  -- exact title already exists for this lead. ('open' here means not yet
  -- completed/cancelled — a task that was already finished doesn't count
  -- as a pending duplicate.)
  select id into v_existing_task_id
  from public.crm_tasks
  where lead_id = new.id
    and title = v_title
    and status not in ('completed', 'cancelled')
  limit 1;

  if v_existing_task_id is not null then
    return new;
  end if;

  -- Requirement 1 (assigned user): "default sales user" — crm_members has
  -- no explicit is_default flag (and this file must not add one; see the
  -- report), so the default sales user is defined as the earliest-created
  -- active member with role = 'sales'. If none exists, assigned_to stays
  -- NULL, exactly as required.
  select user_id into v_default_sales_user
  from public.crm_members
  where role = 'sales' and is_active = true
  order by created_at asc
  limit 1;

  insert into public.crm_tasks (
    lead_id, company_id, title, description, priority, status,
    due_at, assigned_to, created_by
  ) values (
    new.id,
    new.company_id,
    v_title,
    'التواصل مع العميل الجديد ومراجعة احتياجاته.',
    'high',
    'pending',
    now() + interval '24 hours',
    v_default_sales_user,
    new.created_by
  );

  -- Requirement 6: activity log entry.
  insert into public.crm_activities (
    lead_id, company_id, contact_id, activity_type, subject, created_by
  ) values (
    new.id,
    new.company_id,
    new.contact_id,
    'follow_up',
    'تم إنشاء مهمة متابعة تلقائياً.',
    new.created_by
  );

  return new;
end;
$$;

drop trigger if exists crm_leads_create_followup_task on public.crm_leads;
create trigger crm_leads_create_followup_task
after insert on public.crm_leads
for each row execute function public.crm_create_followup_task();

-- ============================================================================
-- 2. AFTER UPDATE OF stage on crm_leads — complete the follow-up task when
--    the lead becomes Won or Lost.
-- ============================================================================
-- Hooked on "stage" (not "status") because every existing write path in
-- this project (crm/pipeline.html, crm/lead-details.html) only ever
-- updates crm_leads.stage — crm_leads.status is derived automatically by
-- the pre-existing crm_sync_lead_status trigger from CRM-SETUP.sql, which
-- runs BEFORE this trigger and already sets NEW.status correctly by the
-- time this function runs.
create or replace function public.crm_complete_followup_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('won', 'lost') and old.status is distinct from new.status then
    update public.crm_tasks
    set status = 'completed', completed_at = now()
    where lead_id = new.id
      and title like 'متابعة العميل: %'
      and status not in ('completed', 'cancelled');
  end if;
  return new;
end;
$$;

drop trigger if exists crm_leads_complete_followup_task on public.crm_leads;
create trigger crm_leads_complete_followup_task
after update of stage on public.crm_leads
for each row execute function public.crm_complete_followup_task();

-- ============================================================================
-- 3. BEFORE DELETE on crm_leads — delete only the auto-created follow-up
--    task, never a manually-created one.
-- ============================================================================
-- IMPORTANT existing-schema detail (see report): crm_tasks.lead_id already
-- has "on delete cascade" back to crm_leads (defined in CRM-SETUP.sql, not
-- changed here). Left alone, deleting a Lead would silently delete EVERY
-- task tied to it — manual ones included — which would violate requirement
-- 4. This trigger runs BEFORE that cascade fires and unlinks (lead_id =
-- NULL) every task on this lead that does NOT match the auto-generated
-- title pattern, so those manually-created tasks survive the delete
-- (they simply become unlinked from the now-deleted lead). The one task
-- that DOES match the pattern is left alone and is then removed by the
-- existing cascade exactly as required.
create or replace function public.crm_unlink_manual_tasks_before_lead_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.crm_tasks
  set lead_id = null
  where lead_id = old.id
    and title not like 'متابعة العميل: %';
  return old;
end;
$$;

drop trigger if exists crm_leads_unlink_manual_tasks on public.crm_leads;
create trigger crm_leads_unlink_manual_tasks
before delete on public.crm_leads
for each row execute function public.crm_unlink_manual_tasks_before_lead_delete();

grant execute on function public.crm_create_followup_task() to authenticated;
grant execute on function public.crm_complete_followup_task() to authenticated;
grant execute on function public.crm_unlink_manual_tasks_before_lead_delete() to authenticated;

-- ============================================================================
-- End of migration. Not executed against the live database by the
-- assistant — provided for you to run in the Supabase SQL editor when
-- ready, same as CRM-SETUP.sql and APPOINTMENTS-SETUP.sql were.
-- ============================================================================
