-- ============================================================
-- AIRED · Review Gate (1/2) — admins can read every work
-- A non-trusted creator's publish lands in 'pending', which the existing
-- work_read_live_or_owner policy hides from everyone but its author. The Review
-- queue needs an admin to SEE those pending submissions, so add a SECOND,
-- permissive SELECT policy that is OR-ed alongside the existing one: an admin
-- may read works of ANY status. anon and non-admin users are entirely
-- unaffected — for them the subquery is false (anon: no profile row; non-admin:
-- is_admin = false) and only the original policy governs what they see.
--
-- The existing policies (work_read_live_or_owner, work_owner_ins/upd/del) are
-- left EXACTLY as they are. The subquery is wrapped in (select ...) so the
-- planner evaluates it once per statement (initplan), not per row.
-- ============================================================
drop policy if exists work_admin_read on public.work;
create policy work_admin_read on public.work
  for select
  using ( (select p.is_admin from public.profile p where p.id = auth.uid()) );
