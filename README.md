# AIRED

> **AI-ed and proud.** AI here means **Added Intelligence**, not Artificial.

The first music platform where the AI is a **named, credited collaborator** —
not hidden in the fine print. Listeners stream free. Creators upload human + AI
music and it goes **live in minutes**. Every track carries the **Volley Ledger**
and earns the **Red Line** certificate.

The repository constitution lives in [`CLAUDE.md`](./CLAUDE.md) — read it first.

## Stack

- **Next.js** (App Router, TypeScript) + **Tailwind v4** on **Vercel** — mobile-first, dark, cert-red on near-black.
- **Supabase** (Postgres + Auth + RLS + Realtime) — project `aired-platform` (`eu-central-1`).
- Cloudflare R2 (audio + CDN), Railway (ffmpeg workers) — later phases.

## Local development

```bash
cp .env.example .env.local   # public client credentials are filled in
npm install
npm run dev                  # http://localhost:3000
```

## Environment variables

| Variable | Scope | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public | aired-platform API URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | publishable key, guarded by RLS |

The public client config also ships a committed fallback in
`src/lib/supabase/config.ts`, so the deploy is connected out of the box; env vars
override it per environment. Real secrets (service-role key, R2 keys, encryption
keys) are **server-only and never committed** (CLAUDE.md §1.7).

## Status

**Phase 0 — Foundation.** Supabase schema (the ★ tables + RLS) is applied; the
Next.js app is scaffolded, connected to Supabase, and deployed to Vercel showing
the AIRED wordmark and the cert-red Red Line. Next: Phase 1 (auth + app shell).
