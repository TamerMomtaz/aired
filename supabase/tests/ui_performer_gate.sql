-- ============================================================
-- AIRED · PROOF: the performer gate is server-side, not UI-hiding.
--
-- Run this whole file as one script (Supabase SQL editor, or the MCP's
-- execute_sql). It returns one row per check with a PASS / FAIL verdict.
--
-- WHAT MAKES IT A PROOF, not a simulation:
--   • Every case runs with `role = authenticated` and a `request.jwt.claims`
--     carrying a real user's `sub`. That is EXACTLY the connection state
--     PostgREST puts a signed-in request in — so a hand-crafted POST from a
--     browser, curl, or any other client meets precisely these policies. Nothing
--     is mocked and nothing is stubbed.
--   • sqlstate 42501 (insufficient_privilege) is what PostgREST returns to the
--     client as **HTTP 403 Forbidden**. A case that records 42501 IS the 403.
--   • The gate is asked three times on every insert — by the app (createWork),
--     by RLS (work_owner_ins), and by the trigger (enforce_publish_honesty).
--     This file tests the two that live in the database: the two an attacker
--     cannot route around by skipping the app.
--
-- NOTHING IS KEPT. Each case runs in a subtransaction that is ALWAYS unwound
-- (the case raises sqlstate 'AIRED' on its way out, even when it succeeded), and
-- the catalog sequence is handed back at the end, so a run burns no AIRED
-- numbers. PL/pgSQL variables survive a caught exception where table writes do
-- not — which is why each case records its outcome into variables and files the
-- report only after the unwind.
--
-- The cast is resolved from live data, never hard-coded:
--   performer    — an artist someone is authorized to carry (today: (&) CEE)
--   authorized   — the human holding that grant (today: Tee)
--   unauthorized — the oldest signed-in profile that is not an admin, holds no
--                  grant, and is nobody's performer
-- ============================================================

create temporary table if not exists gate_check (
  step     int,
  name     text,
  expected text,
  actual   text,
  detail   text
) on commit drop;
truncate gate_check;

do $gate$
declare
  v_performer    uuid;
  v_authorized   uuid;
  v_unauthorized uuid;
  v_stranger     uuid;
  v_seq          text := pg_get_serial_sequence('public.work', 'id');
  v_seq_before   bigint;
  v_max_before   bigint;
  v_max_after    bigint;
  v_work_id      bigint;
  v_creator      uuid;
  v_authority    uuid;
  v_via          text;
  v_status       text;
  v_visible      int;
  v_priv         int;
  v_hands_agent  uuid;
  v_state        text;
  v_msg          text;
  -- Per-case outcome. Assigned inside the subtransaction, read after it unwinds.
  v_out          text;
  v_det          text;
begin
  -- ── Resolve the cast ──────────────────────────────────────────────────────
  select pa.performer_id, pa.human_id
    into v_performer, v_authorized
    from public.performer_authority pa
   order by pa.granted_at asc, pa.performer_id asc
   limit 1;

  if v_performer is null then
    insert into gate_check values (0, 'a carriable performer exists',
      'found', 'none', 'No performer_authority rows — grant one before testing.');
    return;
  end if;

  -- The second, non-authorized SIGNED-IN user the brief demands a 403 for.
  select p.id into v_unauthorized
    from public.profile p
   where p.is_admin = false
     and p.id <> v_performer
     and not exists (select 1 from public.performer_authority pa where pa.human_id = p.id)
     and not exists (select 1 from public.performer_authority pa where pa.performer_id = p.id)
   order by p.created_at asc
   limit 1;

  -- A rail nobody is authorized to carry, and NOT the carrier's own — so the
  -- service-role case below lands on the grant check itself rather than on the
  -- "artist = uploader" contradiction, which would pass for the wrong reason.
  select p.id into v_stranger
    from public.profile p
   where p.id <> v_performer
     and p.id <> v_authorized
     and not exists (select 1 from public.performer_authority pa where pa.performer_id = p.id)
   order by p.created_at asc
   limit 1;

  select last_value into v_seq_before
    from pg_sequences
   where schemaname = split_part(v_seq, '.', 1)
     and sequencename = split_part(v_seq, '.', 2);
  select coalesce(max(id), 0) into v_max_before from public.work;

  insert into gate_check values (0, 'cast resolved from live data', 'found', 'found',
    format('performer=%s · authorized=%s · unauthorized=%s',
      (select display_name from public.profile where id = v_performer),
      (select display_name from public.profile where id = v_authorized),
      (select display_name from public.profile where id = v_unauthorized)));

  -- ══ 1 · The unauthorized user cannot even SEE a performer to select ═══════
  -- The UI half, checked where it actually lives. The upload page builds its
  -- dropdown from exactly this read: zero rows ⇒ no selector renders — and it
  -- renders none because RLS returned nothing, not because a component chose to
  -- hide it.
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_unauthorized, 'role', 'authenticated')::text, true);
    select count(*) into v_visible from public.performer_authority;
    v_out := v_visible || ' rows';
    v_det := 'No grants visible ⇒ the upload page renders no performer selector.';
    raise exception using errcode = 'AIRED';
  exception
    when sqlstate 'AIRED' then null;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      v_out := 'error ' || v_state; v_det := v_msg;
  end;
  execute 'reset role';
  insert into gate_check values (1,
    'unauthorized user reads performer_authority', '0 rows', v_out, v_det);

  -- ══ 2 · Crafted request: unauthorized user files under the performer ══════
  -- The exact attack the brief names: a hand-crafted POST naming a performer,
  -- from a user who never saw the control.
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_unauthorized, 'role', 'authenticated')::text, true);
    insert into public.work (title, creator_id, status, published_via, published_by_authority)
    values ('GATE TEST · crafted ui_performer', v_performer, 'draft', 'ui_performer', v_unauthorized)
    returning id into v_work_id;
    v_out := 'INSERTED';
    v_det := 'GATE BREACH — a work landed on the performer''s rail (id ' || v_work_id || ').';
    raise exception using errcode = 'AIRED';
  exception
    when sqlstate 'AIRED' then null;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      v_out := v_state;
      v_det := case when v_state = '42501' then 'PostgREST returns this as HTTP 403. ' else '' end || v_msg;
  end;
  execute 'reset role';
  insert into gate_check values (2,
    'unauthorized: crafted ui_performer insert', '42501', v_out, v_det);

  -- ══ 3 · Crafted request: plain forgery of creator_id ══════════════════════
  -- The same attack without the honest label — just claiming to be the artist.
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_unauthorized, 'role', 'authenticated')::text, true);
    insert into public.work (title, creator_id, status)
    values ('GATE TEST · forged creator_id', v_performer, 'draft')
    returning id into v_work_id;
    v_out := 'INSERTED'; v_det := 'GATE BREACH — work ' || v_work_id;
    raise exception using errcode = 'AIRED';
  exception
    when sqlstate 'AIRED' then null;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      v_out := v_state; v_det := v_msg;
  end;
  execute 'reset role';
  insert into gate_check values (3,
    'unauthorized: forged creator_id, no label', '42501', v_out, v_det);

  -- ══ 4 · Crafted request: borrowing the real carrier's authority ═══════════
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_unauthorized, 'role', 'authenticated')::text, true);
    insert into public.work (title, creator_id, status, published_via, published_by_authority)
    values ('GATE TEST · borrowed authority', v_performer, 'draft', 'ui_performer', v_authorized)
    returning id into v_work_id;
    v_out := 'INSERTED'; v_det := 'GATE BREACH — work ' || v_work_id;
    raise exception using errcode = 'AIRED';
  exception
    when sqlstate 'AIRED' then null;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      v_out := v_state; v_det := v_msg;
  end;
  execute 'reset role';
  insert into gate_check values (4,
    'unauthorized: names the real carrier as authority', '42501', v_out, v_det);

  -- ══ 5 · The unauthorized user's OWN upload is untouched ═══════════════════
  -- The gate must cost an ordinary creator nothing at all.
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_unauthorized, 'role', 'authenticated')::text, true);
    insert into public.work (title, creator_id, status)
    values ('GATE TEST · my own work', v_unauthorized, 'draft')
    returning id, published_via into v_work_id, v_via;
    v_out := 'INSERTED as ' || v_via;
    v_det := 'Unchanged behavior for every ordinary creator.';
    raise exception using errcode = 'AIRED';
  exception
    when sqlstate 'AIRED' then null;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      v_out := 'REFUSED ' || v_state; v_det := v_msg;
  end;
  execute 'reset role';
  insert into gate_check values (5,
    'unauthorized user uploads under THEMSELVES', 'INSERTED as human_ui', v_out, v_det);

  -- ══ 6 · The AUTHORIZED carrier lands it, in the right shape ═══════════════
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_authorized, 'role', 'authenticated')::text, true);
    insert into public.work (title, creator_id, status, published_via, published_by_authority)
    values ('GATE TEST · carried by the authorized human', v_performer, 'draft',
            'ui_performer', v_authorized)
    returning id, creator_id, published_by_authority, published_via, status::text
      into v_work_id, v_creator, v_authority, v_via, v_status;
    v_out := case
      when v_creator = v_performer and v_authority = v_authorized
       and v_via = 'ui_performer' and v_status = 'draft'
      then 'INSERTED' else 'INSERTED (WRONG SHAPE)' end;
    v_det := format('creator_id=performer:%s · published_by_authority=carrier:%s · via=%s · status=%s',
      v_creator = v_performer, v_authority = v_authorized, v_via, v_status);
    raise exception using errcode = 'AIRED';
  exception
    when sqlstate 'AIRED' then null;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      v_out := 'REFUSED ' || v_state; v_det := v_msg;
  end;
  execute 'reset role';
  insert into gate_check values (6,
    'authorized carrier files under the performer', 'INSERTED', v_out, v_det);

  -- ══ 7 · Even the authorized carrier cannot skip Go Live ═══════════════════
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_authorized, 'role', 'authenticated')::text, true);
    insert into public.work (title, creator_id, status, published_via, published_by_authority)
    values ('GATE TEST · straight to live', v_performer, 'live', 'ui_performer', v_authorized)
    returning id into v_work_id;
    v_out := 'INSERTED'; v_det := 'GATE BREACH — a work skipped the review gate.';
    raise exception using errcode = 'AIRED';
  exception
    when sqlstate 'AIRED' then null;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      v_out := 'REFUSED ' || v_state; v_det := v_msg;
  end;
  execute 'reset role';
  insert into gate_check values (7,
    'authorized carrier publishes LIVE directly', 'REFUSED', v_out, v_det);

  -- ══ 8 · The DB refuses it even for the SERVICE ROLE ═══════════════════════
  -- The layer RLS cannot provide: the service client bypasses policies, so the
  -- trigger is what stops an application bug — or a leaked service key — from
  -- filing a work onto a rail nobody was ever authorized to carry.
  begin
    insert into public.work (title, creator_id, status, published_via, published_by_authority)
    values ('GATE TEST · service role, no grant', v_stranger, 'draft', 'ui_performer', v_authorized)
    returning id into v_work_id;
    v_out := 'INSERTED'; v_det := 'GATE BREACH — the honesty trigger did not fire.';
    raise exception using errcode = 'AIRED';
  exception
    when sqlstate 'AIRED' then null;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      v_out := 'REFUSED ' || v_state; v_det := v_msg;
  end;
  insert into gate_check values (8,
    'service role files under an ungranted rail', 'REFUSED', v_out, v_det);

  -- ══ 9 · A ui_performer row may not pretend a token was used ═══════════════
  begin
    insert into public.work (title, creator_id, status, published_via,
                             published_by_authority, ingest_token_label)
    values ('GATE TEST · fake token label', v_performer, 'draft', 'ui_performer',
            v_authorized, 'cee-wheelbarrow')
    returning id into v_work_id;
    v_out := 'INSERTED'; v_det := 'GATE BREACH — a hand upload credited an automation.';
    raise exception using errcode = 'AIRED';
  exception
    when sqlstate 'AIRED' then null;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      v_out := 'REFUSED ' || v_state; v_det := v_msg;
  end;
  insert into gate_check values (9,
    'ui_performer claiming a delegated token', 'REFUSED', v_out, v_det);

  -- ══ 10 · ui_performer where the artist IS the uploader is a contradiction ═
  begin
    insert into public.work (title, creator_id, status, published_via, published_by_authority)
    values ('GATE TEST · carrying myself', v_authorized, 'draft', 'ui_performer', v_authorized)
    returning id into v_work_id;
    v_out := 'INSERTED'; v_det := 'GATE BREACH — a self-upload labelled as carried.';
    raise exception using errcode = 'AIRED';
  exception
    when sqlstate 'AIRED' then null;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      v_out := 'REFUSED ' || v_state; v_det := v_msg;
  end;
  insert into gate_check values (10,
    'ui_performer where artist = uploader', 'REFUSED', v_out, v_det);

  -- ══ 11 · The old invariant still holds — nothing was loosened ═════════════
  begin
    insert into public.work (title, creator_id, status, published_via, published_by_authority)
    values ('GATE TEST · human_ui with an authority', v_authorized, 'draft', 'human_ui', v_performer)
    returning id into v_work_id;
    v_out := 'INSERTED'; v_det := 'REGRESSION — human_ui lost its meaning.';
    raise exception using errcode = 'AIRED';
  exception
    when sqlstate 'AIRED' then null;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      v_out := 'REFUSED ' || v_state; v_det := v_msg;
  end;
  insert into gate_check values (11,
    'human_ui carrying a delegating authority', 'REFUSED', v_out, v_det);

  -- ══ 12 · A work still can never be re-pointed onto another rail ═══════════
  begin
    update public.work set creator_id = v_performer
     where id = (select id from public.work
                  where creator_id = v_authorized and published_by_authority is null
                  order by id desc limit 1);
    v_out := 'UPDATED'; v_det := 'REGRESSION — a work moved onto another artist''s rail.';
    raise exception using errcode = 'AIRED';
  exception
    when sqlstate 'AIRED' then null;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      v_out := 'REFUSED ' || v_state; v_det := v_msg;
  end;
  insert into gate_check values (12,
    'guard_work_placement: re-point creator_id', 'REFUSED', v_out, v_det);

  -- ══ 13 · An album's artist is equally a fact of its creation ══════════════
  begin
    update public.album set profile_id = v_performer
     where id = (select id from public.album where profile_id = v_authorized
                  order by created_at desc limit 1);
    v_out := 'UPDATED'; v_det := 'An album could be moved onto another artist''s rail.';
    raise exception using errcode = 'AIRED';
  exception
    when sqlstate 'AIRED' then null;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      v_out := 'REFUSED ' || v_state; v_det := v_msg;
  end;
  insert into gate_check values (13,
    'guard_album_placement: re-point album artist', 'REFUSED', v_out, v_det);

  -- ══ 14 · The carrier can write the reciprocal ledger on the carried work ══
  -- The other half of the feature: a performer work is worthless without its
  -- hands volley, and the hands volley is written by the SESSION client (through
  -- the same declare_volley RPC the editor and the token door both call). If RLS
  -- let the work land but refused its ledger, the work would arrive uncredited.
  -- This runs the real RPC as the carrier and checks the paired public+private
  -- rows appear, with the audit/HUMAN shape the delegated door produces.
  begin
    select a.id into v_hands_agent
      from public.agent a
     where a.profile_id = v_authorized and a.type = 'human'
     order by a.created_at asc limit 1;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_authorized, 'role', 'authenticated')::text, true);

    insert into public.work (title, creator_id, status, published_via, published_by_authority)
    values ('GATE TEST · ledger parity', v_performer, 'draft', 'ui_performer', v_authorized)
    returning id into v_work_id;

    -- Stand-in payload: the real ciphertext + hash come from the shared
    -- seal/writeVolley code, which is byte-identical for both doors. What is
    -- under test HERE is whether the carrier may write the pair at all.
    perform public.declare_volley(
      v_work_id, 0::numeric, v_hands_agent, 'audit'::public.volley_role,
      'HUMAN'::public.volley_origin, 'added'::public.delta_type,
      repeat('0', 64), 'gate-test-ciphertext', 'gate-test', array[]::text[]);

    select count(*) into v_visible from public.public_volley
     where work_id = v_work_id and role = 'audit' and origin = 'HUMAN';
    select count(*) into v_priv from public.private_volley where work_id = v_work_id;

    v_out := case when v_visible = 1 and v_priv = 1 then 'PAIR WRITTEN'
                  else format('public=%s private=%s', v_visible, v_priv) end;
    v_det := 'The carrier wrote the audit/HUMAN hands volley on the performer''s work, public + private together.';
    raise exception using errcode = 'AIRED';
  exception
    when sqlstate 'AIRED' then null;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      v_out := 'REFUSED ' || v_state; v_det := v_msg;
  end;
  execute 'reset role';
  insert into gate_check values (14,
    'carrier writes the hands volley on a carried work', 'PAIR WRITTEN', v_out, v_det);

  -- ── Give the catalog numbers back ─────────────────────────────────────────
  -- Sequences are non-transactional, so the unwound inserts above still consumed
  -- real AIRED numbers. Hand them back — but ONLY if no genuine upload landed
  -- while this ran, or we would re-issue a number that is already taken.
  select coalesce(max(id), 0) into v_max_after from public.work;
  if v_max_after = v_max_before and v_seq_before is not null then
    perform setval(v_seq, v_seq_before, true);
    insert into gate_check values (99, 'catalog sequence restored', 'restored', 'restored',
      'No AIRED numbers burned — sequence back to ' || v_seq_before || '.');
  else
    insert into gate_check values (99, 'catalog sequence restored', 'restored', 'left alone',
      'A real upload landed during the run; the sequence was left untouched on purpose.');
  end if;
end
$gate$;

select
  step,
  name,
  expected,
  actual,
  case when actual = expected or actual like expected || '%' then 'PASS' else 'FAIL' end
    as verdict,
  detail
from gate_check
order by step;
