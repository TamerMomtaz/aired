-- album_id links a work to its album (and, transitively, to the album's owner =
-- the artist). Nullable for now; the upload flow will require it later. No
-- ownership enforcement here — album.profile_id is the source of truth and the
-- existing work policies are unchanged. on delete set null so removing a cover
-- never deletes or blocks the songs underneath it; they simply become unfiled.
alter table public.work
  add column if not exists album_id uuid references public.album(id) on delete set null;

create index if not exists idx_work_album on public.work (album_id);

-- A one-line reason shown to the uploader when a 'pending' work is declined
-- back to 'draft'; NULL otherwise (drafts / live carry no note). Column only for
-- now — the Review queue that writes it is a later, UI phase.
alter table public.work
  add column if not exists moderation_note text;

comment on column public.work.album_id is
  'The album this work belongs to (its cover). Implies the work''s artist via album.profile_id. Nullable for now; required by the upload flow later.';
comment on column public.work.moderation_note is
  'One-line reason shown to the uploader when a ''pending'' work is declined back to ''draft''. NULL otherwise.';
