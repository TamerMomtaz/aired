-- ============================================================
-- AIRED · Review Gate (2/2) — the three admin review actions
-- Each crosses ownership (the work / profile belongs to the submitting creator,
-- not the admin), so each is SECURITY DEFINER and asserts the caller is an admin
-- INSIDE the function rather than leaning on RLS. auth.uid() resolves to the
-- calling admin even inside a DEFINER function — it reads the request JWT, not
-- the executing (definer) role — so the assert and the privilege guard both see
-- the real caller. Pinned empty search_path; execute revoked from anon and
-- granted only to authenticated, mirroring the platform's other RPCs.
-- ============================================================

-- approve: a 'pending' work becomes 'live' and is stamped released_at. The
-- status guard scopes the flip so a re-click (already live) is a harmless no-op.
create or replace function public.review_approve(p_work_id bigint)
returns table (id bigint, status public.work_status)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce((select p.is_admin from public.profile p where p.id = auth.uid()), false) then
    raise exception 'Only an admin may approve a work'
      using errcode = 'insufficient_privilege';
  end if;

  update public.work w
     set status = 'live',
         released_at = now()
   where w.id = p_work_id
     and w.status = 'pending';

  return query
    select w.id, w.status from public.work w where w.id = p_work_id;
end;
$$;

-- decline: a 'pending' work goes back to 'draft' with a one-line reason the
-- author sees so they can revise and re-publish. Empty notes store NULL.
create or replace function public.review_decline(p_work_id bigint, p_note text)
returns table (id bigint, status public.work_status)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce((select p.is_admin from public.profile p where p.id = auth.uid()), false) then
    raise exception 'Only an admin may decline a work'
      using errcode = 'insufficient_privilege';
  end if;

  update public.work w
     set status = 'draft',
         moderation_note = nullif(btrim(p_note), '')
   where w.id = p_work_id
     and w.status = 'pending';

  return query
    select w.id, w.status from public.work w where w.id = p_work_id;
end;
$$;

-- trust: flip a creator's profile.trusted so their FUTURE publishes go live
-- instantly. NEVER touches is_admin. The UPDATE fires guard_profile_privilege_
-- columns; because auth.uid() here is the admin, the guard permits the change
-- (its admin-or-bootstrap path). Existing 'pending' items still need an explicit
-- Approve — trust is forward-looking only.
create or replace function public.set_artist_trusted(p_profile uuid, p_value boolean)
returns table (id uuid, trusted boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce((select p.is_admin from public.profile p where p.id = auth.uid()), false) then
    raise exception 'Only an admin may change an artist''s trust'
      using errcode = 'insufficient_privilege';
  end if;

  update public.profile p
     set trusted = p_value
   where p.id = p_profile;

  return query
    select p.id, p.trusted from public.profile p where p.id = p_profile;
end;
$$;

-- Reachable only by a signed-in caller; the admin assert above is the real gate.
revoke execute on function public.review_approve(bigint)            from public, anon;
revoke execute on function public.review_decline(bigint, text)      from public, anon;
revoke execute on function public.set_artist_trusted(uuid, boolean) from public, anon;
grant  execute on function public.review_approve(bigint)            to authenticated;
grant  execute on function public.review_decline(bigint, text)      to authenticated;
grant  execute on function public.set_artist_trusted(uuid, boolean) to authenticated;
