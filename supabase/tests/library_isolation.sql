-- ============================================================
-- AIRED · PROOF: one listener's library is invisible to every other listener.
--
-- Run this whole file as one script (Supabase SQL editor, or the MCP's
-- execute_sql). It returns one row per check with a PASS / FAIL verdict.
--
-- WHAT MAKES IT A PROOF, not a simulation:
--   • Every case runs with `role = authenticated` and a `request.jwt.claims`
--     carrying a real user's `sub`. That is EXACTLY the connection state
--     PostgREST puts a signed-in request in — so a hand-crafted POST from a
--     browser, curl, or any other client meets precisely these policies.
--   • sqlstate 42501 (insufficient_privilege) is what PostgREST returns to the
--     client as **HTTP 403 Forbidden**. A case that records 42501 IS the 403.
--   • The Adorned shelf and the Moods Feed are per-listener private data. The
--     promise is not "the UI doesn't show it" — it is "the database will not
--     hand it over". These cases ask the database directly, with the app out of
--     the picture entirely.
--
-- NOTHING IS KEPT. Each case runs in a subtransaction that is ALWAYS unwound
-- (the case raises sqlstate 'AIRED' on its way out, even when it succeeded), so
-- a run leaves no adornment and no mood behind. PL/pgSQL variables survive a
-- caught exception where table writes do not — which is why each case records
-- its outcome into variables and files the report only after the unwind.
--
-- The cast is resolved from live data, never hard-coded:
--   listener A / listener B — the two oldest profiles
--   three live works        — the songs A puts in a mood
-- ============================================================

create temporary table if not exists library_check (
  step     int,
  name     text,
  expected text,
  actual   text,
  detail   text
) on commit drop;
truncate library_check;

do $lib$
declare
  v_a        uuid;
  v_b        uuid;
  v_w        bigint[];
  v_draft    bigint;
  v_mood     uuid;
  v_item     uuid;
  v_seen     int;
  v_order    bigint[];
  v_pos      int[];
  v_added    boolean;
  v_state    text;
  v_msg      text;
  -- Per-case outcome. Assigned inside the subtransaction, read after it unwinds.
  v_out      text;
  v_det      text;
begin
  -- ── Resolve the cast ──────────────────────────────────────────────────────
  select array_agg(id order by created_at asc)
    into v_w
    from (select id, created_at from public.work
           where status = 'live' and taken_down = false
           order by created_at asc limit 3) live;

  select p.id into v_a from public.profile p order by p.created_at asc limit 1;
  select p.id into v_b from public.profile p
   where p.id <> v_a order by p.created_at asc limit 1;

  if v_a is null or v_b is null then
    insert into library_check values (0, 'two listeners exist', 'found',
      'fewer than 2 profiles',
      'Sign up a second account to prove isolation between two people.');
    return;
  end if;

  if v_w is null or array_length(v_w, 1) < 3 then
    insert into library_check values (0, 'three live works exist', 'found',
      coalesce(array_length(v_w, 1), 0) || ' live works',
      'The ordering cases need three live songs; isolation cases still run.');
  end if;

  insert into library_check values (0, 'cast resolved from live data', 'found', 'found',
    format('A=%s · B=%s · works=%s',
      coalesce((select display_name from public.profile where id = v_a), 'A'),
      coalesce((select display_name from public.profile where id = v_b), 'B'),
      v_w));

  -- ══ 1 · A's heart is A's alone ════════════════════════════════════════════
  -- A adorns a song; B asks the database for every adornment it will give them.
  -- The answer has to be zero rows — not "hidden by the app", not "filtered by a
  -- query we remembered to write", but nothing, because the policy says nothing.
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
    insert into public.adornment (profile_id, work_id) values (v_a, v_w[1]);

    perform set_config('request.jwt.claims',
      json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
    select count(*) into v_seen from public.adornment where work_id = v_w[1];

    v_out := v_seen || ' rows';
    v_det := 'B asked for the adornments on that song and the database returned none.';
    raise exception using errcode = 'AIRED';
  exception
    when sqlstate 'AIRED' then null;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      v_out := 'error ' || v_state; v_det := v_msg;
  end;
  insert into library_check values (1, 'B cannot see what A adorned', '0 rows', v_out, v_det);

  -- ══ 2 · A cannot adorn on B's behalf ══════════════════════════════════════
  -- The `with check` on insert pins profile_id to the caller, so a heart can be
  -- neither forged onto someone else's shelf nor handed away.
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
    insert into public.adornment (profile_id, work_id) values (v_b, v_w[1]);
    v_out := 'accepted';
    v_det := 'A wrote a row onto B''s shelf — the insert policy is not pinning profile_id.';
    raise exception using errcode = 'AIRED';
  exception
    when sqlstate 'AIRED' then null;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      v_out := v_state;
      v_det := case when v_state = '42501'
                    then 'Refused as HTTP 403 — a heart can only be your own.'
                    else v_msg end;
  end;
  insert into library_check values (2, 'A cannot adorn for B', '42501', v_out, v_det);

  -- ══ 3 · The same song cannot be adorned twice ═════════════════════════════
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
    insert into public.adornment (profile_id, work_id) values (v_a, v_w[1]);
    insert into public.adornment (profile_id, work_id) values (v_a, v_w[1]);
    v_out := 'accepted';
    v_det := 'The unique(profile_id, work_id) constraint is missing.';
    raise exception using errcode = 'AIRED';
  exception
    when sqlstate 'AIRED' then null;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      v_out := v_state;
      v_det := case when v_state = '23505'
                    then 'Refused — one heart per listener per song.'
                    else v_msg end;
  end;
  insert into library_check values (3, 'a song cannot be adorned twice', '23505', v_out, v_det);

  -- ══ 4 · A's mood is A's alone ═════════════════════════════════════════════
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
    insert into public.mood (profile_id, name) values (v_a, 'proof run — not kept')
      returning id into v_mood;
    perform public.mood_add_work(v_mood, v_w[1]);

    perform set_config('request.jwt.claims',
      json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
    select count(*) into v_seen from public.mood where id = v_mood;
    select v_seen + count(*) into v_seen from public.mood_item where mood_id = v_mood;

    v_out := v_seen || ' rows';
    v_det := 'B asked for the mood AND its songs; the database returned neither.';
    raise exception using errcode = 'AIRED';
  exception
    when sqlstate 'AIRED' then null;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      v_out := 'error ' || v_state; v_det := v_msg;
  end;
  insert into library_check values (4, 'B cannot see A''s mood or its songs', '0 rows', v_out, v_det);

  -- ══ 5 · B cannot push a song into A's mood ════════════════════════════════
  -- mood_item carries no owner column of its own — every policy joins up to the
  -- mood to ask. This is the case that proves that join actually holds.
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
    insert into public.mood (profile_id, name) values (v_a, 'proof run — not kept')
      returning id into v_mood;

    perform set_config('request.jwt.claims',
      json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
    perform public.mood_add_work(v_mood, v_w[1]);
    v_out := 'accepted';
    v_det := 'B added a song to A''s mood — the ownership join is not holding.';
    raise exception using errcode = 'AIRED';
  exception
    when sqlstate 'AIRED' then null;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      v_out := v_state;
      v_det := case when v_state = '42501'
                    then 'Refused as HTTP 403 — the mood is not B''s to fill.'
                    else v_msg end;
  end;
  insert into library_check values (5, 'B cannot add to A''s mood', '42501', v_out, v_det);

  -- ══ 6 · A mood keeps the order its owner put it in ════════════════════════
  -- Three songs appended, then the last one moved up. The order must read
  -- 1,3,2 and the positions must come back a clean 1..n — the ordering repairs
  -- itself on every move, so it can never drift into ties or gaps.
  if v_w is not null and array_length(v_w, 1) >= 3 then
    begin
      perform set_config('role', 'authenticated', true);
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
      insert into public.mood (profile_id, name) values (v_a, 'proof run — not kept')
        returning id into v_mood;
      perform public.mood_add_work(v_mood, v_w[1]);
      perform public.mood_add_work(v_mood, v_w[2]);
      perform public.mood_add_work(v_mood, v_w[3]);
      -- Adding a song already there must be a no-op, not a second row.
      select public.mood_add_work(v_mood, v_w[2]) into v_added;

      select i.id into v_item from public.mood_item i
       where i.mood_id = v_mood and i.work_id = v_w[3];
      perform public.mood_move_item(v_item, 'up');

      select array_agg(i.work_id order by i.position),
             array_agg(i.position  order by i.position)
        into v_order, v_pos
        from public.mood_item i where i.mood_id = v_mood;

      v_out := format('%s @ %s', v_order, v_pos);
      v_det := case when v_added
                    then 'WRONG: re-adding a song already in the mood duplicated it.'
                    else 'Third song moved up; re-adding a present song was a no-op.'
               end;
      raise exception using errcode = 'AIRED';
    exception
      when sqlstate 'AIRED' then null;
      when others then
        get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
        v_out := 'error ' || v_state; v_det := v_msg;
    end;
    insert into library_check values (6, 'move-up reorders and renumbers 1..n',
      format('%s @ {1,2,3}', array[v_w[1], v_w[3], v_w[2]]), v_out, v_det);
  end if;

  -- ══ 7 · A draft song cannot be parked in a mood ═══════════════════════════
  -- Otherwise a mood could hold a row that renders as a dead, unplayable line.
  select w.id into v_draft from public.work w
   where w.status <> 'live' or w.taken_down = true
   order by w.id desc limit 1;

  if v_draft is not null then
    begin
      perform set_config('role', 'authenticated', true);
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
      insert into public.mood (profile_id, name) values (v_a, 'proof run — not kept')
        returning id into v_mood;
      perform public.mood_add_work(v_mood, v_draft);
      v_out := 'accepted';
      v_det := 'A non-live work joined a mood.';
      raise exception using errcode = 'AIRED';
    exception
      when sqlstate 'AIRED' then null;
      when others then
        get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
        v_out := v_state;
        v_det := case when v_state = '23514'
                      then 'Refused — only a live work can join a mood.'
                      else v_msg end;
    end;
    insert into library_check values (7, 'a non-live work cannot join a mood', '23514', v_out, v_det);
  end if;

  perform set_config('role', 'postgres', true);
end
$lib$;

-- ── The report ─────────────────────────────────────────────────────────────
-- Step 0 rows are context, not verdicts. Everything else is PASS or FAIL.
select
  c.step,
  c.name,
  c.expected,
  c.actual,
  case
    when c.step = 0                                then '—'
    when c.actual = c.expected                     then 'PASS'
    -- The ordering case compares a formatted array pair, which round-trips with
    -- Postgres's own spacing; compare with whitespace normalised.
    when replace(c.actual, ' ', '') = replace(c.expected, ' ', '') then 'PASS'
    else 'FAIL'
  end as verdict,
  c.detail
from library_check c
order by c.step;

-- Nothing was kept: every case above unwound its own writes before this ran.
select
  (select count(*) from public.mood where name = 'proof run — not kept') as moods_left_behind;
