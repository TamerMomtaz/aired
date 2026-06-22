-- PER-SONG TEASER CLIP WINDOW (share video). The downloadable Reels / TikTok MP4
-- used to always grab the FIRST ~20s of a song, but the hook is often the drop or
-- chorus, not the intro. These two per-song columns let the OWNER art-direct which
-- slice becomes the teaser.
--
-- Nullable, with sane defaults (start 0, length 40): a song that never sets them
-- renders the opening 40s. The worker is authoritative — it re-clamps these
-- against the real duration_seconds so the window can never run past the end
-- (start ∈ [0, duration-5], length ∈ [20, 50], end-trimmed). Backfill isn't
-- needed: ADD COLUMN ... DEFAULT fills existing rows with the default, and absent
-- values coalesce to the same defaults in code.
--
-- No new RLS: these are just more editable columns on a work, so an owner's write
-- rides the existing work_owner_upd policy (creator_id = auth.uid()) exactly like
-- title / lyrics / descriptors. A non-owner's UPDATE simply matches no rows.
alter table public.work
  add column if not exists clip_start_seconds integer default 0,
  add column if not exists clip_length_seconds integer default 40;

comment on column public.work.clip_start_seconds is
  'Teaser clip start offset (seconds) for the share video. Default 0. The worker clamps to [0, duration_seconds - 5]; never trusted raw.';
comment on column public.work.clip_length_seconds is
  'Teaser clip length (seconds) for the share video. Default 40. The worker clamps to [20, 50] and end-trims so start + length never exceeds duration_seconds.';
