-- ============================================================
-- AIRED · CARRYING A PERFORMER FROM THE UI — authority as a platform fact.
--
-- The delegated door (20260730105721) let a program land a work on an AI
-- performer's rail under a named human's token. The performer owns the rail, the
-- human is the hands, and both are named in the ledger. That worked — AIRED-0097
-- and AIRED-0098 are on (&) CEE's rail because of it.
--
-- But the authority behind it lived in an env var. A token IS a credential; it is
-- not the fact it stands for. The fact is a relationship between two profiles:
--
--     this HUMAN may carry this PERFORMER
--
-- A credential can be issued, rotated, and revoked; the relationship it exercises
-- outlives all three. So this migration writes the relationship down as a row —
-- `performer_authority` — and every future performer becomes ONE ROW, not a code
-- change and not a redeploy. That is what makes the UI path scalable rather than
-- a hard-coded favour for CEE.
--
-- Part 1 · performer_authority — who may carry whom.
-- Part 2 · published_via gains 'ui_performer' — the third honest arrival story.
-- Part 3 · the RLS gate — the server-side refusal, in the database itself.
--
-- What is deliberately NOT changed: the delegated door still authorizes off its
-- env token, exactly as it does today. Part 1 backfills a grant for every pair
-- that door has ALREADY carried, so the table and the token set agree from the
-- first second; pointing the token door at this table too is the follow-up, and
-- doing it here would mean changing a live publishing path nobody asked me to
-- touch.
-- ============================================================

-- ── Part 1 · who may carry whom ─────────────────────────────────────────────

create table if not exists public.performer_authority (
  -- The artist whose rail may be filed onto. An AI performer never signs in, so
  -- this row is the ONLY way a work can reach their catalog with their consent
  -- recorded — consent given by the platform on their behalf, in the open,
  -- rather than implied by whoever happens to hold a secret.
  performer_id uuid not null references public.profile (id) on delete cascade,
  -- The human authorized to carry them: the hands, named in every ledger they
  -- land. Not the owner of the performer — nobody owns an artist here.
  human_id     uuid not null references public.profile (id) on delete cascade,
  -- Why this grant exists, in a sentence, for whoever reads it in a year.
  note         text,
  granted_at   timestamptz not null default now(),
  -- The admin who granted it. NULL for the historical backfill below, which was
  -- granted by the platform's own past behaviour rather than by a person.
  granted_by   uuid references public.profile (id),
  primary key (performer_id, human_id),
  -- Carrying yourself is not carrying: that is simply uploading your own work,
  -- and it needs no grant. A self-row would make `creator_id <> authority`
  -- ambiguous everywhere downstream.
  constraint performer_authority_not_self check (performer_id <> human_id)
);

-- The dropdown asks exactly one question — "whom may I carry?" — on every render
-- of the upload page.
create index if not exists performer_authority_human_idx
  on public.performer_authority (human_id);

alter table public.performer_authority enable row level security;

-- READ: your own grants, so the upload page can offer them. An admin sees them
-- all, because granting is an admin act and they need to see what they granted.
-- Nobody else sees any row: who carries whom is not a public fact, and a list of
-- carriable performers is a list of rails worth attacking.
drop policy if exists performer_authority_read_own on public.performer_authority;
create policy performer_authority_read_own on public.performer_authority
  for select
  using (
    (human_id = auth.uid())
    or (select p.is_admin from public.profile p where p.id = auth.uid())
  );

-- WRITE: admin only, all three verbs. A grant is governance — the platform
-- vouching that this human may stand for this artist. It is emphatically NOT
-- self-service: a user who could insert their own grant would have written
-- themselves the very permission this whole migration exists to withhold.
drop policy if exists performer_authority_admin_ins on public.performer_authority;
create policy performer_authority_admin_ins on public.performer_authority
  for insert
  with check ((select p.is_admin from public.profile p where p.id = auth.uid()));

drop policy if exists performer_authority_admin_upd on public.performer_authority;
create policy performer_authority_admin_upd on public.performer_authority
  for update
  using ((select p.is_admin from public.profile p where p.id = auth.uid()))
  with check ((select p.is_admin from public.profile p where p.id = auth.uid()));

drop policy if exists performer_authority_admin_del on public.performer_authority;
create policy performer_authority_admin_del on public.performer_authority
  for delete
  using ((select p.is_admin from public.profile p where p.id = auth.uid()));

comment on table public.performer_authority is
  'Who may carry whom: one row per (performer, authorized human). The platform''s record of the relationship a delegated token merely exercises — an AI performer never signs in, so this is where their rail''s consent is written down. Admin-granted; read by the upload page and by the work INSERT policy.';

-- The backfill. Every work already carried for a performer is evidence of a
-- grant that was real but unwritten; this states it. Derived from the data
-- rather than from hard-coded uuids, so a fresh environment seeds itself
-- correctly (or seeds nothing, which is also correct there).
insert into public.performer_authority (performer_id, human_id, note)
select distinct
  w.creator_id,
  w.published_by_authority,
  'backfilled from works this human had already carried onto this rail'
from public.work w
where w.published_by_authority is not null
  and w.published_by_authority is distinct from w.creator_id
on conflict (performer_id, human_id) do nothing;

-- ── Part 2 · the third honest arrival story ─────────────────────────────────
--
-- Three doors now, and the value names which one — never how much autonomy was
-- involved, because the answer is always none:
--
--   human_ui      → hands at the web UI, filing under themselves. No separate
--                   authority, no token. (Unchanged.)
--   delegated_api → a program POSTing under a named human's token. (Unchanged.)
--   ui_performer  → hands at the web UI, filing under a performer they are
--                   authorized to carry. A human authority, and NO token.
--
-- `ui_performer` is added rather than folding this into `human_ui` because
-- `human_ui`'s meaning is enforced, not decorative: it currently guarantees
-- authority IS NULL. Reusing it would mean deleting that guarantee for every
-- hand upload on the platform to accommodate one new case — trading a checkable
-- fact for an unfalsifiable label. Three values keep three tight invariants.
--
-- The LEDGER is unaffected: a work carried through this door gets the same
-- creator/authority split and the same reciprocal audit/HUMAN hands volley as
-- one carried through the token door. `published_via` records the door, not the
-- authorship.

alter table public.work
  drop constraint if exists work_published_via_check;
alter table public.work
  add constraint work_published_via_check
  check (published_via in ('human_ui', 'delegated_api', 'ui_performer'));

-- SECURITY DEFINER, changed from invoker, for one specific reason: this function
-- now reads `performer_authority`, which is NOT publicly selectable (unlike the
-- album row enforce_album_ownership reads). As invoker, the grant check would
-- silently depend on the writer's own read policy — a check that can pass or
-- fail for reasons unrelated to whether the grant exists is not a check. As
-- definer it answers the real question. Execute stays revoked from the API
-- roles; it is reachable only through the trigger.
create or replace function public.enforce_publish_honesty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Defense in depth beside the CHECK constraint.
  if new.published_via is null
     or new.published_via not in ('human_ui', 'delegated_api', 'ui_performer') then
    raise exception
      'published_via must be human_ui, delegated_api or ui_performer (got %)',
      new.published_via
      using errcode = 'check_violation';
  end if;

  if new.published_via = 'delegated_api' then
    -- A delegated publish ALWAYS names the human who authorized it. This is the
    -- whole honesty of the wheelbarrow: no anonymous machine arrivals.
    if new.published_by_authority is null then
      raise exception
        'a delegated publish must name the human authority that authorized it'
        using errcode = 'check_violation';
    end if;

    -- The delegated door lands DRAFTS ONLY — no path skips the human review
    -- step. Promotion to pending/live happens later, as a separate deliberate
    -- UPDATE by a human (goLive), so this is checked on INSERT only.
    if tg_op = 'INSERT' and new.status <> 'draft' then
      raise exception
        'a delegated publish must arrive as a draft (got status %)', new.status
        using errcode = 'check_violation';
    end if;

  elsif new.published_via = 'ui_performer' then
    -- Hands at the UI, filing onto someone else's rail. Every clause below is a
    -- way this row could otherwise lie about that.

    -- Someone carried it. A performer work with no named hands is exactly the
    -- anonymous machine arrival the platform refuses to hold.
    if new.published_by_authority is null then
      raise exception
        'a work filed under a performer must name the human who filed it'
        using errcode = 'check_violation';
    end if;

    -- The artist and the hands are two different people, or this is not a
    -- performer filing at all — it is an ordinary self-upload wearing the label,
    -- and it would read on every surface as "carried for" someone it is not.
    if new.published_by_authority = new.creator_id then
      raise exception
        'ui_performer means filing under ANOTHER artist — for your own work use human_ui'
        using errcode = 'check_violation';
    end if;

    -- No token was presented: a human sat at the upload page. Carrying a token
    -- label or a machine retry key would credit an automation that never ran.
    if new.ingest_token_label is not null then
      raise exception
        'a ui_performer upload carries no delegated token label — no token was used'
        using errcode = 'check_violation';
    end if;
    if new.ingest_idempotency_key is not null then
      raise exception
        'a ui_performer upload carries no ingest idempotency key — no machine retried it'
        using errcode = 'check_violation';
    end if;

    -- Same review gate as every other door: it lands as a draft, and a human
    -- still presses Go Live. INSERT-only, so goLive's UPDATE is untouched.
    if tg_op = 'INSERT' and new.status <> 'draft' then
      raise exception
        'a work filed under a performer must arrive as a draft (got status %)',
        new.status
        using errcode = 'check_violation';
    end if;

    -- THE GATE, structurally. RLS refuses this insert already for anyone without
    -- the grant; this refuses it for EVERY writer, service role included, so no
    -- application bug and no elevated client can put a work on an artist's rail
    -- that nobody was ever authorized to carry.
    --
    -- INSERT-only, deliberately: placement is a fact of arrival (see
    -- guard_work_placement). Re-checking on UPDATE would mean that revoking a
    -- grant retroactively froze works already carried under it — the carrier
    -- could no longer promote, edit, or discard their own past drafts, and a
    -- performer's live catalog would become unmaintainable by any living person.
    -- Revocation stops NEW arrivals; it does not rewrite history.
    if tg_op = 'INSERT' and not exists (
      select 1 from public.performer_authority pa
      where pa.performer_id = new.creator_id
        and pa.human_id = new.published_by_authority
    ) then
      raise exception
        'no authority to carry this artist — % is not authorized to file works under %',
        new.published_by_authority, new.creator_id
        using errcode = 'insufficient_privilege';
    end if;

  else
    -- A hand upload has no separate delegating authority (the session user IS
    -- the uploader), no delegated token, and no machine retry key. A human_ui
    -- row carrying any of the three would be a contradictory record.
    if new.published_by_authority is not null then
      raise exception
        'a human_ui upload has no separate delegating authority — the uploader is the session user'
        using errcode = 'check_violation';
    end if;
    if new.ingest_token_label is not null then
      raise exception
        'a human_ui upload carries no delegated token label'
        using errcode = 'check_violation';
    end if;
    if new.ingest_idempotency_key is not null then
      raise exception
        'a human_ui upload carries no ingest idempotency key'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_publish_honesty() from public, anon, authenticated;

drop trigger if exists enforce_publish_honesty on public.work;
create trigger enforce_publish_honesty
  before insert or update on public.work
  for each row
  execute function public.enforce_publish_honesty();

comment on column public.work.published_via is
  'How this work reached AIRED: human_ui (hands at the web UI, filing under themselves), delegated_api (a program posting on a human''s delegated authority), or ui_performer (hands at the web UI, filing under a performer they are authorized to carry). Never implies autonomous AI publishing.';
comment on column public.work.published_by_authority is
  'The human accountable for this arrival: the token holder for delegated_api, the carrying hands for ui_performer. NOT NULL for both; NULL for human_ui, where the session user is already the authority.';

-- ── Part 3 · the gate, in RLS ───────────────────────────────────────────────
--
-- Hiding the dropdown is not security. THIS is: a signed-in user may insert a
-- work onto another artist's rail only if a grant row says they may, and the
-- check runs inside the database on every insert, whatever crafted the request.
--
-- The first branch is the old policy with one clause added: a self-upload also
-- has no delegating authority. That was already true of every row the app has
-- ever written and is already enforced by the honesty trigger; stating it here
-- keeps the two branches disjoint, so "which door is this?" has one answer.
drop policy if exists work_owner_ins on public.work;
create policy work_owner_ins on public.work
  for insert
  with check (
    -- My own rail, my own hands. Unchanged behavior for every existing user.
    ((creator_id = auth.uid()) and (published_by_authority is null))
    -- Or a performer's rail, by a human authorized to carry that performer.
    or (
      (published_via = 'ui_performer')
      and (published_by_authority = auth.uid())
      and (creator_id <> auth.uid())
      and (status = 'draft'::public.work_status)
      and exists (
        select 1 from public.performer_authority pa
        where pa.performer_id = work.creator_id
          and pa.human_id = auth.uid()
      )
    )
  );

-- Albums belong to the ARTIST (enforce_album_ownership), so a performer's work
-- can only ever be filed into a performer's album. A carrier who can land works
-- on that rail but can never start an album for it would be strictly weaker than
-- the token door, which creates performer albums inline — so the same grant
-- opens the same capability here. Only INSERT: renaming or deleting an artist's
-- albums is a bigger claim than carrying a work, and no surface asks for it yet.
drop policy if exists album_owner_ins on public.album;
create policy album_owner_ins on public.album
  for insert
  with check (
    (profile_id = auth.uid())
    or exists (
      select 1 from public.performer_authority pa
      where pa.performer_id = album.profile_id
        and pa.human_id = auth.uid()
    )
  );

-- An album's artist is a fact of its creation, exactly as a work's is
-- (guard_work_placement). Without this, re-pointing album.profile_id would strand
-- its member works under a different artist than the album claims — a
-- contradiction enforce_album_ownership only checks from the work's side.
create or replace function public.guard_album_placement()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.profile_id is distinct from old.profile_id then
    raise exception
      'an album''s artist (profile_id) is set when it is created and never changes'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_album_placement() from public, anon, authenticated;

drop trigger if exists guard_album_placement on public.album;
create trigger guard_album_placement
  before update on public.album
  for each row
  execute function public.guard_album_placement();

comment on function public.guard_album_placement() is
  'An album''s artist (profile_id) is a fact of its creation. Refuses any UPDATE that rewrites it, so an album can never be moved onto another artist''s rail with its member works still attached.';
