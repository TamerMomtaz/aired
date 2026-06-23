-- ============================================================
-- AIRED · LEDGER · guard volley origin against contributor type + make volleys
-- correctable.
--
-- A volley's `origin` (HUMAN / AI / DIALOGUE) must never contradict its
-- contributor's `agent.type`. A silicon contributor (ai_model) could not have
-- carried a HUMAN-origin move, and a human could not have carried an AI-origin
-- one. DIALOGUE — the "neither alone" move (CLAUDE.md §7) — stays legal for ANY
-- contributor, and ai_voice / tool carry no restriction. The Declare-a-volley
-- form had no such guard and the DB had no backstop, so an ai_model could be
-- recorded origin=HUMAN (it happened on a live work). This is the structural
-- root cause; the trigger below closes it for every write path (the
-- declare_volley RPC insert and the new owner edit update alike).
--
-- enforce_volley_origin() is SECURITY INVOKER (it only reads the
-- publicly-selectable agent row — agent_read_all is `using (true)` — so it
-- needs no elevated rights) with a pinned empty search_path, and execute revoked
-- from the API roles since it is reachable only via the trigger — mirroring
-- enforce_album_ownership, to keep the privileged surface minimal. (Trigger
-- execution does not require EXECUTE on the function.)
--
-- This validates only NEW rows: existing volleys are untouched by adding it, so
-- no current data changes. A row that already contradicts is simply caught the
-- next time it is edited — which is the moment the owner is fixing it anyway.
--
-- Part 2 — editability. public_volley had INSERT + SELECT policies but no
-- UPDATE, so a mislabel meant rebuilding the volley. public_volley_owner_upd
-- lets the work's owner correct the PUBLIC-SKELETON fields (origin / role /
-- delta_type) in place. It mirrors work_owner_upd, adapted to public_volley's
-- ownership-via-work (it carries no creator_id of its own — exactly like the
-- existing public_volley_owner_ins / public_volley_read). Editing these skeleton
-- fields does NOT touch the sealed private_volley craft or its private_hash, so
-- no re-seal is required and the Red Line stays intact.
-- ============================================================

create or replace function public.enforce_volley_origin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  a_type text;
begin
  select type::text into a_type from public.agent where id = new.agent_id;

  if a_type = 'ai_model' and new.origin::text = 'HUMAN' then
    raise exception
      'origin HUMAN invalid for ai_model contributor (use AI or DIALOGUE)'
      using errcode = 'check_violation';
  end if;

  if a_type = 'human' and new.origin::text = 'AI' then
    raise exception
      'origin AI invalid for human contributor (use HUMAN or DIALOGUE)'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_volley_origin() from public, anon, authenticated;

drop trigger if exists trg_enforce_volley_origin on public.public_volley;
create trigger trg_enforce_volley_origin
  before insert or update on public.public_volley
  for each row
  execute function public.enforce_volley_origin();

-- Owner-only UPDATE so a mislabel is a five-second fix, never "start over".
drop policy if exists public_volley_owner_upd on public.public_volley;
create policy public_volley_owner_upd on public.public_volley
  for update
  using (
    exists (
      select 1 from public.work w
      where w.id = public_volley.work_id and w.creator_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.work w
      where w.id = public_volley.work_id and w.creator_id = auth.uid()
    )
  );
