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

**Phase 1 — Skeleton.** The app shell is live: a dark, mobile-first layout with a
header that reflects auth state, email + Google sign-in/up (Supabase Auth, sessions
refreshed in the Next.js 16 Proxy), the `AIRED-#### · "Title"` display component,
and the public registry (empty until Phase 2 brings uploads). A profile row opens
automatically on first signup. Next: Phase 2 (the Volley Ledger + uploads).

### Routes

| Route | What |
| --- | --- |
| `/` | Landing — wordmark, Red Line, calls to action |
| `/registry` | The public catalog (live works; empty for now) |
| `/login`, `/signup` | Email + Google auth |
| `/auth/callback`, `/auth/confirm` | OAuth / email code + token-hash exchange |

### Supabase dashboard settings this phase needs

Code is in place; these dashboard toggles (founder-only) light up the full flow:

- **Auth → URL Configuration:** Site URL `https://ai-red.io`; add Redirect URLs
  `https://ai-red.io/auth/callback`, `https://ai-red.io/auth/confirm` (and
  `http://localhost:3000/...` for local dev).
- **Auth → Providers → Google:** enable and add the OAuth client ID + secret for
  the “Continue with Google” button to work.
- **Auth → Email confirmation:** if on, signup shows “check your email”; if off,
  signup logs straight in. The app handles both.
