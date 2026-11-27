-- CampusFest Growth OS — optional Supabase (free tier) persistence.
-- Run in Supabase → SQL Editor, then set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
-- One row per workspace holds the team's campaigns, plan overlays, experiments, tasks and activity log (JSON).

create table if not exists public.workspace_state (
  id          text primary key,
  state       jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.workspace_state enable row level security;

-- Demo policy: anyone holding the anon key can read/write workspace rows.
-- Fine for a take-home demo with synthetic data. For real use, add Supabase Auth and
-- restrict rows to authenticated team members (e.g. using auth.uid() and a members table).
drop policy if exists "demo read"  on public.workspace_state;
drop policy if exists "demo write" on public.workspace_state;
drop policy if exists "demo update" on public.workspace_state;
create policy "demo read"   on public.workspace_state for select using (true);
create policy "demo write"  on public.workspace_state for insert with check (true);
create policy "demo update" on public.workspace_state for update using (true) with check (true);

-- Table privileges. Newer Supabase projects do not auto-grant tables created in SQL to the API roles,
-- which shows up in the app as "permission denied for table workspace_state".
grant usage on schema public to anon, authenticated;
grant select, insert, update on public.workspace_state to anon, authenticated;
