-- One-time backfill: stand up the founding artist's identity, the first album,
-- and file that artist's existing catalog under it. This is the ONLY place
-- specific values are written; the schema/logic above is generic.
--
-- Note on creator scope: the live catalog spans two accounts. The founding
-- artist (Tee) owns the large majority; a second, later account owns a couple of
-- works. Per the founder's decision, ONLY Tee's own works are filed under Tee's
-- album (an album implies its artist — CLAUDE.md Rule 3a); the other account's
-- works are left unfiled (album_id NULL — the column is nullable). Tee's profile
-- id is derived from the data (the creator with, by a clear margin, the most
-- works), not hardcoded; the album id is captured via RETURNING, never hardcoded.
do $$
declare
  v_tee    uuid;
  v_top    bigint;
  v_second bigint;
  v_album  uuid;
  v_filed  int;
begin
  -- Founding artist = the creator of the most works.
  select creator_id, n into v_tee, v_top
  from (
    select creator_id, count(*) as n
    from public.work
    group by creator_id
    order by count(*) desc, creator_id
    limit 1
  ) t;

  if v_tee is null then
    raise exception 'Backfill aborted: no works found';
  end if;

  -- Guard against ambiguity: the founding artist must own strictly more works
  -- than any other single account.
  select coalesce(max(n), 0) into v_second
  from (
    select count(*) as n
    from public.work
    where creator_id <> v_tee
    group by creator_id
  ) s;
  if v_top <= v_second then
    raise exception 'Backfill aborted: founding creator is ambiguous (top=%, runner-up=%)', v_top, v_second;
  end if;

  -- Public identity + admin/trust bootstrap. This UPDATE runs as the service
  -- role (auth.uid() is null), so profile_privilege_guard permits setting
  -- trusted/is_admin — the intended first-admin bootstrap path.
  update public.profile
     set display_name = 'Tee Momtaz',
         mascot_name  = 'Kahotia',
         trusted      = true,
         is_admin     = true
   where id = v_tee;

  -- The first album cover. Idempotent on (owner, title); capture its generated id.
  select id into v_album
    from public.album
   where profile_id = v_tee and title = 'Ionganica AI-red'
   limit 1;
  if v_album is null then
    insert into public.album (title, profile_id)
    values ('Ionganica AI-red', v_tee)
    returning id into v_album;
  end if;

  -- File the founding artist's OWN works under that album. The other account's
  -- works are deliberately left unfiled.
  update public.work
     set album_id = v_album
   where creator_id = v_tee
     and album_id is distinct from v_album;
  get diagnostics v_filed = row_count;

  raise notice 'Backfill complete: founder=%, album=%, works filed=%', v_tee, v_album, v_filed;
end;
$$;
