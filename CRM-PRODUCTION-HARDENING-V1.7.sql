-- ============================================================================
-- Basma CRM v1.7 — Production Hardening Pass
-- ============================================================================
-- ONE new, purely-additive, fully-idempotent migration consolidating every
-- schema-level fix from the v1.7 production audit. Safe to run multiple
-- times: every CREATE TABLE/COLUMN uses IF NOT EXISTS, every function
-- replacement uses CREATE OR REPLACE (never DROP FUNCTION), every trigger
-- uses DROP TRIGGER IF EXISTS immediately before its CREATE TRIGGER. There
-- is NO DROP TABLE, DROP COLUMN, DELETE, or TRUNCATE anywhere in this file.
-- Not executed against the live database by the assistant — run this in the
-- Supabase SQL editor when ready, same as every previous migration in this
-- project.
--
-- PRECONDITION: CRM-SETUP.sql, CRM-AUTO-FOLLOWUP-TASKS.sql,
-- CRM-SALES-OPS-UPGRADE.sql, CRM-COMPANY-360.sql, CRM-OUTREACH-HUB.sql,
-- CRM-OUTREACH-AUTOMATION.sql already run.
-- ============================================================================

do $$
begin
  if not exists (select 1 from information_schema.routines where routine_schema = 'public' and routine_name = 'crm_import_batch') then
    raise exception 'public.crm_import_batch() was not found. Run CRM-OUTREACH-HUB.sql first.';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'crm_tasks') then
    raise exception 'public.crm_tasks was not found. Run CRM-SETUP.sql first.';
  end if;
end $$;

-- ============================================================================
-- 1. CSV import must NOT create sales Leads by default (audit item #1).
-- ============================================================================
-- Root cause: crm_import_batch()'s p_options.create_leads fallback defaulted
-- to `true` when the caller omitted it, AND import-companies.html's
-- "إنشاء Leads" checkbox defaulted to checked and always passed an explicit
-- value — so every CSV import silently created a crm_leads row per company
-- (source = 'CSV Import'), plus that row's own AFTER INSERT trigger from
-- CRM-AUTO-FOLLOWUP-TASKS.sql then auto-created a 24h follow-up task for a
-- "lead" nobody had actually engaged with yet.
--
-- Primary fix (already applied, no schema involved): import-companies.html's
-- checkbox now defaults to UNCHECKED.
--
-- This is the defense-in-depth half of the same fix, at the database layer:
-- if create_leads is ever omitted entirely (e.g. a future caller, or a
-- direct RPC call from the SQL editor), the function itself now defaults to
-- NOT creating a Lead, matching the desired behavior ("importing a company
-- for outbound outreach must NOT automatically create a sales Lead unless
-- there is explicit intentional conversion"). Passing create_leads: true
-- explicitly (as the checkbox still allows, when a user deliberately wants
-- it) is completely unaffected — this only changes what happens when the
-- caller says nothing at all.
--
-- Byte-for-byte identical to the CRM-OUTREACH-HUB.sql Section 7 definition
-- except for that one `coalesce(..., true)` -> `coalesce(..., false)` on
-- v_create_leads. Every other line — atomicity, the company_imported
-- activity log, contact creation, RLS check — is unchanged.
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
  -- CHANGED (v1.7): default flipped from true to false. See comment block
  -- above — this is the one substantive change in this whole function.
  v_create_leads boolean := coalesce((p_options->>'create_leads')::boolean, false);
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

-- Rollback guidance for Section 1: to restore the old (not recommended)
-- "default to creating Leads" behavior, re-run this same CREATE OR REPLACE
-- with v_create_leads's coalesce(...) fallback changed back to `true`. No
-- data was altered by this section, so there is nothing to undo besides the
-- function body itself.

-- ============================================================================
-- 2. Reminder-email dedup ledger (audit items #3 mass-email flood and #4
--    raw UUID in timeline).
-- ============================================================================
-- Root cause: api/_notify.js's overdue-task / meeting reminder emails used
-- to (a) send one Resend email PER item instead of one digest per run, and
-- (b) record their dedup marker as a crm_activities row whose subject text
-- embedded the raw task/meeting UUID — and crm_activities feeds the Lead
-- Details timeline directly, so that raw UUID was shown to users verbatim.
--
-- Fix: two new nullable columns act as a proper, purely-internal dedup
-- ledger. api/_notify.js (already rewritten) now queries
-- "reminder_sent_at IS NULL", sends ONE digest email per run for
-- everything it finds, and stamps reminder_sent_at on every included row
-- in one batch UPDATE — after which that row can never trigger another
-- reminder. Nothing is ever written to crm_activities for this event type
-- anymore, so no raw UUID can reach the timeline through this path again.
alter table public.crm_tasks add column if not exists reminder_sent_at timestamptz;
alter table public.crm_meetings add column if not exists reminder_sent_at timestamptz;

create index if not exists crm_tasks_reminder_pending_idx on public.crm_tasks (due_at)
  where reminder_sent_at is null and status not in ('completed', 'cancelled');
create index if not exists crm_meetings_reminder_pending_idx on public.crm_meetings (scheduled_at)
  where reminder_sent_at is null and status = 'scheduled';

-- Rollback guidance for Section 2: both columns are nullable with no
-- default-value backfill requirement and nothing else references them, so
-- `alter table public.crm_tasks drop column if exists reminder_sent_at;`
-- (and the equivalent for crm_meetings) would fully revert this section if
-- ever needed. Not run here — additive only, per the project's migration
-- convention.

-- ============================================================================
-- 3. Website contact-form rate limiting (audit item #5 — website lead spam).
-- ============================================================================
-- api/contact-lead.js already dedupes by contact email (an existing open
-- Website lead within 24h is reused, not duplicated) — but that alone does
-- nothing against a bot rotating through random/fake email addresses. This
-- table is a lightweight, purely-internal rate-limit ledger keyed by a
-- SHA-256 hash of the submitter's IP (never the raw IP — no reason to keep
-- that around once the hash is computed), used ONLY by api/contact-lead.js
-- via the service-role key. Not surfaced in any CRM UI. RLS is enabled with
-- zero grants to anon/authenticated, matching this project's convention for
-- tables that must be completely unreachable from the browser.
create table if not exists public.crm_website_submission_log (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists crm_website_submission_log_ip_created_idx
  on public.crm_website_submission_log (ip_hash, created_at desc);

-- Old rows have zero ongoing value once outside any realistic rate-limit
-- window — this index makes a periodic manual cleanup
-- ("delete from crm_website_submission_log where created_at < now() -
-- interval '7 days'") cheap, if Basma ever wants to run one. No such
-- delete is included in this migration (no destructive statements here).
create index if not exists crm_website_submission_log_created_at_idx
  on public.crm_website_submission_log (created_at);

alter table public.crm_website_submission_log enable row level security;
revoke all on public.crm_website_submission_log from anon, authenticated;
-- Deliberately NO policies at all: this table is written/read exclusively
-- via the service-role key from api/contact-lead.js, which bypasses RLS
-- entirely (see Section 11 of the v1.7 report for why that is the correct,
-- pre-existing pattern for a public, unauthenticated endpoint). No CRM
-- user, however privileged, can query this table through the normal
-- Supabase client — it is not meant to be, and should not become, a UI
-- feature.

-- Rollback guidance for Section 3: `drop table if exists
-- public.crm_website_submission_log;` would fully revert this section —
-- nothing else references this table. Not run here.

-- ============================================================================
-- 4. Resend delivery/bounce status (audit item #7).
-- ============================================================================
-- Before this section, crm_outreach_messages.status could only ever be
-- 'sent' (accepted by Resend) or 'failed' (rejected at send time) — there
-- was no way to represent what happened to an email AFTER Resend accepted
-- it: actually delivered, hard-bounced, or reported as spam. This widens
-- the status vocabulary (additive — every existing row's status value
-- already satisfies the new, broader constraint, so no data migration is
-- needed) and adds one nullable timestamp so a human can see when the
-- provider-reported status last changed. A new endpoint,
-- api/resend-webhook.js, receives Resend's webhook events and writes these
-- statuses; see the v1.7 report for the full explanation, including why
-- 'suppressed' is deliberately modeled on crm_contacts (already existed,
-- already enforced at send-time by api/crm-send-email.js) rather than as a
-- crm_outreach_messages status value.
alter table public.crm_outreach_messages drop constraint if exists crm_outreach_messages_status_check;
alter table public.crm_outreach_messages add constraint crm_outreach_messages_status_check
  check (status in ('sent', 'failed', 'completed', 'delivered', 'bounced', 'complained'));

alter table public.crm_outreach_messages drop constraint if exists crm_outreach_messages_channel_status_chk;
alter table public.crm_outreach_messages add constraint crm_outreach_messages_channel_status_chk check (
  (channel = 'phone' and status = 'completed')
  or (channel <> 'phone' and status in ('sent', 'failed', 'delivered', 'bounced', 'complained'))
);

alter table public.crm_outreach_messages add column if not exists provider_status_updated_at timestamptz;

create index if not exists crm_outreach_messages_provider_message_id_idx
  on public.crm_outreach_messages (provider_message_id) where provider_message_id is not null;

-- Rollback guidance for Section 4: restore the original two-value
-- constraints with the same drop/add pattern used above (swap the widened
-- check() bodies back to their pre-v1.7 form); `alter table
-- public.crm_outreach_messages drop column if exists
-- provider_status_updated_at;` reverts the column. No existing data is
-- altered by adding this section, so a rollback only removes the new
-- capability, not any information — except that any row a webhook already
-- updated to 'delivered'/'bounced'/'complained' would then violate the
-- restored, narrower constraint; such rows would need to be reset to
-- 'sent' first if this section is ever rolled back after being used in
-- production.
