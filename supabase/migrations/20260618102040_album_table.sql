-- ============================================================
-- AIRED · Album — a cover that opens to songs, owned by a profile (= the artist).
-- One account = one artist (v1), so an album's owner is simply its profile_id.
-- Public to read (incl. anon, like live works); only the owner may write.
-- Mirrors the work table's owner-scoped policy shape.
-- ============================================================
create table public.album (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profile(id) on delete cascade,
  title       text not null,
  cover_url   text,
  description text,
  created_at  timestamptz not null default now()
);

create index idx_album_profile on public.album (profile_id);

alter table public.album enable row level security;

-- Public read: the cover and its metadata are meant to be seen.
create policy album_read_all on public.album for select using (true);

-- Writes are owner-only. with check on insert + update pins profile_id to the
-- caller, so ownership can be neither forged nor transferred away.
create policy album_owner_ins on public.album for insert
  with check (profile_id = auth.uid());
create policy album_owner_upd on public.album for update
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy album_owner_del on public.album for delete
  using (profile_id = auth.uid());
