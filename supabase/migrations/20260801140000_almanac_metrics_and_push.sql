-- Almanac Phase 2: optional waist measure + Web Push subscriptions.
-- Body-comp columns (body_fat_pct, muscle_mass, body_water_pct, visceral_fat,
-- bmi) already exist on weight_entries from the first migration. Reminder
-- settings (enabled, time, tz, lastReminded) live in weight_users.prefs jsonb.

alter table public.weight_entries add column if not exists waist numeric;

-- Personal API key for the Apple Health / Shortcuts ingest endpoint.
alter table public.weight_users add column if not exists api_key text unique;

create table if not exists public.weight_push_subs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.weight_users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists weight_push_subs_user_idx on public.weight_push_subs (user_id);

alter table public.weight_push_subs enable row level security;

drop policy if exists "Allow anon read push subs" on public.weight_push_subs;
create policy "Allow anon read push subs"
on public.weight_push_subs for select to anon using (true);

drop policy if exists "Allow anon insert push subs" on public.weight_push_subs;
create policy "Allow anon insert push subs"
on public.weight_push_subs for insert to anon with check (true);

drop policy if exists "Allow anon update push subs" on public.weight_push_subs;
create policy "Allow anon update push subs"
on public.weight_push_subs for update to anon using (true) with check (true);

drop policy if exists "Allow anon delete push subs" on public.weight_push_subs;
create policy "Allow anon delete push subs"
on public.weight_push_subs for delete to anon using (true);
