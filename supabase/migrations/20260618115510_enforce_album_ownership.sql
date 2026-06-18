-- ============================================================
-- AIRED · ORGANIZE · enforce album ownership (authorship integrity)
-- A work may be filed only into an album owned by the SAME artist. An album
-- implies its artist (CLAUDE.md Rule 3a), so work.album_id must always point to
-- an album whose owner is the work's creator.
--
-- The album table's owner-only write policies already stop a creator from
-- editing someone else's album, and work_owner_upd pins work.creator_id to the
-- caller — but nothing yet stops a creator from setting work.album_id to ANOTHER
-- creator's album: the work RLS only ever checks creator_id, never album_id. This
-- BEFORE INSERT OR UPDATE trigger closes that gap by refusing any cross-owner
-- filing. It is an integrity invariant, true for every writer (no service-role
-- exception): the backfill already respects it, and every existing row satisfies
-- it, so adding the trigger changes no current data.
--
-- SECURITY INVOKER (it only reads the publicly-selectable album row, so it needs
-- no elevated rights) with a pinned empty search_path, and execute revoked from
-- the API roles since it is reachable only via the trigger — mirroring
-- guard_profile_privilege_columns, to keep the privileged surface minimal.
-- (Trigger execution does not require EXECUTE on the function.)
--
-- album_id is a FK with ON DELETE SET NULL, so a non-null album_id always
-- resolves to a live album row whose profile_id is NOT NULL — there is no
-- missing-row case for the subquery to mishandle.
-- ============================================================
create or replace function public.enforce_album_ownership()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.album_id is not null
     and (select profile_id from public.album where id = new.album_id)
         is distinct from new.creator_id then
    raise exception
      'You may only file your work into your own album'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_album_ownership() from public, anon, authenticated;

drop trigger if exists enforce_album_ownership on public.work;
create trigger enforce_album_ownership
  before insert or update on public.work
  for each row
  execute function public.enforce_album_ownership();
