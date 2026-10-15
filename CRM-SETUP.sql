-- ============================================================================
-- Basma CRM — MVP schema migration
-- ============================================================================
-- Safe to run multiple times: every statement uses IF NOT EXISTS / OR REPLACE /
-- DROP POLICY IF EXISTS guards. Nothing here touches, alters, or deletes any
-- existing table, row, or function outside the objects created below.
--
-- PRECONDITION: this migration assumes public.is_admin() already exists in
-- your database (it is already referenced by the existing feedback
-- moderation policies in FEEDBACK-SETUP.sql). The guard block right below
-- checks for it explicitly and stops with a clear error instead of failing
-- later with a cryptic one if it is missing for any reason.
-- ============================================================================

create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'is_admin' and n.nspname = 'public'
  ) then
    raise exception
      'public.is_admin() was not found. Basma CRM RLS policies depend on it (same function already used by the feedback moderation policies). Create/restore it first, then re-run this migration.';
  end if;
end $$;

-- ============================================================================
-- 1. crm_members — minimal internal-staff/role table (no employee system
--    existed in the project prior to this migration; see CRM report).
-- ============================================================================
create table if not exists public.crm_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('admin', 'sales', 'manager', 'viewer')),
  is_active boolean not null default true,
  full_name text,
  created_at timestamptz not null default now()
);

comment on table public.crm_members is 'Basma CRM internal staff directory + role. Not a public-facing table.';

-- ============================================================================
-- 2. Shared helper functions (access + updated_at + proposal numbering)
-- ============================================================================

create or replace function public.crm_member_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.crm_members where user_id = auth.uid() and is_active = true limit 1;
$$;

create or replace function public.crm_can_read()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_admin(), false) or public.crm_member_role() is not null;
$$;

create or replace function public.crm_can_write()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_admin(), false) or public.crm_member_role() in ('sales', 'manager');
$$;

-- Single call the frontend makes right after login to decide what to show:
-- full access, read-only, or "no CRM access" — without ever needing the
-- service role key or a second round trip per check.
create or replace function public.crm_whoami()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'is_admin', coalesce(public.is_admin(), false),
    'role', public.crm_member_role(),
    'can_read', public.crm_can_read(),
    'can_write', public.crm_can_write()
  );
$$;

grant execute on function public.crm_member_role() to authenticated;
grant execute on function public.crm_can_read() to authenticated;
grant execute on function public.crm_can_write() to authenticated;
grant execute on function public.crm_whoami() to authenticated;
revoke all on function public.crm_whoami() from anon;

create or replace function public.crm_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Auto-generated proposal numbers: BASMA-<year>-<4-digit running sequence>.
-- MVP note: the running number is a single global sequence (not reset per
-- calendar year) — simplest safe option for now; documented in the CRM report.
create sequence if not exists public.crm_proposal_number_seq;

create or replace function public.crm_set_proposal_number()
returns trigger
language plpgsql
as $$
begin
  if new.proposal_number is null or btrim(new.proposal_number) = '' then
    new.proposal_number := 'BASMA-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('public.crm_proposal_number_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

-- Keeps crm_leads.status in sync with crm_leads.stage so the
-- "won / closed leads" conversion KPI stays correct without extra app logic.
create or replace function public.crm_sync_lead_status()
returns trigger
language plpgsql
as $$
begin
  if new.stage = 'won' then
    new.status := 'won';
  elsif new.stage = 'lost' then
    new.status := 'lost';
  else
    new.status := 'open';
  end if;
  return new;
end;
$$;

-- ============================================================================
-- 3. crm_companies
-- ============================================================================
create table if not exists public.crm_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) > 0),
  website text,
  country text,
  city text,
  industry text,
  phone text,
  email text,
  linkedin_url text,
  address text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists crm_companies_set_updated_at on public.crm_companies;
create trigger crm_companies_set_updated_at
before update on public.crm_companies
for each row execute function public.crm_set_updated_at();

-- ============================================================================
-- 4. crm_contacts
-- ============================================================================
create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.crm_companies(id) on delete set null,
  full_name text not null check (char_length(btrim(full_name)) > 0),
  job_title text,
  email text,
  phone text,
  whatsapp text,
  linkedin_url text,
  is_primary boolean not null default false,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists crm_contacts_set_updated_at on public.crm_contacts;
create trigger crm_contacts_set_updated_at
before update on public.crm_contacts
for each row execute function public.crm_set_updated_at();

create index if not exists crm_contacts_company_id_idx on public.crm_contacts (company_id);

-- ============================================================================
-- 5. crm_leads
-- ============================================================================
create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.crm_companies(id) on delete set null,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  title text not null check (char_length(btrim(title)) > 0),
  source text,
  service_interest text,
  country text,
  estimated_value numeric not null default 0 check (estimated_value >= 0),
  currency text not null default 'USD',
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  stage text not null default 'new' check (stage in (
    'new', 'contacted', 'qualified', 'meeting_scheduled', 'proposal_sent',
    'negotiation', 'won', 'lost'
  )),
  status text not null default 'open' check (status in ('open', 'won', 'lost')),
  probability integer not null default 10 check (probability between 0 and 100),
  next_follow_up_at timestamptz,
  last_contact_at timestamptz,
  assigned_to uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists crm_leads_set_updated_at on public.crm_leads;
create trigger crm_leads_set_updated_at
before update on public.crm_leads
for each row execute function public.crm_set_updated_at();

drop trigger if exists crm_leads_sync_status on public.crm_leads;
create trigger crm_leads_sync_status
before insert or update of stage on public.crm_leads
for each row execute function public.crm_sync_lead_status();

create index if not exists crm_leads_stage_idx on public.crm_leads (stage);
create index if not exists crm_leads_status_idx on public.crm_leads (status);
create index if not exists crm_leads_assigned_to_idx on public.crm_leads (assigned_to);
create index if not exists crm_leads_next_follow_up_at_idx on public.crm_leads (next_follow_up_at);
create index if not exists crm_leads_company_id_idx on public.crm_leads (company_id);
create index if not exists crm_leads_contact_id_idx on public.crm_leads (contact_id);

-- ============================================================================
-- 6. crm_activities (manual activity log — MVP; no automatic Gmail/WhatsApp
--    ingestion of any kind)
-- ============================================================================
create table if not exists public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.crm_leads(id) on delete cascade,
  company_id uuid references public.crm_companies(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete cascade,
  activity_type text not null check (activity_type in (
    'note', 'call', 'email', 'whatsapp', 'meeting', 'follow_up', 'status_change', 'proposal'
  )),
  subject text not null check (char_length(btrim(subject)) > 0),
  details text,
  activity_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists crm_activities_lead_id_idx on public.crm_activities (lead_id);
create index if not exists crm_activities_company_id_idx on public.crm_activities (company_id);
create index if not exists crm_activities_contact_id_idx on public.crm_activities (contact_id);
create index if not exists crm_activities_activity_at_idx on public.crm_activities (activity_at desc);

-- ============================================================================
-- 7. crm_tasks
-- ============================================================================
create table if not exists public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.crm_leads(id) on delete cascade,
  company_id uuid references public.crm_companies(id) on delete cascade,
  title text not null check (char_length(btrim(title)) > 0),
  description text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  due_at timestamptz,
  assigned_to uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists crm_tasks_set_updated_at on public.crm_tasks;
create trigger crm_tasks_set_updated_at
before update on public.crm_tasks
for each row execute function public.crm_set_updated_at();

create index if not exists crm_tasks_status_idx on public.crm_tasks (status);
create index if not exists crm_tasks_assigned_to_idx on public.crm_tasks (assigned_to);
create index if not exists crm_tasks_due_at_idx on public.crm_tasks (due_at);
create index if not exists crm_tasks_lead_id_idx on public.crm_tasks (lead_id);
create index if not exists crm_tasks_company_id_idx on public.crm_tasks (company_id);

-- ============================================================================
-- 8. crm_meetings
-- ============================================================================
create table if not exists public.crm_meetings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.crm_leads(id) on delete cascade,
  company_id uuid references public.crm_companies(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete cascade,
  title text not null check (char_length(btrim(title)) > 0),
  meeting_type text check (meeting_type in ('call', 'online', 'in_person')),
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 30 check (duration_minutes > 0),
  location_or_link text,
  notes text,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled', 'rescheduled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists crm_meetings_set_updated_at on public.crm_meetings;
create trigger crm_meetings_set_updated_at
before update on public.crm_meetings
for each row execute function public.crm_set_updated_at();

create index if not exists crm_meetings_scheduled_at_idx on public.crm_meetings (scheduled_at);
create index if not exists crm_meetings_lead_id_idx on public.crm_meetings (lead_id);
create index if not exists crm_meetings_company_id_idx on public.crm_meetings (company_id);
create index if not exists crm_meetings_contact_id_idx on public.crm_meetings (contact_id);

-- ============================================================================
-- 9. crm_proposals
-- ============================================================================
create table if not exists public.crm_proposals (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.crm_leads(id) on delete set null,
  company_id uuid references public.crm_companies(id) on delete set null,
  proposal_number text not null unique,
  title text not null check (char_length(btrim(title)) > 0),
  status text not null default 'draft' check (status in ('draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired')),
  currency text not null default 'USD',
  subtotal numeric not null default 0 check (subtotal >= 0),
  discount numeric not null default 0 check (discount >= 0),
  total numeric not null default 0 check (total >= 0),
  valid_until date,
  scope text,
  terms text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists crm_proposals_set_updated_at on public.crm_proposals;
create trigger crm_proposals_set_updated_at
before update on public.crm_proposals
for each row execute function public.crm_set_updated_at();

drop trigger if exists crm_proposals_set_number on public.crm_proposals;
create trigger crm_proposals_set_number
before insert on public.crm_proposals
for each row execute function public.crm_set_proposal_number();

create index if not exists crm_proposals_lead_id_idx on public.crm_proposals (lead_id);
create index if not exists crm_proposals_company_id_idx on public.crm_proposals (company_id);
create index if not exists crm_proposals_status_idx on public.crm_proposals (status);

-- ============================================================================
-- 10. crm_proposal_items
-- ============================================================================
create table if not exists public.crm_proposal_items (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.crm_proposals(id) on delete cascade,
  item_name text not null check (char_length(btrim(item_name)) > 0),
  description text,
  quantity numeric not null default 1 check (quantity > 0),
  unit_price numeric not null default 0 check (unit_price >= 0),
  total numeric not null default 0 check (total >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists crm_proposal_items_proposal_id_idx on public.crm_proposal_items (proposal_id);

-- ============================================================================
-- 11. Row Level Security — every table locked down by default.
--     anon: zero access. authenticated-but-not-a-member: zero access.
--     crm_members (sales/manager, active) or public.is_admin(): read+write.
--     crm_members (viewer, active): read-only. Delete: admin only, everywhere.
-- ============================================================================

-- crm_members itself: only admins can add/change/remove staff. For SELECT,
-- any active CRM member (or admin) can read the whole small directory
-- (user_id, full_name, role only — nothing sensitive like email/password is
-- stored here) so "assigned to" pickers can show real names instead of raw
-- ids. An authenticated user who is not an active member sees nothing.
alter table public.crm_members enable row level security;
revoke all on public.crm_members from anon, authenticated;
grant select, insert, update, delete on public.crm_members to authenticated;

drop policy if exists crm_members_self_select on public.crm_members;
create policy crm_members_self_select on public.crm_members
for select to authenticated
using (
  user_id = auth.uid()
  or coalesce(public.is_admin(), false)
  or public.crm_member_role() is not null
);

drop policy if exists crm_members_admin_write on public.crm_members;
create policy crm_members_admin_write on public.crm_members
for insert to authenticated
with check (coalesce(public.is_admin(), false));

drop policy if exists crm_members_admin_update on public.crm_members;
create policy crm_members_admin_update on public.crm_members
for update to authenticated
using (coalesce(public.is_admin(), false))
with check (coalesce(public.is_admin(), false));

drop policy if exists crm_members_admin_delete on public.crm_members;
create policy crm_members_admin_delete on public.crm_members
for delete to authenticated
using (coalesce(public.is_admin(), false));

-- Generic policy set applied to every remaining CRM table.
do $$
declare
  t text;
  crm_tables text[] := array[
    'crm_companies', 'crm_contacts', 'crm_leads', 'crm_activities',
    'crm_tasks', 'crm_meetings', 'crm_proposals', 'crm_proposal_items'
  ];
begin
  foreach t in array crm_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (public.crm_can_read())',
      t, t
    );

    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (public.crm_can_write())',
      t, t
    );

    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (public.crm_can_write()) with check (public.crm_can_write())',
      t, t
    );

    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (coalesce(public.is_admin(), false))',
      t, t
    );
  end loop;
end $$;

-- ============================================================================
-- End of migration.
-- ============================================================================
