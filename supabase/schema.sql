create table if not exists public.recipe_states (
  recipe_id text primary key,
  rating int check (rating between 1 and 5),
  completed boolean not null default false,
  completed_at timestamptz,
  teddy_approved boolean,
  ease int check (ease between 1 and 3),
  updated_at timestamptz not null default now()
);

alter table public.recipe_states enable row level security;

drop policy if exists "Allow anon read recipe states" on public.recipe_states;
create policy "Allow anon read recipe states"
on public.recipe_states
for select
to anon
using (true);

drop policy if exists "Allow anon write recipe states" on public.recipe_states;
create policy "Allow anon write recipe states"
on public.recipe_states
for insert
to anon
with check (true);

create table if not exists public.recipe_overrides (
  recipe_id text primary key,
  title text,
  image text,
  servings text,
  prep_time text,
  cook_time text,
  ingredients text[],
  instructions text[],
  updated_at timestamptz not null default now()
);

alter table public.recipe_overrides enable row level security;

drop policy if exists "Allow anon read recipe overrides" on public.recipe_overrides;
create policy "Allow anon read recipe overrides"
on public.recipe_overrides
for select
to anon
using (true);

drop policy if exists "Allow anon write recipe overrides" on public.recipe_overrides;
create policy "Allow anon write recipe overrides"
on public.recipe_overrides
for insert
to anon
with check (true);

drop policy if exists "Allow anon update recipe overrides" on public.recipe_overrides;
create policy "Allow anon update recipe overrides"
on public.recipe_overrides
for update
to anon
using (true)
with check (true);

drop policy if exists "Allow anon update recipe states" on public.recipe_states;
create policy "Allow anon update recipe states"
on public.recipe_states
for update
to anon
using (true)
with check (true);
