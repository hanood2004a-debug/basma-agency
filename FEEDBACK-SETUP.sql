create extension if not exists pgcrypto;

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  name text check (name is null or char_length(name) between 1 and 60),
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 500),
  booking_reference text,
  verified boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_reply text check (admin_reply is null or char_length(admin_reply) <= 500),
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create index if not exists feedback_status_created_idx
  on public.feedback (status, created_at desc);

create or replace function public.verify_feedback_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.verified := new.booking_reference is not null
    and exists (
      select 1 from public.appointments
      where booking_reference = new.booking_reference
    );
  new.status := 'pending';
  new.published_at := null;
  return new;
end;
$$;

drop trigger if exists feedback_verify_booking on public.feedback;
create trigger feedback_verify_booking
before insert on public.feedback
for each row execute function public.verify_feedback_booking();

create or replace function public.set_feedback_published_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.published_at := now();
  elsif new.status <> 'approved' then
    new.published_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists feedback_publication_timestamp on public.feedback;
create trigger feedback_publication_timestamp
before update of status on public.feedback
for each row execute function public.set_feedback_published_at();

alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;
grant select, update on public.feedback to authenticated;

drop policy if exists feedback_admin_select on public.feedback;
create policy feedback_admin_select on public.feedback
for select to authenticated
using (public.is_admin());

drop policy if exists feedback_admin_update on public.feedback;
create policy feedback_admin_update on public.feedback
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

