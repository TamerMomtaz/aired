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
| `AIRED_VOLLEY_ENC_KEY` | **server-only** | AES-256-GCM key (base64, 32 bytes) that seals private volleys. Generate with `openssl rand -base64 32`. Required from Phase 2 on. |

The public client config also ships a committed fallback in
`src/lib/supabase/config.ts`, so the deploy is connected out of the box; env vars
override it per environment. Real secrets (service-role key, R2 keys, encryption
keys) are **server-only and never committed** (CLAUDE.md §1.7).

## Status

**Phase 2 — The Volley Ledger + uploads (the heart).** Creators upload a track
(title + audio + artwork), claim a public contributor name, and declare the
**Volley Ledger** — each volley writing a paired public *shape* row and an
encrypted, creator-owned *craft* row, linked by a SHA-256 provenance hash. The
**reference-sanitizer** at the input boundary maps any third-party artist name to
neutral descriptors (or prompts you to describe the sound), so a name never
reaches public data. Audio masters land in a private bucket — not streamed (R2 +
the Red Line player are Phase 3).

### How the pieces fit

- **Upload** (`/upload`) — audio + artwork upload *directly* from the browser to
  Supabase Storage, so long tracks bypass the serverless request-body cap; a
  Server Action then writes the `work` row at `draft`. The catalog id
  (AIRED-####) is assigned by the database identity column.
- **Sealing** — volley craft is encrypted with AES-256-GCM in a Node.js Server
  Action (`src/lib/ledger/seal.ts`); the key (`AIRED_VOLLEY_ENC_KEY`) never ships
  to the browser. The paired private + public insert is one atomic transaction
  (the `declare_volley` RPC, RLS-scoped to the creator).
- **Names vs. descriptors** — `agent` holds WHO MADE IT (always shown,
  followable); `work.descriptors` holds WHAT IT SOUNDS LIKE (sanitized, never a
  person's name).

### Routes

| Route | What |
| --- | --- |
| `/` | Landing — wordmark, Red Line, calls to action |
| `/registry` | The catalog (live works + your own drafts) |
| `/registry/[id]` | A work + its Volley Ledger (conductivity map); editor for the owner |
| `/upload` | Upload a track (creator-only) |
| `/claim` | Claim your public contributor name |
| `/agent/[slug]` | A contributor's page + discography (carbon or silicon) |
| `/login`, `/signup` | Email + Google auth |
| `/auth/callback`, `/auth/confirm` | OAuth / email code + token-hash exchange |

### Supabase resources this phase added

- `work.master_storage_path` (private master path — *not* the reserved R2 key
  columns) and `work.descriptors` (public, sanitized, GIN-indexed).
- Function `declare_volley(...)` — the atomic paired volley write.
- Storage buckets `masters` (private, owner-scoped) and `artwork` (public read,
  owner-scoped writes).
- Seeded silicon contributors: **Claude** and **Suno** and AISong.org.

### Founder setup for this phase

1. **Encryption key.** `openssl rand -base64 32`, then set `AIRED_VOLLEY_ENC_KEY`
   in `.env.local` and in Vercel → Settings → Environment Variables (all
   environments) and redeploy. Declaring a volley returns a clear error without it.
2. **Large masters (optional).** The `masters` bucket allows 500 MB, but the
   project-wide Storage upload limit (Storage → Settings) may need raising for
   very large WAVs. The MP3 seed tracks are well within limits.
3. **Pre-existing advisories (optional).** Enable leaked-password protection
   (Auth → Providers); the Phase-0 `handle_new_user` trigger shows a benign
   SECURITY DEFINER advisory.
   

   
