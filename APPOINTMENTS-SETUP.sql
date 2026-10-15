create extension if not exists pgcrypto;

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  whatsapp text not null check (char_length(whatsapp) between 7 and 24),
  service text not null check (char_length(service) between 2 and 120),
  appointment_date date not null,
  appointment_time time not null,
  duration_minutes integer not null default 30 check (duration_minutes = 30),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'rejected')),
  booking_reference text not null unique,
  created_at timestamptz not null default now(),
  constraint appointments_not_friday check (extract(dow from appointment_date) <> 5),
  constraint appointments_working_hours check (
    appointment_time >= time '10:00'
    and appointment_time <= time '18:30'
    and extract(minute from appointment_time) in (0, 30)
  )
);

create unique index if not exists appointments_active_slot_unique
  on public.appointments (appointment_date, appointment_time)
  where status in ('pending', 'confirmed');

alter table public.appointments enable row level security;

-- لا توجد سياسات وصول عامة. تستخدم وظيفة الخادم فقط مفتاح service role.
revoke all on table public.appointments from anon, authenticated;
