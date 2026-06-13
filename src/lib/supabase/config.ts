// Public Supabase client configuration for AIRED (project: aired-platform).
//
// These are PUBLIC client credentials: the project URL and the publishable
// ("anon") key. They are designed to be shipped in client code and are guarded
// by Row Level Security on every table. They are NOT the secrets named in
// CLAUDE.md §1.7 (Supabase service-role key, R2 keys, encryption keys) — those
// are server-only, live in env vars, and are never committed.
//
// Env vars take precedence, so these can be overridden per-environment in
// Vercel without touching code. The committed fallbacks keep the deploy
// connected out of the box.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://bfvgqvpoecakwintxhap.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "sb_publishable_nQg2He1bEI0CBnGgxHyNrQ_-qfcM97X";
