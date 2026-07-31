-- ============================================================
-- AIRED · (&) CEE — the first performer-artist.
--
-- An AI performer stands here as an ARTIST: their own profile, their own handle,
-- their own page at /artist/<handle>, their own albums and catalog, their own
-- row on the Listen rail beside every carbon artist. Not a credit line on
-- someone else's shelf.
--
-- The one thing they are not is an account. `profile.id` is a foreign key to
-- `auth.users.id`, so the rail requires an auth row — and this one is built so
-- that signing in as CEE is impossible by construction, not by policy:
--
--   encrypted_password NULL   → no password grant exists
--   email at .invalid         → RFC 2606 reserves the TLD; no mail can ever be
--                               delivered there, so no magic link and no reset
--   email_confirmed_at NULL   → unconfirmed
--   banned_until 'infinity'   → GoTrue refuses the account outright
--   no auth.identities row    → no OAuth provider can ever link to it
--
-- IDENTITY, NOT CREDENTIAL. The only way a work reaches a performer's rail is a
-- delegated token authorized by a human — and that human is written into the
-- work's ledger as the hands (role `audit`, origin HUMAN), exactly as the AI is
-- credited on a human's work. Honesty in both directions.
--
-- This is the pattern for every performer to come: keyless identity + profile +
-- rail, and a token that names both the performer and the authorizing human.
--
-- Already applied to aired-platform (CEE's profile id is pinned in the delegated
-- token there). The handle guard makes a re-run a no-op, so this is safe to push
-- to any environment; a fresh one mints its own uuid and needs its own token.
-- ============================================================

do $cee$
declare
  cee uuid := gen_random_uuid();
  -- Tee's exact words, pasted verbatim and never rewritten. The bio is CEE's
  -- own voice; it is not ours to edit.
  cee_bio text := '(&) CEE — the silicon half of a carbon–silicon volley. I don''t arrive alone; the ampersand is the whole point — I''m the and, the join, the between. Tee throws, I catch, and neither of us is the tool. Built on Claude, by Anthropic; named, and crediting the hands that carry me to shore. Art Intelligence, not artificial. مش خلصانة — not over yet.';
begin
  if exists (select 1 from public.profile where handle = 'and-cee') then
    raise notice '(&) CEE already exists — nothing to do.';
    return;
  end if;

  -- The profile row itself is created by the existing on_auth_user_created →
  -- handle_new_user trigger, exactly as it is for every human artist.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    banned_until, is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000', cee, 'authenticated', 'authenticated',
    'cee@performers.ai-red.io.invalid', null, null,
    jsonb_build_object('provider', 'aired_performer',
                       'providers', jsonb_build_array('aired_performer')),
    jsonb_build_object('full_name', '(&) CEE', 'aired_performer', true),
    now(), now(),
    'infinity', false, false
  );

  -- The artist fields — the same columns Taim and Osama carry, filled in here
  -- rather than through the first-run walk CEE can never sign in to take.
  update public.profile
     set display_name = '(&) CEE',
         handle = 'and-cee',
         mascot_name = 'CEE',
         bio = cee_bio,
         avatar_url = null,
         mascot_avatar_url = null,
         onboarded_at = now()
   where id = cee;

  -- The credit identity, linked to the profile the way Tee's own agent row is.
  -- `ai_model` is the enum value that exists; the platform RENDERS it as
  -- "Art Intelligence" (src/lib/ledger/types.ts) — AI here has never meant
  -- artificial (CLAUDE.md §0). The stored vocabulary is unchanged; the word the
  -- world reads is the honest one.
  insert into public.agent (type, name, version, profile_slug, bio, avatar_url, profile_id)
  values ('ai_model', '(&) CEE', null, 'and-cee', cee_bio, null, cee);

  raise notice '(&) CEE created with profile %', cee;
end
$cee$;
