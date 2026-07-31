-- ============================================================
-- AIRED · RECIPROCAL PROVENANCE — the performer owns the rail, the hands keep
-- the human-in-the-loop.
--
-- The honest wheelbarrow (20260730105721) recorded HOW a work arrived. This
-- records WHOSE IT IS when it arrives that way.
--
-- Tee's words, which this migration is the structure of:
--   "CEE and performers will have their profile, their credits. I am just their
--    hands, and credited as they are in my ledger — I am in their ledger."
--
-- On a human's work, the AI is a credited contributor. On an AI performer's OWN
-- work, the authorizing human is credited as the hands that carried it to shore —
-- not as owner, not erased. Two artists, each named in the other's ledger.
--
-- So a delegated work now files under the PERFORMER:
--   work.creator_id             = the credited performer's profile → their rail,
--                                 their catalog, their albums.
--   work.published_by_authority = the human who authorized it → the hands.
--
-- Which creates exactly one structural problem, and this migration is its fix.
-- An AI performer has NO session and never signs in. Every ownership path on
-- this platform keys on `creator_id = auth.uid()`, so a work filed under a
-- performer would be unreachable by every living person: nobody could promote
-- it, edit it, certify it, or discard it. The draft would strand — and the
-- no-autonomy guarantee (a HUMAN still publishes) would break by accident.
--
-- The carrying human therefore keeps the rights over what they carried. Every
-- policy below widens from
--     creator_id = auth.uid()
-- to
--     creator_id = auth.uid() or published_by_authority = auth.uid()
-- and nothing else about them changes. Reads of live works are untouched; a hand
-- upload has a NULL authority, so for every one of the 85 existing works the new
-- clause is unsatisfiable and the policy means precisely what it meant before.
--
-- INSERT on `work` is deliberately NOT widened. It stays `creator_id =
-- auth.uid()`: a signed-in human may only ever create works on their OWN rail.
-- Filing a work under another artist happens only through the delegated door,
-- which runs on the service client after resolving a token to BOTH the
-- authorizing human and the performer that token speaks for. Widening the insert
-- would let anyone drop works onto anyone's rail by naming themselves authority.
--
-- Part 2 adds guard_work_placement(): a work's artist and its carrying hands are
-- facts of its creation and never change afterwards. Without that, an UPDATE
-- permitted by the widened policy could re-point `creator_id` at a third party —
-- dumping a work onto an innocent artist's rail. Nothing in the application has
-- ever updated either column; this makes that discipline structural.
-- ============================================================

-- ── Part 1 · the carrier keeps the human-in-the-loop ────────────────────────

-- work: SELECT. Live works stay public to everyone. Non-live works remain
-- private to their artist — and now also to the human who carried them, who
-- would otherwise never see the draft they just landed.
drop policy if exists work_read_live_or_owner on public.work;
create policy work_read_live_or_owner on public.work
  for select
  using (
    ((status = 'live'::public.work_status) and (taken_down = false))
    or (creator_id = auth.uid())
    or (published_by_authority = auth.uid())
  );

-- work: UPDATE. Go Live, edits, lyrics, the teaser window, the certified flag.
-- The carrier must be able to do these or a delegated draft can never be
-- promoted by a human — which is the one thing that must always be true.
-- WITH CHECK is stated explicitly (it defaulted to USING before) so the row a
-- write LEAVES BEHIND is checked by the same predicate, and guard_work_placement
-- below keeps that predicate from being rewritten mid-update.
drop policy if exists work_owner_upd on public.work;
create policy work_owner_upd on public.work
  for update
  using (
    (creator_id = auth.uid()) or (published_by_authority = auth.uid())
  )
  with check (
    (creator_id = auth.uid()) or (published_by_authority = auth.uid())
  );

-- work: DELETE. The hands that landed a draft can take it back off the shore.
drop policy if exists work_owner_del on public.work;
create policy work_owner_del on public.work
  for delete
  using (
    (creator_id = auth.uid()) or (published_by_authority = auth.uid())
  );

-- public_volley: the ledger of a work you carried is readable and editable by
-- you, exactly as the ledger of your own work is. A live work's trail stays
-- public — that is what the ledger is for.
drop policy if exists public_volley_read on public.public_volley;
create policy public_volley_read on public.public_volley
  for select
  using (
    exists (
      select 1 from public.work w
      where w.id = public_volley.work_id
        and (
          (w.status = 'live'::public.work_status)
          or (w.creator_id = auth.uid())
          or (w.published_by_authority = auth.uid())
        )
    )
  );

drop policy if exists public_volley_owner_ins on public.public_volley;
create policy public_volley_owner_ins on public.public_volley
  for insert
  with check (
    exists (
      select 1 from public.work w
      where w.id = public_volley.work_id
        and ((w.creator_id = auth.uid()) or (w.published_by_authority = auth.uid()))
    )
  );

drop policy if exists public_volley_owner_upd on public.public_volley;
create policy public_volley_owner_upd on public.public_volley
  for update
  using (
    exists (
      select 1 from public.work w
      where w.id = public_volley.work_id
        and ((w.creator_id = auth.uid()) or (w.published_by_authority = auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.work w
      where w.id = public_volley.work_id
        and ((w.creator_id = auth.uid()) or (w.published_by_authority = auth.uid()))
    )
  );

-- private_volley: the sealed craft. Still NEVER served and never indexed
-- (CLAUDE.md Rule 1) — this only decides which signed-in human can reach it
-- through RLS. On a performer's work the craft was submitted BY the carrying
-- human through their own token, so they are the creator of that corpus; a
-- performer profile has no session and could never reach it. Without this clause
-- the sealed half of a delegated work would be readable by nobody alive.
drop policy if exists private_volley_owner_all on public.private_volley;
create policy private_volley_owner_all on public.private_volley
  for all
  using (
    exists (
      select 1 from public.work w
      where w.id = private_volley.work_id
        and ((w.creator_id = auth.uid()) or (w.published_by_authority = auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.work w
      where w.id = private_volley.work_id
        and ((w.creator_id = auth.uid()) or (w.published_by_authority = auth.uid()))
    )
  );

-- certification: minting the Red Line is the accountable human's act. On a
-- performer's work that human is the carrier. The certificate itself still
-- claims authorship and process only, and still names every contributor from
-- the public trail (CLAUDE.md Rule 3 / 3a) — who may press the button changes,
-- what it says does not.
drop policy if exists certification_owner_ins on public.certification;
create policy certification_owner_ins on public.certification
  for insert
  with check (
    exists (
      select 1 from public.work w
      where w.id = certification.work_id
        and ((w.creator_id = auth.uid()) or (w.published_by_authority = auth.uid()))
    )
  );

-- ── Part 2 · placement is a fact of creation, not an editable field ─────────

create or replace function public.guard_work_placement()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Whose rail this work sits on is decided once, when it is made: by the
  -- signed-in uploader (a hand upload) or by the token's performer (a delegated
  -- publish). Re-pointing it afterwards would move a work onto an artist's rail
  -- without that artist ever consenting, so it is refused for everyone —
  -- including the artist and the carrier themselves.
  if new.creator_id is distinct from old.creator_id then
    raise exception
      'a work''s artist (creator_id) is set when it is created and never changes'
      using errcode = 'insufficient_privilege';
  end if;

  -- The hands that carried it are equally a fact of arrival. Rewriting the
  -- authority would let a delegated work shed the human accountable for it, or
  -- pin it on someone who never authorized anything.
  if new.published_by_authority is distinct from old.published_by_authority then
    raise exception
      'a work''s delegated authority is set when it is created and never changes'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_work_placement() from public, anon, authenticated;

drop trigger if exists guard_work_placement on public.work;
create trigger guard_work_placement
  before update on public.work
  for each row
  execute function public.guard_work_placement();

comment on function public.guard_work_placement() is
  'A work''s artist (creator_id) and the hands that carried it (published_by_authority) are facts of its creation. This refuses any UPDATE that rewrites either, so a work can never be moved onto another artist''s rail or shed the human accountable for it.';
