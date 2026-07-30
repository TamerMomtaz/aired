-- ============================================================
-- AIRED · THE HONEST WHEELBARROW — how a work reached the shore.
--
-- The Volley Ledger already tells the truth about WHO AUTHORED a work (HUMAN /
-- AI / DIALOGUE). This adds the second honest fact, side by side with it on
-- every work forever: HOW IT ARRIVED — by human hands at the UI, or by a program
-- posting on a human's delegated authority.
--
-- Nothing here creates or implies autonomous AI will. An AI performer does not
-- "decide" to publish: a HUMAN holds a token, and a program posts on that
-- human's authority. `published_by_authority` names that human. The label states
-- delegation, never autonomy.
--
--   published_via = 'human_ui'      → hands at the web UI. The session user IS
--                                     the uploader, so there is no separate
--                                     delegating authority (column stays NULL).
--   published_via = 'delegated_api' → POST /api/works/ingest under a named
--                                     token. `published_by_authority` is the
--                                     human who authorized it; NOT NULL always.
--
-- Column shape was discovered against the live project before writing this
-- (table `work`; draft/live state lives in `status public.work_status`), not
-- assumed.
--
-- Part 2 — enforce_publish_honesty(). The platform must be STRUCTURALLY unable
-- to misreport how a work arrived, even with an application bug or a hand-
-- crafted write. Same spirit as enforce_volley_origin / enforce_album_ownership:
-- the database refuses to hold a contradictory record. SECURITY INVOKER (it
-- touches no other table) with a pinned empty search_path, and execute revoked
-- from the API roles since it is reachable only via the trigger.
--
-- The trigger validates only rows as they are written: adding it changes no
-- existing data. Every pre-existing row is a hand upload and is backfilled to
-- 'human_ui' by the NOT NULL DEFAULT, with a NULL authority — already consistent.
-- ============================================================

-- ── Part 1 · the two honest columns (+ the audit label) ─────────────────────

-- How the work arrived. NOT NULL DEFAULT backfills every existing row to
-- 'human_ui' (they were all hand-uploaded) and makes future human-UI uploads
-- honest with no application change: createWork() sets nothing and gets
-- 'human_ui' automatically.
alter table public.work
  add column if not exists published_via text not null default 'human_ui';

alter table public.work
  drop constraint if exists work_published_via_check;
alter table public.work
  add constraint work_published_via_check
  check (published_via in ('human_ui', 'delegated_api'));

-- The human whose token authorized a delegated publish. NULL for human_ui rows.
-- FK → public.profile(id), the same table work.creator_id points at.
-- ON DELETE is left at NO ACTION deliberately: it is deferred to the end of the
-- statement, so deleting a profile still works when that profile's works cascade
-- away in the same statement, while a delegated row can never be orphaned or
-- silently NULLed (ON DELETE SET NULL would contradict the trigger below).
alter table public.work
  add column if not exists published_by_authority uuid
  references public.profile (id);

-- Which named token was used ("cee-wheelbarrow"), so multiple delegated tokens
-- are tellable apart in the ledger without ever exposing the secret itself.
-- Only ever a LABEL — never a token, never a hash of one.
alter table public.work
  add column if not exists ingest_token_label text;

-- Machines retry. The caller's idempotency key makes a retried POST return the
-- draft it already created instead of minting a second AIRED number.
alter table public.work
  add column if not exists ingest_idempotency_key uuid;

-- Uniqueness is scoped PER AUTHORITY, not global: two different delegating
-- humans must never collide on a key, and the route looks a replay up by
-- (authority, key) so one authority's retry can never resolve to another's work.
create unique index if not exists work_ingest_idempotency_key_uniq
  on public.work (published_by_authority, ingest_idempotency_key)
  where ingest_idempotency_key is not null;

-- Owner-facing provenance lookups on /manage read this per work; a partial index
-- keeps the delegated slice cheap to scan without touching the human-UI rows.
create index if not exists work_published_via_delegated_idx
  on public.work (published_via)
  where published_via = 'delegated_api';

comment on column public.work.published_via is
  'How this work reached AIRED: human_ui (hands at the web UI) or delegated_api (a program posting on a human''s delegated authority). Never implies autonomous AI publishing.';
comment on column public.work.published_by_authority is
  'The human who authorized a delegated publish (NOT NULL when published_via = delegated_api). NULL for human_ui — there the session user is already the authority.';
comment on column public.work.ingest_token_label is
  'Human-readable label of the delegated token used (never the secret or its hash). NULL for human_ui.';
comment on column public.work.ingest_idempotency_key is
  'Caller-supplied retry key for a delegated publish, unique per authority. NULL for human_ui.';

-- ── Part 2 · the honesty trigger ────────────────────────────────────────────

create or replace function public.enforce_publish_honesty()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Defense in depth beside the CHECK constraint.
  if new.published_via is null
     or new.published_via not in ('human_ui', 'delegated_api') then
    raise exception
      'published_via must be human_ui or delegated_api (got %)', new.published_via
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
