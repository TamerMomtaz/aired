-- MY MIXES: the mixes a person makes in the AIRED Mixer, kept on their account
-- so they play on any device they sign in on.
--
-- A mix is NOT a catalog work: it has no catalog number, no ledger and no Red
-- Line, and it never appears in the feed, search or charts. It is private to
-- its maker by default. The maker can switch SHARE on for a mix, which lets
-- anyone with its link play it; every source work and its makers stay credited
-- on that page (CLAUDE.md §3a). Putting a mix into the catalog is a separate,
-- later decision (it needs a ledger and the source creators' consent).
--
-- Flow: the browser uploads the rendered mix to the private `masters` bucket in
-- the owner's own folder; /api/mixes inserts this row (credits are built on the
-- server from the source works, never taken from the client); the transcode
-- worker turns the master into HLS on R2 (Rule 6), records hls_playlist_key with
-- the service role, and removes the source upload.

create table public.mix (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  duration_seconds numeric not null check (duration_seconds > 0),
  bpm numeric,
  energy text check (energy in ('Lounge', 'Club', 'Peak')),
  dj_name text check (dj_name is null or char_length(dj_name) <= 40),
  story text check (story is null or char_length(story) <= 600),
  planned_by text not null default 'rules' check (planned_by in ('brain', 'rules')),
  -- The catalog works it was built from, in set order.
  source_work_ids bigint[] not null default '{}',
  -- [{ work_id, label, by }] — built server-side from the source works.
  credits jsonb not null default '[]'::jsonb,
  -- The upload in the private `masters` bucket, under the owner's own folder.
  master_storage_path text,
  -- Set by the worker once the HLS rendition is on R2.
  hls_playlist_key text,
  shared boolean not null default false,
  created_at timestamptz not null default now()
);

create index mix_owner_created_idx on public.mix (owner_id, created_at desc);

alter table public.mix enable row level security;

-- The maker sees all of their own mixes; anyone sees a mix its maker shared.
create policy mix_owner_read on public.mix
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy mix_shared_read on public.mix
  for select to anon, authenticated
  using (shared);

-- The maker adds mixes as themselves, with the upload in their own folder.
create policy mix_owner_insert on public.mix
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and hls_playlist_key is null
    and (master_storage_path is null or split_part(master_storage_path, '/', 1) = (select auth.uid())::text)
  );

create policy mix_owner_update on public.mix
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy mix_owner_delete on public.mix
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- The maker may only rename a mix and switch sharing; everything else is set
-- once at insert or by the worker (service role).
revoke update on public.mix from anon, authenticated;
grant update (title, shared) on public.mix to authenticated;
revoke insert on public.mix from anon;
