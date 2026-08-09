-- ============================================================
-- AIRED · Adornment — the ledger pointed at the listener.
--
-- The Volley Ledger records who MADE a work. This table records who KEPT one.
-- A maker credits a song in the ledger; a listener adorns it with a heart. One
-- row per (listener, work).
--
-- It is deliberately NOT attribution and touches nothing the Red Line certifies:
-- an adornment says nothing about who made a work, carries no craft, and never
-- appears on a public surface. It is private listener data — visible only to the
-- listener who made it, never to the maker, never to an admin, never counted in
-- public. (A public "most adorned" number would be a different feature with a
-- different privacy promise; this one does not open that door.)
-- ============================================================
create table public.adornment (
  id          uuid   primary key default gen_random_uuid(),
  profile_id  uuid   not null references public.profile(id) on delete cascade,
  work_id     bigint not null references public.work(id)    on delete cascade,
  created_at  timestamptz not null default now(),
  -- One heart per listener per song: tapping twice takes it back, never doubles.
  unique (profile_id, work_id)
);

-- The Adorned view is exactly "my rows, newest first" — this index serves that
-- read whole, without a sort.
create index idx_adornment_profile_created
  on public.adornment (profile_id, created_at desc);
-- The work-side cascade needs its own index, or deleting a work scans every
-- adornment on the platform to find the rows to drop.
create index idx_adornment_work on public.adornment (work_id);

alter table public.adornment enable row level security;

-- Strictly mine, on every verb. `with check` on insert pins profile_id to the
-- caller, so a row can be neither forged onto someone else's shelf nor handed
-- away. There is no UPDATE policy on purpose: an adornment has nothing to edit
-- — it exists or it doesn't — so the table offers no way to mutate one.
create policy adornment_read_own on public.adornment for select
  using (profile_id = auth.uid());
create policy adornment_ins_own on public.adornment for insert
  with check (profile_id = auth.uid());
create policy adornment_del_own on public.adornment for delete
  using (profile_id = auth.uid());
