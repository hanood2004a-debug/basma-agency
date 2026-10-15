-- ============================================================================
-- CRM-INSPECT-TEST-DATA.sql — READ-ONLY inspection for the pre-outreach
-- test-data cleanup. Every statement below is a SELECT. Nothing is deleted,
-- updated, or altered by this file. Safe to run as-is in the Supabase SQL
-- editor (or via psql) with your normal admin/service-role connection.
--
-- Purpose: surface every row in the business tables so a human (you) can
-- decide, category by category, what's real vs. test/demo/experimental
-- before Claude drafts CRM-CLEAN-TEST-DATA.sql. Nothing here is deleted
-- automatically and nothing here should be treated as a final verdict —
-- the "likely_test" flags are heuristics (name/subject pattern matches),
-- not certainty.
--
-- IMPORTANT CONTEXT for reading these results: the public website's contact
-- form and the appointment-booking widget are BOTH wired live into this CRM
-- (crm_leads.source = 'Website' / 'Website Booking', and the public
-- `appointments` table). If the site has been publicly reachable at any
-- point, some of these could be genuine visitor inquiries, not your own
-- test submissions. Do NOT let Claude auto-classify anything sourced this
-- way as "safe to delete" — it will only ever be flagged UNCERTAIN, for you
-- to eyeball individually by name/phone/date.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Row counts — quick sanity check across every table in scope.
-- ----------------------------------------------------------------------------
select 'crm_companies' as table_name, count(*) from public.crm_companies
union all select 'crm_contacts', count(*) from public.crm_contacts
union all select 'crm_leads', count(*) from public.crm_leads
union all select 'crm_tasks', count(*) from public.crm_tasks
union all select 'crm_meetings', count(*) from public.crm_meetings
union all select 'crm_proposals', count(*) from public.crm_proposals
union all select 'crm_proposal_items', count(*) from public.crm_proposal_items
union all select 'crm_activities', count(*) from public.crm_activities
union all select 'crm_notifications', count(*) from public.crm_notifications
union all select 'appointments', count(*) from public.appointments;

-- ----------------------------------------------------------------------------
-- 1. Companies — flagged by name/website/email pattern.
-- ----------------------------------------------------------------------------
select
  id, name, website, email, phone, industry, country, city, created_at,
  (
    name ~* '(test|demo|sample|dummy|fake|xxx|asdf|تجرب|اختبار|تجريبي|تست)'
    or website ~* '(example\.com|test\.com|localhost)'
    or email ~* '(example\.com|test\.com|@test\.|\+test)'
  ) as likely_test
from public.crm_companies
order by created_at desc;

-- ----------------------------------------------------------------------------
-- 2. Contacts — flagged by name/email pattern, plus which company they sit under.
-- ----------------------------------------------------------------------------
select
  c.id, c.full_name, c.email, c.phone, c.whatsapp, c.company_id, co.name as company_name,
  c.created_at,
  (
    c.full_name ~* '(test|demo|sample|dummy|fake|xxx|asdf|تجرب|اختبار|تجريبي|تست)'
    or c.email ~* '(example\.com|test\.com|@test\.|\+test)'
  ) as likely_test
from public.crm_contacts c
left join public.crm_companies co on co.id = c.company_id
order by c.created_at desc;

-- ----------------------------------------------------------------------------
-- 3. Leads — flagged by title/service_interest pattern AND by source.
--    Website / Website Booking leads are called out separately: these came
--    through the live public forms, so a name/pattern match is not enough
--    to trust — review by name/phone/date yourself.
-- ----------------------------------------------------------------------------
select
  l.id, l.title, l.source, l.service_interest, l.stage, l.status, l.estimated_value, l.currency,
  l.company_id, co.name as company_name, l.contact_id, ct.full_name as contact_name,
  l.created_at,
  (
    l.title ~* '(test|demo|sample|dummy|fake|xxx|asdf|تجرب|اختبار|تجريبي|تست)'
    or coalesce(l.service_interest, '') ~* '(test|demo|تجرب|اختبار)'
  ) as likely_test_by_name,
  (l.source in ('Website', 'Website Booking')) as came_from_live_public_form
from public.crm_leads l
left join public.crm_companies co on co.id = l.company_id
left join public.crm_contacts ct on ct.id = l.contact_id
order by l.created_at desc;

-- ----------------------------------------------------------------------------
-- 4. Tasks — flagged by title pattern AND whether they're an auto-generated
--    follow-up task (title always starts with 'متابعة العميل: ' — see
--    CRM-AUTO-FOLLOWUP-TASKS.sql) tied to a lead, since those should follow
--    whatever verdict you reach on the parent lead, not be judged alone.
-- ----------------------------------------------------------------------------
select
  t.id, t.title, t.status, t.priority, t.due_at, t.lead_id, l.title as lead_title,
  t.company_id, co.name as company_name, t.created_at,
  (t.title like 'متابعة العميل: %') as is_auto_followup_task,
  (
    t.title ~* '(test|demo|sample|dummy|fake|xxx|asdf|تجرب|اختبار|تجريبي|تست)'
  ) as likely_test_by_name
from public.crm_tasks t
left join public.crm_leads l on l.id = t.lead_id
left join public.crm_companies co on co.id = t.company_id
order by t.created_at desc;

-- ----------------------------------------------------------------------------
-- 5. Meetings — flagged by title pattern, with parent lead/company shown.
-- ----------------------------------------------------------------------------
select
  m.id, m.title, m.meeting_type, m.status, m.scheduled_at,
  m.lead_id, l.title as lead_title, m.company_id, co.name as company_name,
  m.created_at,
  (
    m.title ~* '(test|demo|sample|dummy|fake|xxx|asdf|تجرب|اختبار|تجريبي|تست)'
  ) as likely_test_by_name
from public.crm_meetings m
left join public.crm_leads l on l.id = m.lead_id
left join public.crm_companies co on co.id = m.company_id
order by m.created_at desc;

-- ----------------------------------------------------------------------------
-- 6. Proposals — flagged by title/proposal_number pattern, with item counts.
--    Note: crm_proposals.lead_id / company_id are ON DELETE SET NULL, not
--    CASCADE — deleting a test lead/company will NOT remove its proposals
--    automatically. Proposals must be deleted explicitly.
-- ----------------------------------------------------------------------------
select
  p.id, p.proposal_number, p.title, p.status, p.total, p.currency,
  p.lead_id, l.title as lead_title, p.company_id, co.name as company_name,
  p.created_at,
  (select count(*) from public.crm_proposal_items pi where pi.proposal_id = p.id) as item_count,
  (
    p.title ~* '(test|demo|sample|dummy|fake|xxx|asdf|تجرب|اختبار|تجريبي|تست)'
  ) as likely_test_by_name
from public.crm_proposals p
left join public.crm_leads l on l.id = p.lead_id
left join public.crm_companies co on co.id = p.company_id
order by p.created_at desc;

-- ----------------------------------------------------------------------------
-- 7. Activities — flagged by subject/details pattern, with parent shown.
--    activity_type shows whether it's a WhatsApp/Email/Call/Note entry.
-- ----------------------------------------------------------------------------
select
  a.id, a.activity_type, a.subject, a.details,
  a.lead_id, l.title as lead_title, a.company_id, co.name as company_name,
  a.activity_at, a.created_at,
  (
    a.subject ~* '(test|demo|sample|dummy|fake|xxx|asdf|تجرب|اختبار|تجريبي|تست)'
    or coalesce(a.details, '') ~* '(test|demo|تجرب|اختبار)'
  ) as likely_test_by_name
from public.crm_activities a
left join public.crm_leads l on l.id = a.lead_id
left join public.crm_companies co on co.id = a.company_id
order by a.created_at desc;

-- ----------------------------------------------------------------------------
-- 8. Notifications — flagged by title/description pattern, plus whether the
--    lead/company it points to still exists (a notification whose target
--    was already deleted is effectively dead regardless of naming).
-- ----------------------------------------------------------------------------
select
  n.id, n.type, n.title, n.description, n.link, n.is_read,
  n.lead_id, n.company_id, n.created_at,
  (n.lead_id is not null and not exists (select 1 from public.crm_leads l where l.id = n.lead_id)) as lead_target_missing,
  (n.company_id is not null and not exists (select 1 from public.crm_companies co where co.id = n.company_id)) as company_target_missing,
  (
    n.title ~* '(test|demo|تجرب|اختبار)'
    or coalesce(n.description, '') ~* '(test|demo|تجرب|اختبار)'
  ) as likely_test_by_name
from public.crm_notifications n
order by n.created_at desc;

-- ----------------------------------------------------------------------------
-- 9. Appointments — the public booking table. RLS revokes ALL access from
--    anon/authenticated (service-role only), so this section will only
--    return rows if you're running this with the service-role connection.
-- ----------------------------------------------------------------------------
select
  id, name, whatsapp, service, appointment_date, appointment_time, status,
  booking_reference, created_at,
  (
    name ~* '(test|demo|sample|dummy|fake|xxx|asdf|تجرب|اختبار|تجريبي|تست)'
  ) as likely_test_by_name
from public.appointments
order by created_at desc;

-- ============================================================================
-- End of read-only inspection. Share the output (or a summary/export of it)
-- back so the categorized SAFE / UNCERTAIN / KEEP report and
-- CRM-CLEAN-TEST-DATA.sql can be built from real data, not guesses.
-- ============================================================================
