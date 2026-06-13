# CLAUDE.md — AIRED

> This file is the constitution of this repository. Claude Code: read it fully at the
> start of every session and obey it. When a request conflicts with this document,
> stop and flag the conflict. Do not skip phases. Do not break the Ledger rules.

---

## 0 · WHAT WE ARE BUILDING

AIRED — the first music platform where the AI is a **named, credited collaborator**,
not hidden in the fine print. Listeners stream free. Creators upload human+AI music and
it goes **live in minutes** — no distributor, no gatekeeper, no review queue. AIRED is the
destination, not a key to someone else's house.

Tagline: **AI-ed and proud.** AI here means **Added Intelligence**, not Artificial.

The spine of the platform is the **Volley Ledger** (a Vn-Trail adapted for creation). A track
without a ledger is just an MP3; the ledger is what makes it an AIRED work and earns the
**Red Line** certificate. The ledger is built in from the first table — never bolted on later.

Founder: Tee (Tamer Momtaz / Kahotia), Cairo. Launch target: a working web platform,
mobile-first, shipped fast.

---

## 1 · NON-NEGOTIABLE RULES (the guardrails)

These protect every user. Violating them is a critical bug.

1. **Never store a raw prompt in any public/served/indexed location.** Verbatim prompts live
   only in the encrypted `private_volley` table, creator-owned, never served.
2. **Never store a third-party artist/band/song name in public data or the search index.**
   At the input boundary, the **reference-sanitizer** maps artist references → sonic descriptors
   and discards the raw name before any public write. ("like Rock Me Amadeus" → "80s new wave,
   gated drums, brass stabs, spoken-rap verses, chant chorus".)
3. **The Red Line certificate claims authorship and process only — never resemblance.**
   Allowed: "human-architected · AI-rendered · process-attested." Forbidden: "in the style of X",
   "sounds like X".
3a. **CONTRIBUTOR IDENTITY IS ALWAYS PUBLIC AND CELEBRATED — never confuse it with a style
   reference.** Two completely different things, and the platform's whole value depends on the
   distinction:
   - **Contributors** (the people/agents who actually MADE the track — e.g. "recreAi",
     "Tee / Kahotia", "Claude / Anthropic", "Suno") live in the `agent` table, each with a public,
     **searchable, followable** `name` and `profile_slug` (their own page + discography). Every
     `public_volley` links to its contributor by name. The Red Line certificate displays **every
     contributor by name**, carbon and silicon alike, on the marquee. This is the platform's core
     growth mechanic: people search and follow **names**; a contributor's hunger to make their
     name into *a name* is the upload engine. NEVER hide, anonymize, or omit a contributor's name.
   - **Style references** (a third-party artist merely named as a sonic target — "like Madonna")
     are the ONLY names that must never be stored. They are sanitized to descriptors per Rule 2.
   In one line: **`agent` holds WHO MADE IT (always shown, searchable); `descriptors` holds WHAT
   IT SOUNDS LIKE (never a person's name).** AIRED forgets the whisper and remembers the maker.
4. **No song length cap.** Accept long tracks (12+ minutes) — it is a deliberate differentiator.
5. **Uploads are instant** (upload → transcode → live). No human review queue in the pipeline.
6. **Audio is served only from R2 via CDN** (zero egress). Never stream audio straight from
   Supabase Storage.
7. **Secrets** (Supabase service key, R2 keys, encryption keys) live in env vars only — never in
   client code, never committed.

---

## 2 · IDENTITY & CATALOG

- Platform name: **AIRED**.
- Each released track gets a **catalog ID**: an auto-incrementing integer, type `bigint`
  (effectively unlimited — millions of tracks, never a ceiling).
- **Display** the catalog ID zero-padded to 4 digits *as a minimum*: `AIRED-0001`, `AIRED-0002`…
  and it naturally grows digits past 9999 (`AIRED-10000`). Padding is presentation only; the
  stored value is the raw integer. Never hard-code a max.
- Every work also has a free-text, editable **title**. Display format: **AIRED-#### · "Title"**
  (e.g. `AIRED-0001 · "ALL (Σ I)"`). Number anchors; title sings.

---

## 3 · THE STACK (agreed)

- **Frontend/host:** Next.js (App Router, TypeScript) on **Vercel**. Mobile-first, dark theme.
  Accent color = cert-red on near-black. The Red Line is the audio progress bar.
- **Database/auth/storage-of-metadata:** **Supabase** (Postgres + Auth + RLS + Realtime).
  - Organization: **VC** (`id: ufhmfufathcgzddkoohx`, Pro plan).
  - Project to create in Phase 0: **`aired-platform`**, region **eu-central-1** (Frankfurt).
  - (Do not reuse the existing projects: av-vcdna-platform, ai-smart-sourcing, teereigned,
    plant-t-production.)
- **Audio storage + CDN:** **Cloudflare R2** (zero egress). Stores master + HLS chunks.
- **Workers:** **Railway** — ffmpeg transcoding (upload → HLS), waveform gen, cron for charts.
- **Player:** hls.js + custom controls.
- **Email:** Resend. **Analytics:** Plausible. **Errors:** Sentry. (All later phases.)

Cost target at launch: ~$5–15/month total. Keep it there.

---

## 4 · THE DATA MODEL (the heart)

Core tables (Phase 0 creates the starred ones):

- **`profile`** ★ — human accounts (links to Supabase auth.users).
- **`agent`** ★ — any contributor, carbon or silicon: `type` (`human` | `ai_model` | `ai_voice`
  | `tool`), `name`, `version`, `profile_page`. **Silicon agents are first-class rows**, with
  their own pages and discographies — not metadata.
- **`work`** ★ — a track: `id` (bigint catalog number), `title`, `artwork_url`, `status`
  (`draft` | `live`), `red_line_certified` (bool), `duration_seconds` (no cap), `created_at`.
- **`public_volley`** ★ — the served, indexed ledger node:
  `(id, work_id, seq, agent_id, role, origin, delta_type, created_at, private_hash)`.
  - `role` ∈ {lyric_thrown, lyric_caught, structure, genre_direction, vocal_render, production,
    artwork, edit, audit}
  - `origin` ∈ {HUMAN, AI, DIALOGUE}
  - `delta_type` ∈ {added, removed, reframed}
  - Stores the **shape** of a contribution, never its content.
- **`private_volley`** ★ — encrypted craft, creator-owned, **never served, never indexed**:
  `(id, work_id, seq, ciphertext, creator_key_ref, created_at)`. RLS-locked to the creator.
  `private_hash` on the public row links the two so authorship is provable on demand without
  ever publishing the recipe. This is also the creator's private **Carbon RAG** corpus.
- **`certification`** — `(work_id, standard, checks, issued_at, cert_url)`. Reads only public data
  + sanitized descriptors. The Red Line is the signed head of the public trail.
- **`play`, `follow`, `playlist`** — streaming furniture (later phases).

RLS on from the start: drafts and all `private_volley` rows are private to their creator.

---

## 5 · BUILD ORDER (phase-gates — DO NOT SKIP)

Each phase must end in something the founder can **see working** before the next begins.
At the end of each phase, stop and report what to verify.

- **Phase 0 — Foundation.** Create the `aired-platform` Supabase project (confirm cost with the
  founder first). Write the schema migration for the ★ tables + RLS. Init the Next.js repo, push
  to GitHub, connect to Vercel. **Verify:** tables visible in Supabase; blank app deployed to a
  live Vercel URL.
- **Phase 1 — Skeleton.** App shell: dark mobile-first layout, auth (email + Google), the
  AIRED-####·title display component, an empty registry page. **Verify:** you can sign up, log in,
  see an empty catalog at the live URL.
- **Phase 2 — The Ledger.** Upload form (audio + artwork + title) writing a `work`; the
  Volley-Ledger editor declaring volleys → writes paired `public_volley` + encrypted
  `private_volley` with the hash link; the **reference-sanitizer** at the input boundary.
  **Verify:** upload a track, declare volleys, confirm the public row holds only shapes and the
  private row is encrypted, and no artist name reached public data.
- **Phase 3 — Streaming (isolated, full focus).** R2 bucket; Railway ffmpeg worker (master → HLS);
  store chunks in R2; hls.js player with the Red Line progress bar. **Verify:** press play on
  AIRED-0001 and hear it stream, seek smoothly, including a 12-minute track.
- **Phase 4 — The Red Line.** Certification logic + cert card (shareable, TikTok/IG sized, QR);
  public registry lookup. **Verify:** a certified track shows the Red Line and a shareable cert.
- **Phase 5 — Discovery.** Agent pages (Claude/Suno discographies — "the first platform where an
  AI has a discography"); AllGoRhythm radio (one endless certified station). **Verify:** an agent
  page lists works; radio plays continuously.

Later (post-launch, not now): Expo mobile app; payments (Stripe + Paymob); fingerprint dedupe;
optional Spotify/Apple distribution bridge.

---

## 6 · SEED CATALOG (first works to load)

- **AIRED-0001 · "ALL (Σ I)"** — hypnotic trance mantra.
- **AIRED-0002 · "SO SO AIRED"** — the platform anthem.
Ledger for each: lyrics thrown by Tee (Kahotia) · structure/arrangement caught by Claude
(Anthropic) · vocal/instrumental render by Suno · certified &I v1.

---

## 7 · VOICE & STYLE

Product copy is warm, plain, confident — accurate sentences, not hype. The platform teaches one
quiet idea: **no one ever made anything alone; the ledger reveals the connection.** Within the
without. Σ I.

*recreAi Ionganica · IdeaTa · mefay*

---

## ENGINEERING NOTES (this repo)

> Operational notes for working in this codebase. The constitution above governs;
> these notes are subordinate to it.

@AGENTS.md
