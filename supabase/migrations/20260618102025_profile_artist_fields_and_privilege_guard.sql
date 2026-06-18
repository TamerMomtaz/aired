-- ============================================================
-- AIRED · Artist-via-Profile · profile fields + privilege guard
-- The profile row IS the artist (one account = one artist, v1). Add the
-- per-creator mascot (their emblem of voices) and two moderation/trust flags
-- that gate publishing and the Review queue. No new table — the existing
-- profile policies (public SELECT, self UPDATE) already fit; these columns
-- inherit them.
-- ============================================================

-- All nullable / defaulted, so the existing profile rows stay valid.
alter table public.profile
  add column if not exists mascot_name       text,
  add column if not exists mascot_avatar_url text,
  add column if not exists trusted           boolean not null default false,
  add column if not exists is_admin          boolean not null default false;

comment on column public.profile.mascot_name is
  'Per-creator emblem of their voices (the creator''s named persona for their AI collaborators). Public, optional.';
comment on column public.profile.mascot_avatar_url is
  'Optional image for the creator''s mascot.';
comment on column public.profile.trusted is
  'true => this creator''s publishes go live instantly; false => they land in ''pending'' for review. Changeable only by an admin (see the profile_privilege_guard trigger).';
comment on column public.profile.is_admin is
  'true => may access the Review queue. Changeable only by an admin (see the profile_privilege_guard trigger).';

-- --------------------------------------------------------------
-- Privilege guard: `trusted` and `is_admin` are NOT self-service.
-- The existing profile_self_upd policy (auth.uid() = id) lets a creator edit
-- their OWN row — which would otherwise let anyone flip their own trusted /
-- is_admin and render the gate meaningless. This BEFORE UPDATE trigger blocks
-- any change to those two columns unless the caller is themselves an admin.
-- Paths with no end-user in context (service role / SECURITY DEFINER, where
-- auth.uid() is null) — such as the admin-bootstrap backfill that sets the very
-- first admin — are allowed through.
--
-- SECURITY INVOKER (it only ever reads the caller's own publicly-selectable
-- profile row, so it needs no elevated rights) with a pinned empty search_path,
-- and execute revoked from the API roles since it is reachable only via the
-- trigger — mirroring play_count_sync, to keep the privileged surface minimal.
-- (Trigger execution does not require EXECUTE on the function.)
-- --------------------------------------------------------------
create or replace function public.guard_profile_privilege_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (new.trusted is distinct from old.trusted)
     or (new.is_admin is distinct from old.is_admin) then
    if auth.uid() is not null
       and not exists (
         select 1 from public.profile p
         where p.id = auth.uid() and p.is_admin
       ) then
      raise exception
        'Only an admin may change profile.trusted or profile.is_admin'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_profile_privilege_columns() from public, anon, authenticated;

drop trigger if exists profile_privilege_guard on public.profile;
create trigger profile_privilege_guard
  before update on public.profile
  for each row
  execute function public.guard_profile_privilege_columns();
