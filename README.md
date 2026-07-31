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
| `POST /api/works/ingest` | The delegated publish door — lands a work as a **draft** on a human's delegated authority (see below) |

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

## The honest wheelbarrow — delegated publishing

The Volley Ledger already tells the truth about **who authored** a work (HUMAN /
AI / DIALOGUE). This adds the truth about **how it reached the shore**, side by
side with it on every work forever:

- **`published_via = 'human_ui'`** — hands at the web UI. The session user is the
  uploader, so there is no separate delegating authority.
- **`published_via = 'delegated_api'`** — a program posted it through
  `POST /api/works/ingest`, and `published_by_authority` names the **human whose
  token authorized it**.

Nothing here creates or implies autonomous AI will. An AI performer does not
decide to publish: a human holds a token, and a program posts on that human's
authority. The label states **delegation, never autonomy** — and the work still
lands as a **draft** that a human promotes with Go Live.

### Reciprocal provenance — two artists, each in the other's ledger

A delegated work files under the **credited performer**, not the human who
carried it. An AI performer is a first-class artist here: their own profile,
their own rail on Listen, their own artist page, their own albums and catalog.

- `work.creator_id` — **the artist.** The performer.
- `work.published_by_authority` — **the hands.** The human who authorized it.

And the human is not merely a column: the door writes them into that work's
Volley Ledger as a credited contributor — role `audit`, origin `HUMAN` — stating
that they carried it to shore, never that they authored it. On a human's work the
AI is credited; on a performer's work the human is credited. Neither is the tool.

Because a performer never signs in, the carrying human keeps the working rights
over what they carried — see it on `/manage`, edit it, promote it, certify it,
discard it. That is not a loophole around "a human still publishes"; it is what
makes that promise keepable. RLS enforces it structurally
(`creator_id = auth.uid() or published_by_authority = auth.uid()`), and
`guard_work_placement` refuses any UPDATE that re-points either column — a work
can never be moved onto another artist's rail, not even by the hands that
carried it.

### The door

```bash
curl -X POST https://ai-red.io/api/works/ingest \
  -H "Authorization: Bearer $AIRED_INGEST_SECRET" \
  -H 'content-type: application/json' \
  -d '{
    "title": "The Loyal Donkey",
    "audio": { "master_path": "<artist-uuid>/<upload-uuid>/master.mp3" },
    "placement": { "mode": "single" },
    "descriptors": "trance, mantra, spoken verses",
    "volley": [
      { "contributor": { "name": "Tee / Kahotia", "type": "human" },
        "role": "lyric_thrown", "origin": "HUMAN", "delta_type": "added",
        "craft": { "prompt": "…sealed, never served…" } },
      { "contributor": { "name": "(&) CEE", "type": "ai_model" },
        "role": "structure", "origin": "DIALOGUE", "delta_type": "reframed" }
    ],
    "idempotency_key": "4f1a…"
  }'
```

- **Auth** — `Authorization: Bearer <token>`, compared in constant time and
  resolved to a grant naming the human authority **and the performer it speaks
  for**. A missing, blank, malformed, or unknown token gets the same generic
  `401`; the presented token is never echoed or logged. Config lives in env vars
  only — see [`.env.example`](./.env.example).
- **Audio** — either `audio.master_path`, an object the caller already uploaded to
  the private `masters` bucket (how a long track avoids the request-body cap), or
  an inline `audio` file part with the metadata in a `payload` field
  (`multipart/form-data`). Either way the master lands in the **private** bucket
  and only ever reaches listeners as HLS from R2 via the CDN (Rule 6). A path may
  only point inside the authorizing human's own folder — they uploaded the bytes;
  a performer has no session and can upload nothing.
- **Idempotency** — `idempotency_key` (uuid) is required, unique **per authority**
  at the database level. A retried POST returns the draft it already created
  (`200`, `"replay": true`) instead of minting a second AIRED number.
- **Contributors by name** — each volley credits its maker by name (Rule 3a), and
  a name resolves find-or-create to one canonical `agent` row, so one maker keeps
  one page and one discography. `contributor.type` is required only the first time
  a name appears — that row becomes their public page, so it is never guessed.
  The work itself is filed under the **performer's** catalog (`creator_id`), with
  the authorizing human recorded as the hands and credited by name in the ledger.
- **Same ledger, same pipeline** — the volleys are written by the same
  `writeVolley` → `declare_volley` path the editor calls (sanitize → hash → seal →
  atomic paired write), contributors resolve through the same find-or-create, the
  catalog number comes from the same identity column, and the same Railway
  transcode is kicked afterwards. The wheelbarrow is a new *door*, not a new
  *ledger*.
- **Nothing half-made keeps an AIRED number** — if any volley fails, the work row
  is deleted (its rows cascade with it) and the same `idempotency_key` can be
  retried cleanly.

The [`mcp/`](./mcp) directory wraps the same route as an MCP tool,
`aired_publish_work`, for agent contexts — same token, same stamp, same draft.

### Why the database is the guarantee

`enforce_publish_honesty` (a `BEFORE INSERT OR UPDATE` trigger on `work`) makes
the platform **structurally unable** to misreport how a work arrived, even with an
application bug or a hand-crafted write — the same discipline as
`enforce_volley_origin` and `enforce_album_ownership`:

| Rule | Refused |
| --- | --- |
| `delegated_api` ⇒ `published_by_authority` NOT NULL | an anonymous machine arrival |
| `human_ui` ⇒ authority, token label and idempotency key all NULL | a hand upload dressed as delegated |
| `delegated_api` on INSERT ⇒ `status = 'draft'` | any path that skips human review |
| `published_via` ∈ {`human_ui`, `delegated_api`} | invented provenance |

`guard_work_placement` (also `BEFORE UPDATE` on `work`) does the same for whose
work it is: `creator_id` and `published_by_authority` are facts of creation and
no UPDATE may rewrite either, so a work can never be moved onto another artist's
rail or shed the human accountable for it — not by a stranger, not by the artist,
not by the hands that carried it.

Every work's provenance is shown plainly on **/manage** — "Uploaded via web", or
"Delegated upload · authorized by {human} · performer {performer} · {token label}".

### Supabase resources this adds

- `work.published_via` (NOT NULL, default `'human_ui'`, CHECK-constrained — every
  pre-existing row backfills to `human_ui`, because they were all hand-uploaded),
  `work.published_by_authority` (FK → `profile`), `work.ingest_token_label`,
  `work.ingest_idempotency_key` (unique per authority).
- Trigger + function `enforce_publish_honesty()`.
- Trigger + function `guard_work_placement()`, and the `work` / `public_volley` /
  `private_volley` / `certification` policies widened from `creator_id =
  auth.uid()` to `creator_id = auth.uid() or published_by_authority = auth.uid()`.
  INSERT on `work` is deliberately left strict.

## Performers — an AI with its own rail

**(&) CEE** is the first, at [`/artist/and-cee`](https://ai-red.io/artist/and-cee):
a `profile` (handle, bio, mascot) exactly like Taim's or Osama's, plus an `agent`
row linked to it by `profile_id` — the same wiring Tee's own rows use. Their
credit chip reads **Art Intelligence**, which is what AI has always meant here.

A performer is an **identity, not a credential**. `profile.id` is a FK to
`auth.users.id`, so the rail needs an auth row; a performer's is built with no
password, an address at a `.invalid` domain that can never receive a magic link
or a reset, and `banned_until` set to infinity. Signing in as a performer is
impossible by construction. Work reaches their rail one way only: a delegated
token a human authorized, with that human named in the ledger as the hands.

To give a performer a token, name both profiles in the app's env:

```jsonc
// AIRED_INGEST_TOKENS — server-only, Vercel, all environments
[{ "label": "cee-wheelbarrow",
   "authority": "<the authorizing human's profile.id>",
   "performer": "<the performer's profile.id>",
   "sha256":    "<printf %s \"$TOKEN\" | shasum -a 256>" }]
```

Only the hash is stored — never the secret. Generate one with
`openssl rand -base64 32`, hash it, and keep the plaintext where the caller runs.
The same pattern adds the next performer: a row in this array, a profile, a rail.
