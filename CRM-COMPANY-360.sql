-- ============================================================================
-- Basma CRM — Company 360° migration (v1.5)
-- ============================================================================
-- Adds everything company-details.html's new "Company 360°" view needs on
-- top of CRM-SETUP.sql + CRM-SALES-OPS-UPGRADE.sql + CRM-OUTREACH-HUB.sql:
--   - crm_contacts.is_decision_maker (additive column)
--   - crm_outreach per-channel last-contact timestamps (additive columns +
--     a trigger that stamps them automatically, from ANY entry point —
--     company-details.html's Outreach form AND outreach.html's bulk update)
--   - crm_activities.activity_type widened for 'contact_added'
--   - two new triggers that make the timeline self-maintaining:
--       * a new contact tied to a company logs "Contact Added"
--       * a lead's stage changing logs "Lead Updated" (mirrors the existing
--         crm_notify_lead_stage_changed() notification, but as a visible
--         timeline entry — no existing trigger/function is modified)
--   - crm_set_primary_contact() — atomic "make this the one primary contact"
--   - crm_company_files table + RLS, plus a private Storage bucket + Storage
--     RLS policies for uploading PDFs/DOCX/images against a company
--
-- Every statement is idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP
-- POLICY IF EXISTS) so re-running this file is always safe. No existing
-- table's data is touched — every ALTER TABLE below only ADDS a column.
--
-- Run this once, in full, in the Supabase SQL editor. Do not run it via any
-- other means. Nothing in this file is executed automatically by the app.
-- ============================================================================

do $$
begin
  if to_regclass('public.crm_companies') is null then
    raise exception 'crm_companies not found — run CRM-SETUP.sql first.';
  end if;
  if to_regclass('public.crm_contacts') is null then
    raise exception 'crm_contacts not found — run CRM-SETUP.sql first.';
  end if;
  if to_regclass('public.crm_outreach') is null then
    raise exception 'crm_outreach not found — run CRM-OUTREACH-HUB.sql first.';
  end if;
  if to_regproc('public.crm_can_write') is null then
    raise exception 'public.crm_can_write() not found — run CRM-SETUP.sql first.';
  end if;
end $$;

-- ============================================================================
-- 1. crm_contacts.is_decision_maker — additive column (default false, so
--    every existing contact is simply "not marked yet", no data implied).
-- ============================================================================
alter table public.crm_contacts add column if not exists is_decision_maker boolean not null default false;

-- ============================================================================
-- 2. crm_outreach — per-channel "last contact" timestamps, additive.
--    Populated automatically by the trigger below whenever the matching
--    status column actually changes — from ANY caller (company-details.html
--    or outreach.html's bulk status update), so this logic lives in exactly
--    one place instead of being duplicated across two JS files.
-- ============================================================================
alter table public.crm_outreach add column if not exists email_last_contact_at timestamptz;
alter table public.crm_outreach add column if not exists linkedin_last_contact_at timestamptz;
alter table public.crm_outreach add column if not exists whatsapp_last_contact_at timestamptz;
alter table public.crm_outreach add column if not exists phone_last_contact_at timestamptz;

create or replace function public.crm_outreach_track_last_contact()
returns trigger
language plpgsql
as $$
begin
  if new.email_status is distinct from old.email_status then
    new.email_last_contact_at := now();
  end if;
  if new.linkedin_status is distinct from old.linkedin_status then
    new.linkedin_last_contact_at := now();
  end if;
  if new.whatsapp_status is distinct from old.whatsapp_status then
    new.whatsapp_last_contact_at := now();
  end if;
  if new.phone_status is distinct from old.phone_status then
    new.phone_last_contact_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists crm_outreach_track_last_contact_trg on public.crm_outreach;
create trigger crm_outreach_track_last_contact_trg
before update on public.crm_outreach
for each row execute function public.crm_outreach_track_last_contact();

-- ============================================================================
-- 3. crm_activities.activity_type — widen CHECK to add 'contact_added'.
--    Every previously accepted value (from CRM-SETUP.sql, then
--    CRM-OUTREACH-HUB.sql's 'linkedin'/'company_imported') is preserved.
-- ============================================================================
alter table public.crm_activities drop constraint if exists crm_activities_activity_type_check;
alter table public.crm_activities add constraint crm_activities_activity_type_check
  check (activity_type in (
    'note', 'call', 'email', 'whatsapp', 'meeting', 'follow_up', 'status_change',
    'proposal', 'linkedin', 'company_imported', 'contact_added'
  ));

-- ============================================================================
-- 4. Timeline auto-logging triggers
-- ============================================================================

-- "Contact Added" — fires for any new contact that belongs to a company,
-- regardless of which page created it (contacts.html or the Company 360°
-- contacts panel), so the logic exists in exactly one place.
create or replace function public.crm_log_contact_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is not null then
    insert into public.crm_activities (company_id, contact_id, activity_type, subject)
    values (new.company_id, new.id, 'contact_added', 'جهة اتصال جديدة: ' || new.full_name);
  end if;
  return new;
end;
$$;

drop trigger if exists crm_contacts_log_added on public.crm_contacts;
create trigger crm_contacts_log_added
after insert on public.crm_contacts
for each row execute function public.crm_log_contact_added();

-- "Lead Updated" — fires whenever a lead's stage actually changes, from any
-- entry point (lead-details.html, pipeline.html drag-drop, etc). Mirrors the
-- existing crm_notify_lead_stage_changed() notification trigger from
-- CRM-SALES-OPS-UPGRADE.sql but writes a visible crm_activities timeline
-- entry instead of a notification — that existing trigger is untouched.
create or replace function public.crm_log_lead_stage_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stage is distinct from old.stage then
    insert into public.crm_activities (lead_id, company_id, activity_type, subject, details)
    values (
      new.id, new.company_id, 'status_change',
      'تحديث Lead: ' || new.title,
      'المرحلة الجديدة: ' || new.stage
    );
  end if;
  return new;
end;
$$;

drop trigger if exists crm_leads_log_stage_activity on public.crm_leads;
create trigger crm_leads_log_stage_activity
after update of stage on public.crm_leads
for each row execute function public.crm_log_lead_stage_activity();

-- ============================================================================
-- 5. crm_set_primary_contact(p_contact_id) — atomic "unset every other
--    contact of this company, set this one" in a single function call.
-- ============================================================================
create or replace function public.crm_set_primary_contact(p_contact_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  if not public.crm_can_write() then
    raise exception 'insufficient_privilege: current user cannot write to the CRM';
  end if;

  select company_id into v_company_id from public.crm_contacts where id = p_contact_id;
  if v_company_id is null then
    raise exception 'contact_not_found_or_has_no_company: %', p_contact_id;
  end if;

  update public.crm_contacts
  set is_primary = (id = p_contact_id)
  where company_id = v_company_id
    and is_primary <> (id = p_contact_id);
end;
$$;

grant execute on function public.crm_set_primary_contact(uuid) to authenticated;

-- ============================================================================
-- 6. crm_company_files — metadata for files uploaded against a company
--    (the actual bytes live in Supabase Storage, bucket 'crm-company-files').
-- ============================================================================
create table if not exists public.crm_company_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  file_type text,
  file_size bigint,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists crm_company_files_company_id_idx on public.crm_company_files (company_id);

alter table public.crm_company_files enable row level security;
revoke all on public.crm_company_files from anon, authenticated;
grant select, insert, update, delete on public.crm_company_files to authenticated;

drop policy if exists crm_company_files_select on public.crm_company_files;
create policy crm_company_files_select on public.crm_company_files
  for select to authenticated using (public.crm_can_read());

drop policy if exists crm_company_files_insert on public.crm_company_files;
create policy crm_company_files_insert on public.crm_company_files
  for insert to authenticated with check (public.crm_can_write());

drop policy if exists crm_company_files_update on public.crm_company_files;
create policy crm_company_files_update on public.crm_company_files
  for update to authenticated using (public.crm_can_write()) with check (public.crm_can_write());

drop policy if exists crm_company_files_delete on public.crm_company_files;
create policy crm_company_files_delete on public.crm_company_files
  for delete to authenticated using (coalesce(public.is_admin(), false));

-- ============================================================================
-- 7. Storage bucket + policies for company file uploads.
--    Private bucket (public = false) — files are only ever reached through
--    a short-lived signed URL generated by the CRM after an RLS check, never
--    a public URL. Policy names are prefixed crm_company_files_* and scoped
--    to bucket_id = 'crm-company-files' so this can never affect any other
--    bucket/policy that may already exist in this Supabase project.
--
--    NOTE ON TESTING: this section could not be verified in this sandbox —
--    there is no live Supabase Storage service to test against (only a
--    plain embedded Postgres was available for the rest of this file). The
--    SQL below follows Supabase's standard documented pattern for scoping
--    storage.objects policies by bucket_id. Please smoke-test one upload,
--    one download, and (as an admin) one delete after running this file.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('crm-company-files', 'crm-company-files', false)
on conflict (id) do nothing;

drop policy if exists crm_company_files_storage_select on storage.objects;
create policy crm_company_files_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'crm-company-files' and public.crm_can_read());

drop policy if exists crm_company_files_storage_insert on storage.objects;
create policy crm_company_files_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'crm-company-files' and public.crm_can_write());

drop policy if exists crm_company_files_storage_delete on storage.objects;
create policy crm_company_files_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'crm-company-files' and coalesce(public.is_admin(), false));

-- ============================================================================
-- Done. Everything above is idempotent — safe to run this file again.
-- ============================================================================
