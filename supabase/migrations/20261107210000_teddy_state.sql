-- Teddy's Day cross-device sync.
-- One row per shared "sync code"; the code IS the shared key (no accounts).
-- The whole app state (localStorage blob) lives in `state` jsonb.
-- Permissive-anon RLS to match the rest of this project — the Netlify function
-- (anon key) is the only client and scopes every query by code.

create table if not exists public.teddy_state (
  code       text primary key,
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.teddy_state enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'teddy_state' and policyname = 'teddy_state_anon_all'
  ) then
    create policy teddy_state_anon_all on public.teddy_state
      for all to anon using (true) with check (true);
  end if;
end $$;
