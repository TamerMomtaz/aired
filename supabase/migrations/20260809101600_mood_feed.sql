-- ============================================================
-- AIRED · Moods Feed — the listener composing their own volley.
--
-- A mood is a listener-named, listener-ordered run of songs. Where the Volley
-- Ledger is the makers' sequence, a mood is the listener's: same instinct
-- (order carries meaning), pointed the other way. Private to its owner.
--
-- Ordering is an honest integer `position`, never a fudge of added_at — a
-- listener who drags a song to the top means the top, not "added later".
-- ============================================================
create table public.mood (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profile(id) on delete cascade,
  name        text not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- A mood has to be called something; 80 chars is a name, not an essay.
  constraint mood_name_not_blank check (char_length(btrim(name)) between 1 and 80)
);

create index idx_mood_profile on public.mood (profile_id, created_at desc);

create table public.mood_item (
  id       uuid   primary key default gen_random_uuid(),
  mood_id  uuid   not null references public.mood(id) on delete cascade,
  work_id  bigint not null references public.work(id) on delete cascade,
  position integer not null,
  added_at timestamptz not null default now(),
  -- A song sits in a mood once. Adding it again is a no-op, not a duplicate.
  unique (mood_id, work_id)
);

-- The mood page reads one mood's items in order; the work-side index carries the
-- cascade when a work is deleted.
create index idx_mood_item_mood_position on public.mood_item (mood_id, position);
create index idx_mood_item_work on public.mood_item (work_id);

alter table public.mood      enable row level security;
alter table public.mood_item enable row level security;

-- A mood is private on every verb — no public read at all. `with check` pins
-- profile_id to the caller on both insert and update, so ownership can be
-- neither forged nor transferred away (the shape the album table uses).
create policy mood_read_own on public.mood for select
  using (profile_id = auth.uid());
create policy mood_ins_own on public.mood for insert
  with check (profile_id = auth.uid());
create policy mood_upd_own on public.mood for update
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy mood_del_own on public.mood for delete
  using (profile_id = auth.uid());

-- An item carries no owner column of its own: it belongs to whoever owns its
-- mood, so every policy joins up to `mood` to ask. That single source of truth
-- is why a mood handed to nobody stays unreadable by everybody.
create policy mood_item_read_own on public.mood_item for select
  using (exists (
    select 1 from public.mood m
     where m.id = mood_item.mood_id and m.profile_id = auth.uid()
  ));
create policy mood_item_ins_own on public.mood_item for insert
  with check (exists (
    select 1 from public.mood m
     where m.id = mood_item.mood_id and m.profile_id = auth.uid()
  ));
create policy mood_item_upd_own on public.mood_item for update
  using (exists (
    select 1 from public.mood m
     where m.id = mood_item.mood_id and m.profile_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.mood m
     where m.id = mood_item.mood_id and m.profile_id = auth.uid()
  ));
create policy mood_item_del_own on public.mood_item for delete
  using (exists (
    select 1 from public.mood m
     where m.id = mood_item.mood_id and m.profile_id = auth.uid()
  ));

-- ── updated_at, kept true by the database ──────────────────────────────────
-- "Last touched" has to mean last touched, including when the change was an
-- item added or removed. A trigger is the only place that can promise that for
-- every path (RPC, direct delete, cascade), so it lives here rather than being
-- re-remembered at each call site.
create or replace function public.touch_mood_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.mood m
     set updated_at = now()
   where m.id = coalesce(new.mood_id, old.mood_id);
  return null;
end;
$$;

create trigger mood_item_touches_mood
  after insert or update or delete on public.mood_item
  for each row execute function public.touch_mood_updated_at();

-- ── add a song to a mood ───────────────────────────────────────────────────
-- Appending needs the next position computed and written in one breath, or two
-- taps in the same second land on the same number. RLS already says who may
-- write; this function exists for that atomicity — and for the live check, so a
-- draft or taken-down work can't be parked in a mood where it would render as a
-- dead row. Returns false when there was nothing to do (already there), true
-- when the song was added.
create or replace function public.mood_add_work(p_mood_id uuid, p_work_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_added integer;
begin
  if not exists (
    select 1 from public.mood m
     where m.id = p_mood_id and m.profile_id = auth.uid()
  ) then
    raise exception 'That mood is not yours'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.work w
     where w.id = p_work_id and w.status = 'live' and w.taken_down = false
  ) then
    raise exception 'Only a live work can join a mood'
      using errcode = 'check_violation';
  end if;

  insert into public.mood_item (mood_id, work_id, position)
  select p_mood_id,
         p_work_id,
         coalesce(max(i.position), 0) + 1
    from public.mood_item i
   where i.mood_id = p_mood_id
  on conflict (mood_id, work_id) do nothing;

  get diagnostics v_added = row_count;
  return v_added > 0;
end;
$$;

-- ── move a song up or down inside a mood ───────────────────────────────────
-- One statement: rank the mood as it stands, swap the moved item with its
-- neighbour, and write the whole run back as a clean 1..n. Renumbering rather
-- than swapping two numbers means positions can never drift into ties or gaps,
-- whatever happened before — the ordering repairs itself on every move. At the
-- top or bottom edge the target rank falls outside 1..n, `target` comes back
-- empty, and nothing is written: false, not an error.
create or replace function public.mood_move_item(p_item_id uuid, p_direction text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mood   uuid;
  v_moved  integer;
begin
  if p_direction not in ('up', 'down') then
    raise exception 'Direction must be up or down'
      using errcode = 'check_violation';
  end if;

  select i.mood_id into v_mood
    from public.mood_item i
    join public.mood m on m.id = i.mood_id
   where i.id = p_item_id and m.profile_id = auth.uid();

  if v_mood is null then
    raise exception 'That song is not in one of your moods'
      using errcode = 'insufficient_privilege';
  end if;

  with ranked as (
    select i.id,
           row_number() over (order by i.position, i.added_at, i.id) as rn
      from public.mood_item i
     where i.mood_id = v_mood
  ),
  bounds as (
    select (select r.rn from ranked r where r.id = p_item_id) as from_rn,
           (select count(*) from ranked)                      as n
  ),
  target as (
    select b.from_rn,
           b.from_rn + case when p_direction = 'up' then -1 else 1 end as to_rn
      from bounds b
     where b.from_rn is not null
       and b.from_rn + case when p_direction = 'up' then -1 else 1 end
           between 1 and b.n
  ),
  swapped as (
    select r.id,
           case when r.rn = t.from_rn then t.to_rn
                when r.rn = t.to_rn   then t.from_rn
                else r.rn
           end as new_rn
      from ranked r cross join target t
  )
  update public.mood_item i
     set position = s.new_rn
    from swapped s
   where s.id = i.id
     and i.position is distinct from s.new_rn;

  get diagnostics v_moved = row_count;
  return v_moved > 0;
end;
$$;

-- Signed-in callers only; the ownership asserts inside are the real gate.
revoke execute on function public.mood_add_work(uuid, bigint)  from public, anon;
revoke execute on function public.mood_move_item(uuid, text)   from public, anon;
grant  execute on function public.mood_add_work(uuid, bigint)  to authenticated;
grant  execute on function public.mood_move_item(uuid, text)   to authenticated;
