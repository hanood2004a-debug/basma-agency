-- ============================================================================
-- Basma CRM — CSV-Import Lead Report (read-only, optional)
-- ============================================================================
-- Purpose: identify crm_leads rows that were likely created unintentionally
-- by CSV company imports (source = 'CSV Import'), before the fix in
-- CRM-PRODUCTION-HARDENING-V1.7.sql / import-companies.html that turns
-- "إنشاء Leads" off by default for future imports.
--
-- THIS FILE IS 100% READ-ONLY. It contains SELECT statements only — no
-- INSERT/UPDATE/DELETE/DROP/TRUNCATE anywhere. It does not touch, close,
-- reassign, or delete a single row. Safe to run in the Supabase SQL editor
-- at any time, any number of times, with zero side effects.
--
-- What "likely unintentional" means here: a CSV Import lead where the ONLY
-- activity on record is the automatic import note (or nothing at all) —
-- i.e. no human has ever logged a call, sent an email/WhatsApp/LinkedIn
-- message, added a manual note, or changed its stage away from "new". A
-- lead that already has real engagement is excluded, since converting a
-- CSV-imported company into a real opportunity is exactly the "explicit
-- intentional conversion" the desired behavior allows.
--
-- After reviewing the results, it is entirely up to you (Basma) whether to:
--   a) leave them as-is (no action required — nothing is broken by their
--      existence, they just show up in Leads/Pipeline lists);
--   b) manually change their `source` field, delete them individually via
--      the CRM UI (which correctly unlinks/cascades everything), or bulk
--      -update `stage`/`status` to 'lost' to get them out of active views;
--   c) something else entirely — this report does not prescribe an action.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Summary counts.
-- ----------------------------------------------------------------------------
select
  count(*) filter (where source = 'CSV Import')                                   as total_csv_import_leads,
  count(*) filter (where source = 'CSV Import' and stage = 'new')                 as still_in_new_stage,
  count(*) filter (
    where source = 'CSV Import'
      and not exists (
        select 1 from public.crm_activities a
        where a.lead_id = crm_leads.id
          and not (a.activity_type = 'note' and a.subject = 'ملاحظة الاستيراد')
      )
  ) as with_zero_real_activity
from public.crm_leads;

-- ----------------------------------------------------------------------------
-- 2. Detailed row-by-row report: every CSV Import lead, whether it has any
--    real (non-import-note) activity, its current stage/status, how many
--    auto follow-up tasks it spawned, and how old it is. Order puts the
--    "most likely accidental" (zero real activity, still in 'new') first.
-- ----------------------------------------------------------------------------
select
  l.id                                                as lead_id,
  l.title                                             as lead_title,
  c.name                                               as company_name,
  l.stage,
  l.status,
  l.created_at,
  (
    select count(*) from public.crm_activities a
    where a.lead_id = l.id
      and not (a.activity_type = 'note' and a.subject = 'ملاحظة الاستيراد')
  ) as real_activity_count,
  (
    select count(*) from public.crm_tasks t
    where t.lead_id = l.id and t.title ilike 'متابعة العميل:%'
  ) as auto_followup_task_count,
  (
    select count(*) from public.crm_tasks t
    where t.lead_id = l.id and t.title ilike 'متابعة العميل:%'
      and t.status not in ('completed', 'cancelled') and t.due_at < now()
  ) as overdue_auto_followup_task_count
from public.crm_leads l
left join public.crm_companies c on c.id = l.company_id
where l.source = 'CSV Import'
order by
  (case when l.stage = 'new' then 0 else 1 end),
  (select count(*) from public.crm_activities a where a.lead_id = l.id
     and not (a.activity_type = 'note' and a.subject = 'ملاحظة الاستيراد')) asc,
  l.created_at desc;

-- ============================================================================
-- End of report. Nothing above modifies any data.
-- ============================================================================
