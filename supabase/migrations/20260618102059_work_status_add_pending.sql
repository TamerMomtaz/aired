-- Extend the work lifecycle with a moderation hold. A non-trusted creator's
-- publish lands in 'pending' (the Review queue) instead of going straight to
-- 'live'; a trusted creator still publishes instantly. Run as its OWN migration
-- / statement: a newly added enum value cannot be both added and used inside one
-- transaction, so isolating it keeps the change from ever failing mid-tx.
-- Order becomes: draft, live, pending.
alter type public.work_status add value if not exists 'pending';
