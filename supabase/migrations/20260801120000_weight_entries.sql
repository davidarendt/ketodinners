-- Weight tracker (side project living at /weight/ on this site).
-- Self-contained + namespaced so it can be lifted into its own project later.
-- RLS is permissive for anon to match the rest of this project; the Netlify
-- function is the trust boundary and additionally enforces a shared PIN.

create table if not exists public.weight_entries (
  id uuid primary key default gen_random_uuid(),
  measured_at timestamptz not null default now(),
  weight numeric not null,                 -- value in `unit`
  unit text not null default 'lb',         -- 'lb' | 'kg'
  body_fat_pct numeric,
  muscle_mass numeric,
  body_water_pct numeric,
  bmi numeric,
  bone_mass numeric,
  visceral_fat numeric,
  bmr integer,
  metabolic_age integer,
  note text,
  source text not null default 'manual',   -- 'manual' | 'renpho' | 'import'
  metrics jsonb,                           -- any extra fields (e.g. full Renpho export)
  created_at timestamptz not null default now()
);

create index if not exists weight_entries_measured_at_idx
  on public.weight_entries (measured_at desc);

alter table public.weight_entries enable row level security;

drop policy if exists "Allow anon read weight entries" on public.weight_entries;
create policy "Allow anon read weight entries"
on public.weight_entries for select to anon using (true);

drop policy if exists "Allow anon insert weight entries" on public.weight_entries;
create policy "Allow anon insert weight entries"
on public.weight_entries for insert to anon with check (true);

drop policy if exists "Allow anon update weight entries" on public.weight_entries;
create policy "Allow anon update weight entries"
on public.weight_entries for update to anon using (true) with check (true);

drop policy if exists "Allow anon delete weight entries" on public.weight_entries;
create policy "Allow anon delete weight entries"
on public.weight_entries for delete to anon using (true);
