-- ============================================================================
-- Basma CRM — OPTIONAL demo seed data
-- ============================================================================
-- DO NOT run this against production unless you explicitly want sample rows
-- to click through while trying the CRM UI. This script is NOT executed
-- automatically by anything — you must run it yourself, on purpose.
--
-- Every row inserted here is clearly a "Demo" record (company/lead titles are
-- prefixed with "[DEMO]") so it is obvious and easy to find/delete later:
--
--   delete from public.crm_leads where title like '[DEMO]%';
--   delete from public.crm_companies where name like '[DEMO]%';
--
-- Run CRM-SETUP.sql first — this script assumes all crm_* tables exist.
-- ============================================================================

with demo_company as (
  insert into public.crm_companies (name, website, country, city, industry, phone, email)
  values ('[DEMO] شركة نموذجية للتجارة', 'https://example.com', 'فلسطين', 'رام الله', 'تجارة إلكترونية', '+970590000000', 'demo@example.com')
  returning id
),
demo_contact as (
  insert into public.crm_contacts (company_id, full_name, job_title, email, phone, is_primary)
  select id, '[DEMO] أحمد العميل', 'مدير التسويق', 'contact@example.com', '+970590000001', true
  from demo_company
  returning id, company_id
)
insert into public.crm_leads (
  company_id, contact_id, title, source, service_interest, country,
  estimated_value, currency, priority, stage, next_follow_up_at
)
select
  demo_contact.company_id, demo_contact.id, '[DEMO] موقع إلكتروني + هوية بصرية',
  'website', 'تطوير مواقع', 'فلسطين', 2500, 'USD', 'high', 'contacted',
  now() + interval '2 days'
from demo_contact;

-- A second demo lead not tied to a company, to exercise the "no company"
-- empty-state path in Leads/Pipeline.
insert into public.crm_leads (title, source, service_interest, country, estimated_value, priority, stage)
values ('[DEMO] استشارة تسويق رقمي', 'referral', 'تسويق رقمي', 'الإمارات', 800, 'medium', 'new');
