-- Almanac weight tracker: add lightweight multi-user accounts and scope
-- weight entries per user. Auth is username + passcode (hashed server-side);
-- the Netlify function is the trust boundary (permissive anon RLS, like the
-- rest of this project) and enforces per-user access via a signed token.

create table if not exists public.weight_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,          -- stored lowercased
  pw_hash text not null,                  -- scrypt hex
  pw_salt text not null,                  -- hex
  goal_weight numeric not null default 175,
  prefs jsonb not null default '{}'::jsonb, -- e.g. { "window": 7, "showAll": false }
  created_at timestamptz not null default now()
);

alter table public.weight_users enable row level security;

drop policy if exists "Allow anon read weight users" on public.weight_users;
create policy "Allow anon read weight users"
on public.weight_users for select to anon using (true);

drop policy if exists "Allow anon insert weight users" on public.weight_users;
create policy "Allow anon insert weight users"
on public.weight_users for insert to anon with check (true);

drop policy if exists "Allow anon update weight users" on public.weight_users;
create policy "Allow anon update weight users"
on public.weight_users for update to anon using (true) with check (true);

-- Scope entries to a user and enforce one-per-calendar-day (latest wins via upsert).
alter table public.weight_entries add column if not exists user_id uuid references public.weight_users(id) on delete cascade;
alter table public.weight_entries add column if not exists entry_date date;

-- Backfill entry_date from measured_at for any pre-existing rows.
update public.weight_entries set entry_date = (measured_at at time zone 'UTC')::date where entry_date is null;

create unique index if not exists weight_entries_user_day_idx
  on public.weight_entries (user_id, entry_date);
create index if not exists weight_entries_user_idx
  on public.weight_entries (user_id, entry_date desc);
