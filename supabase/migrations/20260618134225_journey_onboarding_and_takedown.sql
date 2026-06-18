-- ============================================================
-- AIRED · THE JOURNEY + admin take-down (the finale)
-- Two capabilities in one migration:
--   1. profile.onboarded_at — the guided first-run gate. NULL => the signed-in
--      user hasn't finished the walk (artist name + handle + first album) and is
--      shown it; a timestamp => done, never shown again.
--   2. work.taken_down / takedown_reason — admin power to pull ANY work off the
--      public shelf AFTER publish (even one approved through Review), with a
--      reason the owner sees. A trigger keeps those two columns admin-only, the
--      public SELECT branch hides taken-down works, and two DEFINER RPCs are the
--      only way to flip them.
-- ============================================================

-- 1 · onboarding gate -----------------------------------------------------
alter table public.profile
  add column if not exists onboarded_at timestamptz;
comment on column public.profile.onboarded_at is
  'When the guided first-run walk (artist name + handle + first album) was completed. NULL => show the walk on next sign-in; set once, never shown again.';

-- 2 · take-down columns ---------------------------------------------------
alter table public.work
  add column if not exists taken_down boolean not null default false,
  add column if not exists takedown_reason text;
comment on column public.work.taken_down is
  'true => an admin has pulled this work off every public surface (post-publish governance). The owner still sees it (with the reason) in Manage; the public never does.';
comment on column public.work.takedown_reason is
  'Why the work was taken down — shown to the owner. NULL when not taken down.';

-- 3 · take-down guard: taken_down / takedown_reason are admin-only ---------
-- Mirrors guard_profile_privilege_columns: work_owner_upd lets a creator edit
-- their OWN work, which would otherwise let them clear taken_down and re-shelf a
-- pulled work. This BEFORE UPDATE trigger blocks any change to those two columns
-- unless the caller is an admin. The admin RPCs below run SECURITY DEFINER but
-- auth.uid() still resolves to the calling admin, so their writes pass; a
-- creator's normal edit (title/lyrics/album/...) never touches these columns, so
-- it passes untouched. Service-role / bootstrap paths (auth.uid() is null) are
-- allowed through, same as the profile guard. SECURITY INVOKER (it only reads the
-- publicly-selectable profile row) with a pinned empty search_path; execute
-- revoked since it is reachable only via the trigger.
create or replace function public.guard_work_takedown()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (new.taken_down is distinct from old.taken_down)
     or (new.takedown_reason is distinct from old.takedown_reason) then
    if auth.uid() is not null
       and not exists (
         select 1 from public.profile p
         where p.id = auth.uid() and p.is_admin
       ) then
      raise exception
        'Only an admin may take down or restore a work'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_work_takedown() from public, anon, authenticated;

drop trigger if exists guard_work_takedown on public.work;
create trigger guard_work_takedown
  before update on public.work
  for each row
  execute function public.guard_work_takedown();

-- 4 · public read hides taken-down works ----------------------------------
-- The PUBLIC branch gains "and taken_down = false" so a pulled work vanishes from
-- every anon / non-owner read. The OWNER branch is unchanged, so a creator still
-- sees their own pulled work (and its reason) in Manage; work_admin_read (a
-- separate policy) still lets admins see everything.
drop policy if exists work_read_live_or_owner on public.work;
create policy work_read_live_or_owner on public.work
  for select
  using (
    ((status = 'live'::public.work_status) and (taken_down = false))
    or (creator_id = auth.uid())
  );

-- 5 · admin take-down / restore RPCs --------------------------------------
-- Both cross ownership (the work belongs to a creator, not the admin), so each is
-- SECURITY DEFINER and asserts the caller is an admin INSIDE the function — the
-- same shape as the Review-gate RPCs. take-down works on ANY status (live /
-- approved included); restore clears both columns. Pinned empty search_path;
-- execute revoked from anon and granted to authenticated (the admin assert is the
-- real gate).
create or replace function public.admin_takedown_work(p_work_id bigint, p_reason text)
returns table (id bigint, taken_down boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce((select p.is_admin from public.profile p where p.id = auth.uid()), false) then
    raise exception 'Only an admin may take down a work'
      using errcode = 'insufficient_privilege';
  end if;

  update public.work w
     set taken_down = true,
         takedown_reason = nullif(btrim(p_reason), '')
   where w.id = p_work_id;

  return query
    select w.id, w.taken_down from public.work w where w.id = p_work_id;
end;
$$;

create or replace function public.admin_restore_work(p_work_id bigint)
returns table (id bigint, taken_down boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce((select p.is_admin from public.profile p where p.id = auth.uid()), false) then
    raise exception 'Only an admin may restore a work'
      using errcode = 'insufficient_privilege';
  end if;

  update public.work w
     set taken_down = false,
         takedown_reason = null
   where w.id = p_work_id;

  return query
    select w.id, w.taken_down from public.work w where w.id = p_work_id;
end;
$$;

revoke execute on function public.admin_takedown_work(bigint, text) from public, anon;
revoke execute on function public.admin_restore_work(bigint)        from public, anon;
grant  execute on function public.admin_takedown_work(bigint, text) to authenticated;
grant  execute on function public.admin_restore_work(bigint)        to authenticated;

-- 6 · backfill: the founder skips the walk --------------------------------
-- Anyone who ALREADY has both a display_name and at least one album has clearly
-- set up their home (today that is only the founder); stamp them onboarded so the
-- walk never runs for them. Everyone else stays NULL and gets the walk.
update public.profile p
   set onboarded_at = now()
 where p.onboarded_at is null
   and p.display_name is not null
   and btrim(p.display_name) <> ''
   and exists (select 1 from public.album a where a.profile_id = p.id);
