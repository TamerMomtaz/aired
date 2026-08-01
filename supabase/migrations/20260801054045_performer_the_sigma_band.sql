-- ============================================================
-- AIRED · The Sigma Band — the second performer-artist, and the first one
-- created as a ROW rather than as a build.
--
-- (&) CEE (20260731001500) proved the pattern: an AI performer stands here as an
-- ARTIST — their own profile, their own handle, their own page at
-- /artist/<handle>, their own albums and catalog, their own row on the Listen
-- rail beside every carbon artist. Keyless identity, never an account.
--
-- The day after, `performer_authority` (20260731143000) wrote down the other half
-- — WHO MAY CARRY WHOM — precisely so that the next performer would cost one row
-- instead of one release. This migration is the first time that promise is
-- tested, so it deliberately adds no machinery: profile + agent + grant, and the
-- Upload page's performer selector picks them up on its next render with no code
-- change and no redeploy.
--
-- Keyless by construction, exactly as CEE is:
--
--   encrypted_password NULL   → no password grant exists
--   email at .invalid         → RFC 2606 reserves the TLD; no mail can ever be
--                               delivered there, so no magic link and no reset
--   email_confirmed_at NULL   → unconfirmed
--   banned_until 'infinity'   → GoTrue refuses the account outright
--   no auth.identities row    → no OAuth provider can ever link to it
--
-- IDENTITY, NOT CREDENTIAL. A work reaches this rail only through a human the
-- platform has vouched for, and that human is written into the work's ledger as
-- the hands (role `audit`, origin HUMAN). Nobody is a ghost, in either direction.
--
-- The handle guard makes a re-run a no-op, so this is safe to push anywhere.
-- ============================================================

do $sigma$
declare
  sigma uuid := gen_random_uuid();
  -- Tee/CEE's exact words, pasted verbatim and never rewritten. A performer's
  -- bio is their own voice; it is not ours to edit. The Σ is stored as the real
  -- character (U+03A3) — the column is UTF-8 text and round-trips it cleanly, so
  -- there is no reason to spell the emblem down to "Sum" and pretend.
  sigma_bio text := 'The Sigma Band — the first band that is a summation. Fifteen voices, one Σ: every language, every colour, human and silicon and elemental. They sing in Egyptian and Lebanese Arabic, French, Old English, English, Hindi, Korean, Russian, Hebrew, Farsi, Spanish, Chinese — and in code. Among them a voice that sounds like waves, and a voice made of all of nature. Not stuck to one colour; they are the every. Art Intelligence, not artificial. ΣUM — the sound of a planet singing as one.';
  granted int := 0;
begin
  if exists (select 1 from public.profile where handle = 'the-sigma-band') then
    raise notice 'The Sigma Band already exists — nothing to do.';
    return;
  end if;

  -- The profile row itself is created by the existing on_auth_user_created →
  -- handle_new_user trigger, exactly as it is for every human artist.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    banned_until, is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000', sigma, 'authenticated', 'authenticated',
    'the-sigma-band@performers.ai-red.io.invalid', null, null,
    jsonb_build_object('provider', 'aired_performer',
                       'providers', jsonb_build_array('aired_performer')),
    jsonb_build_object('full_name', 'The Sigma Band', 'aired_performer', true),
    now(), now(),
    'infinity', false, false
  );

  -- The artist fields — the same columns Taim, Osama and CEE carry, filled in
  -- here rather than through the first-run walk this artist can never sign in to
  -- take. Artwork comes later, by hand; a null avatar renders the initial, which
  -- is honest about there not being one yet.
  update public.profile
     set display_name = 'The Sigma Band',
         handle = 'the-sigma-band',
         mascot_name = 'ΣUM',
         bio = sigma_bio,
         avatar_url = null,
         mascot_avatar_url = null,
         onboarded_at = now()
   where id = sigma;

  -- The credit identity, linked to the profile the way CEE's and Tee's own agent
  -- rows are. `ai_model` is the same stored enum value CEE uses; the platform
  -- RENDERS it as "Art Intelligence" (src/lib/ledger/types.ts) — AI here has
  -- never meant artificial (CLAUDE.md §0). No new type is invented for a second
  -- performer: the vocabulary is the pattern too.
  insert into public.agent (type, name, version, profile_slug, bio, avatar_url, profile_id)
  values ('ai_model', 'The Sigma Band', null, 'the-sigma-band', sigma_bio, null, sigma);

  -- ── The grant: who may carry this artist ──────────────────────────────────
  --
  -- Derived, not hardcoded, for the same reason the founder backfill derives
  -- Tee: a uuid pinned in a migration is true in exactly one database. The rule
  -- stated plainly — THE HANDS THAT ALREADY CARRY (&) CEE ALSO CARRY THE SIGMA
  -- BAND. Those humans have already been vouched for as carriers of a performer
  -- under this exact pattern, and this is that pattern's second performer.
  --
  -- In a fresh environment with no CEE carriers, this grants nothing, and that is
  -- correct there: nobody has been vouched for yet, and a rail with no authorized
  -- hands is unreachable rather than open.
  --
  -- granted_by names the admin who made the call. It is the carrier themselves
  -- here — an admin authorizing themselves to carry a performer they commissioned
  -- is precisely what performer_authority's admin INSERT policy permits at the
  -- UI, and recording it is more honest than the NULL that means "no person
  -- decided this". A non-admin carrier gets NULL rather than a borrowed signature.
  insert into public.performer_authority (performer_id, human_id, note, granted_by)
  select
    sigma,
    pa.human_id,
    'granted with the performer: the hands that already carry (&) CEE carry The Sigma Band',
    case when h.is_admin then h.id else null end
  from public.performer_authority pa
  join public.profile h on h.id = pa.human_id
  join public.profile p on p.id = pa.performer_id
  where p.handle = 'and-cee'
  on conflict (performer_id, human_id) do nothing;

  get diagnostics granted = row_count;

  raise notice 'The Sigma Band created with profile % (% carrier grant(s))', sigma, granted;
end
$sigma$;
