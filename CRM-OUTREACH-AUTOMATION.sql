-- ============================================================================
-- Basma CRM — Unified Outreach Automation (v1.6)
-- ============================================================================
-- One migration for the complete outbound communication workflow: a single
-- channel-agnostic history table (crm_outreach_messages) backing Email,
-- WhatsApp, LinkedIn and Phone alike, a lightweight Campaign concept on top
-- of it, atomic follow-up scheduling, and a unified response/outcome
-- tracker. Nothing here duplicates crm_outreach / crm_activities / crm_tasks
-- — it extends them.
--
-- Every statement is idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP
-- POLICY IF EXISTS) — safe to re-run. Every ALTER TABLE only ADDS a column.
-- CRM-SETUP.sql is not modified.
--
-- Run this once, in full, in the Supabase SQL editor, after CRM-SETUP.sql,
-- CRM-OUTREACH-HUB.sql and CRM-COMPANY-360.sql. Nothing in this file runs
-- automatically — it must be executed manually.
-- ============================================================================

do $$
begin
  if to_regclass('public.crm_companies') is null then raise exception 'crm_companies not found — run CRM-SETUP.sql first.'; end if;
  if to_regclass('public.crm_contacts') is null then raise exception 'crm_contacts not found — run CRM-SETUP.sql first.'; end if;
  if to_regclass('public.crm_tasks') is null then raise exception 'crm_tasks not found — run CRM-SETUP.sql first.'; end if;
  if to_regclass('public.crm_outreach') is null then raise exception 'crm_outreach not found — run CRM-OUTREACH-HUB.sql first.'; end if;
  if to_regclass('public.crm_outreach_templates') is null then raise exception 'crm_outreach_templates not found — run CRM-OUTREACH-HUB.sql first.'; end if;
  if to_regproc('public.crm_can_write') is null then raise exception 'public.crm_can_write() not found — run CRM-SETUP.sql first.'; end if;
  if to_regproc('public.crm_gaza_date') is null then raise exception 'public.crm_gaza_date() not found — run CRM-SALES-OPS-UPGRADE.sql first.'; end if;
  if to_regproc('public.crm_outreach_dashboard_snapshot') is null then raise exception 'public.crm_outreach_dashboard_snapshot() not found — run CRM-OUTREACH-HUB.sql first.'; end if;
end $$;

-- ============================================================================
-- 1. crm_campaigns — lightweight campaign shell. Metrics are NEVER stored
--    here (see crm_campaign_metrics() below) — they are always computed
--    live from crm_outreach_messages / crm_outreach / crm_leads, so they
--    can never drift out of sync with the real data.
-- ============================================================================
create table if not exists public.crm_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) > 0),
  channel text not null check (channel in ('email', 'whatsapp', 'linkedin', 'phone')),
  template_id uuid references public.crm_outreach_templates(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'running', 'paused', 'completed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists crm_campaigns_set_updated_at on public.crm_campaigns;
create trigger crm_campaigns_set_updated_at
before update on public.crm_campaigns
for each row execute function public.crm_set_updated_at();

-- ============================================================================
-- 2. crm_campaign_members — which companies/contacts belong to a campaign.
-- ============================================================================
create table if not exists public.crm_campaign_members (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.crm_campaigns(id) on delete cascade,
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  added_at timestamptz not null default now(),
  unique (campaign_id, company_id)
);

create index if not exists crm_campaign_members_campaign_id_idx on public.crm_campaign_members (campaign_id);
create index if not exists crm_campaign_members_company_id_idx on public.crm_campaign_members (company_id);

-- ============================================================================
-- 3. crm_outreach_messages — THE unified communication history table for
--    all four channels. One row per actually-sent email, per user-confirmed
--    WhatsApp/LinkedIn message, or per completed phone call. Rows are only
--    ever created after a real send/confirmation — never for a merely
--    opened wa.me link or an unconfirmed LinkedIn draft (see architecture
--    notes in the final report).
--
--    'outcome' is phone-only (call result). 'provider'/'provider_message_id'
--    /'error_code'/'error_message' are email-only (Resend). 'body' holds the
--    actual rendered message for email/whatsapp/linkedin, or free-text call
--    notes for phone — one column, four uses, instead of four near-duplicate
--    columns.
-- ============================================================================
create table if not exists public.crm_outreach_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  lead_id uuid references public.crm_leads(id) on delete set null,
  campaign_id uuid references public.crm_campaigns(id) on delete set null,
  template_id uuid references public.crm_outreach_templates(id) on delete set null,
  channel text not null check (channel in ('email', 'whatsapp', 'linkedin', 'phone')),
  status text not null check (status in ('sent', 'failed', 'completed')),
  recipient text,
  subject text,
  body text,
  outcome text check (outcome in ('no_answer', 'interested', 'not_interested', 'call_back', 'meeting_requested')),
  provider text,
  provider_message_id text,
  error_code text,
  error_message text,
  sent_by uuid references auth.users(id) on delete set null default auth.uid(),
  sent_at timestamptz not null default now(),
  follow_up_days integer,
  created_at timestamptz not null default now(),
  constraint crm_outreach_messages_channel_status_chk check (
    (channel = 'phone' and status = 'completed') or (channel <> 'phone' and status in ('sent', 'failed'))
  )
);

create index if not exists crm_outreach_messages_company_id_idx on public.crm_outreach_messages (company_id);
create index if not exists crm_outreach_messages_contact_id_idx on public.crm_outreach_messages (contact_id);
create index if not exists crm_outreach_messages_lead_id_idx on public.crm_outreach_messages (lead_id);
create index if not exists crm_outreach_messages_campaign_id_idx on public.crm_outreach_messages (campaign_id);
create index if not exists crm_outreach_messages_created_at_idx on public.crm_outreach_messages (created_at desc);
-- Powers the "same template recently sent to this company" cooldown check
-- the composer runs before allowing a send (see final report, section 10).
create index if not exists crm_outreach_messages_cooldown_idx on public.crm_outreach_messages (company_id, channel, template_id, created_at desc);

-- ============================================================================
-- 4. crm_outreach — additive columns for the unified response/outcome
--    tracker (distinct from the four existing per-channel statuses).
-- ============================================================================
alter table public.crm_outreach add column if not exists response_status text not null default 'none'
  check (response_status in ('none', 'waiting_reply', 'replied', 'interested', 'not_interested', 'meeting_requested', 'proposal_requested'));

-- ============================================================================
-- 5. crm_tasks — link a follow-up task back to the message that scheduled
--    it, so crm_schedule_followup() can find and supersede its own
--    previous follow-up instead of piling up duplicates.
-- ============================================================================
alter table public.crm_tasks add column if not exists related_message_id uuid references public.crm_outreach_messages(id) on delete set null;
create index if not exists crm_tasks_related_message_id_idx on public.crm_tasks (related_message_id);

-- Separate from related_message_id (which is only set when a real message
-- exists) — this is the actual dedup marker crm_schedule_followup() uses,
-- so a "Schedule Follow-up" quick action with no underlying message (see
-- final report, Company 360 Communication section) is deduplicated exactly
-- the same way a message-triggered follow-up is. A manually-created task
-- (via the Task modal) always defaults to false and is never touched.
alter table public.crm_tasks add column if not exists is_auto_followup boolean not null default false;
create index if not exists crm_tasks_is_auto_followup_idx on public.crm_tasks (is_auto_followup) where is_auto_followup = true;

-- ============================================================================
-- 6. crm_contacts — minimal suppression scaffolding (section 13: "future
--    use"). Nothing subscribes to this yet beyond the composer's own
--    pre-send check (see final report) — there is no public unsubscribe
--    link/page in this phase, by design (that would be a separate,
--    larger, compliance-grade feature).
-- ============================================================================
alter table public.crm_contacts add column if not exists email_suppressed boolean not null default false;
alter table public.crm_contacts add column if not exists email_suppressed_reason text;

-- ============================================================================
-- 7. crm_outreach_templates — widen for the new "Phone script" type.
-- ============================================================================
alter table public.crm_outreach_templates drop constraint if exists crm_outreach_templates_type_check;
alter table public.crm_outreach_templates add constraint crm_outreach_templates_type_check
  check (type in ('email', 'linkedin', 'whatsapp', 'proposal', 'meeting', 'phone'));

-- ============================================================================
-- 8. crm_schedule_followup(p_company_id, p_message_id, p_days, p_channel)
--    Atomically: cancels this company's previous auto-generated pending
--    follow-up task (if any), sets crm_outreach.next_follow_up_date (the
--    single field the Outreach Hub/Dashboard/Calendar already read), and
--    creates ONE new linked crm_tasks row. This is the only place that
--    creates a follow-up — called from every channel, so the "avoid
--    duplicate follow-ups" rule lives in exactly one place.
-- ============================================================================
create or replace function public.crm_schedule_followup(
  p_company_id uuid,
  p_message_id uuid,
  p_days integer,
  p_channel text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_task_id uuid;
  v_due date;
  v_company_name text;
  v_channel_label text;
begin
  if not public.crm_can_write() then
    raise exception 'insufficient_privilege: current user cannot write to the CRM';
  end if;
  if p_days is null or p_days < 1 then
    raise exception 'invalid_follow_up_days: %', p_days;
  end if;

  select name into v_company_name from public.crm_companies where id = p_company_id;
  if v_company_name is null then
    raise exception 'company_not_found: %', p_company_id;
  end if;

  v_due := public.crm_gaza_date(now()) + p_days;
  v_channel_label := case p_channel
    when 'email' then 'بريد إلكتروني' when 'whatsapp' then 'واتساب'
    when 'linkedin' then 'LinkedIn' when 'phone' then 'مكالمة هاتفية'
    else coalesce(p_channel, 'تواصل')
  end;

  -- Supersede this company's own previous auto-generated pending follow-up
  -- (never touches manually-created tasks — those default to
  -- is_auto_followup = false and are left alone).
  update public.crm_tasks
  set status = 'cancelled'
  where company_id = p_company_id
    and status = 'pending'
    and is_auto_followup = true;

  update public.crm_outreach
  set next_follow_up_date = v_due, next_follow_up_time = null, reminder_enabled = true
  where company_id = p_company_id;

  insert into public.crm_tasks (company_id, title, priority, due_at, related_message_id, is_auto_followup)
  values (p_company_id, 'متابعة ' || v_channel_label || ': ' || v_company_name, 'medium', v_due::timestamptz, p_message_id, true)
  returning id into v_task_id;

  return v_task_id;
end;
$$;

grant execute on function public.crm_schedule_followup(uuid, uuid, integer, text) to authenticated;

-- ============================================================================
-- 9. crm_set_response_status(p_company_id, p_status) — atomically sets the
--    unified response/outcome tracker and, when the answer is "replied",
--    cancels this company's still-pending auto-generated follow-up in the
--    same transaction (section 11: "cancel/supersede unnecessary pending
--    follow-up reminders").
-- ============================================================================
create or replace function public.crm_set_response_status(p_company_id uuid, p_status text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.crm_can_write() then
    raise exception 'insufficient_privilege: current user cannot write to the CRM';
  end if;
  if p_status not in ('none', 'waiting_reply', 'replied', 'interested', 'not_interested', 'meeting_requested', 'proposal_requested') then
    raise exception 'invalid_response_status: %', p_status;
  end if;

  update public.crm_outreach
  set response_status = p_status,
      next_follow_up_date = case when p_status = 'replied' then null else next_follow_up_date end,
      next_follow_up_time = case when p_status = 'replied' then null else next_follow_up_time end
  where company_id = p_company_id;

  if not found then
    raise exception 'company_has_no_outreach_row: %', p_company_id;
  end if;

  if p_status = 'replied' then
    update public.crm_tasks
    set status = 'cancelled'
    where company_id = p_company_id
      and status = 'pending'
      and is_auto_followup = true;
  end if;
end;
$$;

grant execute on function public.crm_set_response_status(uuid, text) to authenticated;

-- ============================================================================
-- 10. crm_campaign_metrics(p_campaign_id) — derived, never stored, metrics
--     for one campaign (section 14).
-- ============================================================================
create or replace function public.crm_campaign_metrics(p_campaign_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'recipients', (select count(*) from public.crm_campaign_members where campaign_id = p_campaign_id),
    'sent', (select count(*) from public.crm_outreach_messages where campaign_id = p_campaign_id and status in ('sent', 'completed')),
    'failed', (select count(*) from public.crm_outreach_messages where campaign_id = p_campaign_id and status = 'failed'),
    'waiting_reply', (
      select count(*) from public.crm_outreach o join public.crm_campaign_members m on m.company_id = o.company_id
      where m.campaign_id = p_campaign_id and o.response_status = 'waiting_reply'
    ),
    'replied', (
      select count(*) from public.crm_outreach o join public.crm_campaign_members m on m.company_id = o.company_id
      where m.campaign_id = p_campaign_id and o.response_status = 'replied'
    ),
    'interested', (
      select count(*) from public.crm_outreach o join public.crm_campaign_members m on m.company_id = o.company_id
      where m.campaign_id = p_campaign_id and o.response_status = 'interested'
    ),
    'meetings', (
      select count(*) from public.crm_meetings mt join public.crm_campaign_members m on m.company_id = mt.company_id
      where m.campaign_id = p_campaign_id
    ),
    'proposals', (
      select count(*) from public.crm_proposals pr join public.crm_campaign_members m on m.company_id = pr.company_id
      where m.campaign_id = p_campaign_id
    ),
    'won', (
      select count(distinct l.company_id) from public.crm_leads l join public.crm_campaign_members m on m.company_id = l.company_id
      where m.campaign_id = p_campaign_id and l.stage = 'won'
    )
  ) into v_result;
  return v_result;
end;
$$;

grant execute on function public.crm_campaign_metrics(uuid) to authenticated;

-- ============================================================================
-- 11. crm_outreach_dashboard_snapshot() — CREATE OR REPLACE, extended.
--     Every key that existed before (kpis, by_email_status, by_linkedin_
--     status, by_whatsapp_status, by_phone_status, by_industry, by_country)
--     is preserved byte-for-byte so outreach-dashboard.html's existing
--     rendering keeps working untouched. Everything new lives under one
--     new top-level key: 'automation'.
-- ============================================================================
create or replace function public.crm_outreach_dashboard_snapshot()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
  v_total_outbound bigint;
  v_replied_like bigint;
  v_interested_like bigint;
  v_meeting_requested bigint;
  v_won bigint;
  v_by_channel_status jsonb;
  v_by_template jsonb;
  v_by_campaign jsonb;
  v_by_country_channel jsonb;
begin
  select count(*) into v_total_outbound from public.crm_outreach_messages where status in ('sent', 'completed');
  select count(*) into v_replied_like from public.crm_outreach where response_status in ('replied', 'interested', 'meeting_requested', 'proposal_requested');
  select count(*) into v_interested_like from public.crm_outreach where response_status in ('interested', 'meeting_requested', 'proposal_requested');
  select count(*) into v_meeting_requested from public.crm_outreach where response_status = 'meeting_requested';
  select count(distinct company_id) into v_won from public.crm_leads where stage = 'won' and company_id is not null;

  select coalesce(jsonb_agg(x order by x.channel, x.status), '[]'::jsonb) into v_by_channel_status
  from (select channel, status, count(*) as count from public.crm_outreach_messages group by channel, status) x;

  select coalesce(jsonb_agg(x order by x.count desc), '[]'::jsonb) into v_by_template
  from (
    select coalesce(t.name, 'بدون قالب') as template_name, m.channel, count(*) as count
    from public.crm_outreach_messages m
    left join public.crm_outreach_templates t on t.id = m.template_id
    where m.status in ('sent', 'completed')
    group by t.name, m.channel
    limit 15
  ) x;

  select coalesce(jsonb_agg(x order by x.count desc), '[]'::jsonb) into v_by_campaign
  from (
    select c.name as campaign_name, count(*) as count
    from public.crm_outreach_messages m
    join public.crm_campaigns c on c.id = m.campaign_id
    where m.status in ('sent', 'completed')
    group by c.name
    limit 15
  ) x;

  select coalesce(jsonb_agg(x order by x.count desc), '[]'::jsonb) into v_by_country_channel
  from (
    select coalesce(co.country, 'غير محدد') as country, m.channel, count(*) as count
    from public.crm_outreach_messages m
    join public.crm_companies co on co.id = m.company_id
    where m.status in ('sent', 'completed')
    group by co.country, m.channel
    limit 20
  ) x;

  select jsonb_build_object(
    'kpis', jsonb_build_object(
      'total_companies', (select count(*) from public.crm_companies),
      'contacted', (
        select count(*) from public.crm_outreach
        where email_status <> 'not_sent' or linkedin_status <> 'not_contacted'
           or whatsapp_status <> 'not_sent' or phone_status <> 'not_called'
      ),
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
    ),
    'automation', jsonb_build_object(
      'emails_sent', (select count(*) from public.crm_outreach_messages where channel = 'email' and status = 'sent'),
      'emails_failed', (select count(*) from public.crm_outreach_messages where channel = 'email' and status = 'failed'),
      'whatsapp_sent', (select count(*) from public.crm_outreach_messages where channel = 'whatsapp' and status = 'sent'),
      'linkedin_sent', (select count(*) from public.crm_outreach_messages where channel = 'linkedin' and status = 'sent'),
      'calls_completed', (select count(*) from public.crm_outreach_messages where channel = 'phone' and status = 'completed'),
      'waiting_reply', (select count(*) from public.crm_outreach where response_status = 'waiting_reply'),
      'replied', (select count(*) from public.crm_outreach where response_status = 'replied'),
      'interested', (select count(*) from public.crm_outreach where response_status = 'interested'),
      'meeting_requested', v_meeting_requested,
      'proposal_requested', (select count(*) from public.crm_outreach where response_status = 'proposal_requested'),
      'won', v_won,
      'total_outbound', v_total_outbound,
      'reply_rate', case when v_total_outbound = 0 then 0 else round(100.0 * v_replied_like / v_total_outbound, 1) end,
      'interest_rate', case when v_total_outbound = 0 then 0 else round(100.0 * v_interested_like / v_total_outbound, 1) end,
      'meeting_rate', case when v_total_outbound = 0 then 0 else round(100.0 * v_meeting_requested / v_total_outbound, 1) end,
      'conversion_rate', case when v_total_outbound = 0 then 0 else round(100.0 * v_won / v_total_outbound, 1) end,
      'by_channel_status', v_by_channel_status,
      'by_template', v_by_template,
      'by_campaign', v_by_campaign,
      'by_country_channel', v_by_country_channel
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.crm_outreach_dashboard_snapshot() to authenticated;

-- ============================================================================
-- 12. RLS — same convention as every prior CRM migration: select via
--     crm_can_read(), insert/update via crm_can_write(), delete admin-only.
-- ============================================================================
do $$
declare
  t text;
  tables text[] := array['crm_campaigns', 'crm_campaign_members', 'crm_outreach_messages'];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (public.crm_can_read())', t, t);

    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (public.crm_can_write())', t, t);

    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (public.crm_can_write()) with check (public.crm_can_write())', t, t);

    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (coalesce(public.is_admin(), false))', t, t);
  end loop;
end $$;

-- ============================================================================
-- Done. Everything above is idempotent — safe to run this file again.
-- ============================================================================
