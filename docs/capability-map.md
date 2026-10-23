# AIRED — Capability Distillation

Project code: **AIRED**. Compiled 2026-10-23 from the contents of this repository only
(code, migrations, READMEs, inline design notes). No external systems were queried;
anything marked "per docs" is stated in repo text and was not independently verified.

## 1 · Project

**AIRED** (ai-red.io) is a mobile-first, free-to-stream music platform where every track
carries a public provenance ledger (the Volley Ledger) naming each human and AI contributor,
and can earn a shareable authorship-and-process certificate (the Red Line).
Stack: Next.js 16 / React 19 on Vercel, Supabase (Postgres + Auth + RLS + Storage, eu-central-1),
Cloudflare R2 + CDN for audio, a Node/ffmpeg worker on Railway, plus an MCP server and CLI for
programmatic, human-authorized publishing.

---

## 2 · READY capabilities

> Built, working on the live platform, deliverable to a new client with setup, configuration
> or content only. Note: "READY" here means *delivered on the existing AIRED deployment*. Standing
> up a separate instance for a client is LATENT (see L01), because the base schema is not in the repo.

### AIRED-R01
- **Name:** Publish and stream long-form human+AI audio with per-track provenance credits
- **What it does:** A creator uploads audio + artwork, declares who did what (human / AI / dialogue), and the track is transcoded and streaming within minutes, with contributors credited by name on every surface.
- **Client problem it solves:** Creators and small labels working with AI tools have no venue that credits the AI openly, accepts 12-minute tracks, and goes live without a distributor or review wait.
- **Built from:** `upload-form` (direct-to-storage upload, no body-size cap), `createWork` + identity-column catalog numbers (AIRED-####), auto-dispatched ffmpeg → HLS worker, R2-served `hls.js` player with global queue, now-playing bar, sleep/lock-screen recovery, server-side play counting (`record_play` RPC, per-session hourly dedupe), browse-as-label home, search by title / catalog id / contributor, albums, artist pages, PWA install + offline downloads.
- **Evidence:** README.md (§Status, §Routes); worker/README.md; src/lib/works/actions.ts (`createWork`, `goLive`); src/components/player/player-provider.tsx; src/lib/plays/actions.ts; public/sw.js; src/lib/offline/*.
- **Gap to client-ready:** none for a creator or label onboarding onto AIRED. Content only.
- **Constraints:** English UI (Arabic supported in titles/lyrics rendering, not UI chrome). Metadata in Supabase Frankfurt; audio on Cloudflare R2 (region not pinned in repo); app on Vercel. Single 192 kbps AAC HLS rendition. Offline downloads not available on iPhone (no MSE). No payments.
- **Domain:** Deliver & control access
- **Fits client types:** independent artists, AI-music studios, small labels, cultural programs and festivals, educators
- **Confidence:** high

### AIRED-R02
- **Name:** Ingest finished works programmatically under audited human authority (API, MCP tool, CLI)
- **What it does:** A program or AI agent posts a finished track plus its credit ledger through one authenticated door; the work lands as a draft under a named human's authority, and a human still presses Go Live.
- **Client problem it solves:** Teams generating music at volume (or via agents) need a repeatable publish path that is idempotent, handles full-length masters, and leaves an honest record of who authorized each upload.
- **Built from:** `POST /api/works/ingest` (bearer token → grant naming human authority + performer; constant-time compare; hashed secrets only), `POST /api/works/upload-url` (short-lived, folder-scoped signed upload grants, 60/token/hour rate limit), idempotency keys unique per authority, all-or-nothing work creation, auto-appended "hands" volley, DB triggers `enforce_publish_honesty` and `guard_work_placement`, MCP server exposing `aired_publish_work`, zero-dependency Node CLI with dry-run validation and craft redaction.
- **Evidence:** README.md (§The honest wheelbarrow, §Full-length masters, §Why the database is the guarantee); src/lib/ingest/{publish,tokens,upload,rateLimit}.ts; mcp/README.md, mcp/src/index.js; scripts/README.md, scripts/publish-work.mjs; supabase/migrations/20260730105721_delegated_publish_honesty.sql.
- **Gap to client-ready:** none; issuing a token is an env-var change (`AIRED_INGEST_TOKENS`) plus a `performer_authority` row.
- **Constraints:** Inline audio capped at 4.5 MB (Vercel); larger masters must use the signed-URL path (both tools do this automatically). Rate limiter is per serverless instance. Tokens are env-managed, not self-service.
- **Domain:** Ingest & extract
- **Fits client types:** AI-music studios, agencies, agent/automation builders, labels with back catalogs
- **Confidence:** high

### AIRED-R03
- **Name:** Issue shareable authorship-and-process certificates with full contributor lineage
- **What it does:** For a live track, mints an immutable certificate listing every contributor (human and AI) in ledger order, with a public page, a 9:16 share card, an OG link preview and a QR that routes back to the work.
- **Client problem it solves:** Makers of AI-assisted work need a credible, non-fabricable way to disclose AI involvement and claim authorship without claiming resemblance to any artist.
- **Built from:** `issueCertificate` (derives `checks` from `public_volley` only: human_origin flag, contributor list collapsed to human/ai/tool, volley count, explicit `resemblance_claim: null`), immutable `certification` table (no update/delete policy), `/cert/[id]` page, `renderCertCard` (next/og), QR via `qrcode`.
- **Evidence:** src/lib/works/actions.ts:385–520; src/app/cert/[id]/{page.tsx,cert-card-image.tsx,card/route.ts}; CLAUDE.md §1.3.
- **Gap to client-ready:** none on AIRED.
- **Constraints:** Certifies declared process only; no fingerprinting, no legal weight claimed. Public cert reads only public data plus sanitized descriptors.
- **Domain:** Generate & publish
- **Fits client types:** artists, AI studios, competitions and grant programs that need AI-disclosure attestations
- **Confidence:** high

### AIRED-R04
- **Name:** Generate multilingual lyric videos (karaoke or line-by-line) in three aspect ratios
- **What it does:** Turns a hosted track and its tap-synced lyrics into a branded MP4 — teaser (≤50 s) or whole song (≤12:00) — in 9:16, 1:1 or 16:9, with big on-screen lyrics in Arabic, Latin and CJK scripts.
- **Client problem it solves:** Short-video platforms carry audio only inside video; creators need platform-ready lyric clips without a video editor, including correct Arabic shaping and right-to-left layout.
- **Built from:** worker `/reel` endpoint, per-shape layout tables (`reel-layout.js`), script-aware typesetter (`reel-text.js`: per-run font choice, CJK row breaking, width estimation), ASS script builder (`reel-ass.js`: karaoke word timing interpolated inside line windows, title card, caption, Red Line progress bar, lockup), ffmpeg Ken-Burns background + libass burn-in, two-lane in-memory job queue with progress, content-hashed R2 cache keys, owner-set teaser window.
- **Evidence:** worker/README.md (§Air it); worker/src/{reel,reel-text,reel-layout,reel-ass,jobs,ffmpeg}.js; src/lib/share/reel.ts; src/components/share-sheet.tsx; src/components/works/teaser-clip-editor.tsx.
- **Gap to client-ready:** none for tracks hosted on AIRED (upload, tap-sync lyrics, press "Air it").
- **Constraints:** Requires the track to exist as an AIRED work with LRC lyrics. Full render ≈4 min for 12:00 on 4 vCPU, one at a time; ~52 MB output. Queue is per worker instance and lost on restart (re-enqueued on next poll). Fonts: Geist, Tajawal, Noto Sans CJK (OFL / open licences).
- **Domain:** Generate & publish
- **Fits client types:** artists, labels, MENA creators, music educators, cultural institutions
- **Confidence:** high (benchmarks are local measurements stated in worker/README.md)

### AIRED-R05
- **Name:** Produce branded social share assets and QR entry points on demand
- **What it does:** Serves link-preview images (1200×630), downloadable square and story PNGs for songs, albums and artists, per-song QR codes and a printable QR poster, all rendered server-side with Arabic-safe fonts.
- **Client problem it solves:** Every share should carry the makers' names and route back to the source, without a designer producing assets per track.
- **Built from:** `renderShareCard` / `renderClipFrame` (Satori flexbox subset), bundled Geist + Tajawal per-glyph fallback, `buildSong/Album/ArtistCard` (live-only data), `/share/[kind]/[id]/[size]` download route, `SongQr`, `/qr` poster route, share sheet with web-intent buttons for link platforms and downloads for image platforms.
- **Evidence:** src/lib/share/{card.tsx,clip.tsx,data.ts,fonts.ts,props.ts}; src/app/share/[kind]/[id]/[size]/route.ts; src/components/{share-sheet,song-qr}.tsx; src/app/qr/*.
- **Gap to client-ready:** none on AIRED.
- **Constraints:** Satori cannot render several common Arabic fonts; Tajawal is the verified choice. Cards never include drafts or taken-down works.
- **Domain:** Generate & publish
- **Fits client types:** artists, labels, event organisers, any publisher on AIRED
- **Confidence:** high

### AIRED-R06
- **Name:** Give an AI performer a first-class, keyless artist identity with its own catalog
- **What it does:** Creates an AI persona as an artist (profile, handle, page, albums, listen rail) that can never sign in; works reach its rail only through a human the platform has vouched for, and that human is credited in the ledger as the hands.
- **Client problem it solves:** Brands and studios running AI personas need a public discography and credits for the persona without pretending the persona acts autonomously, and without creating a loginable account.
- **Built from:** performer migrations (auth row with null password, `.invalid` email, `banned_until = infinity`, no identities), `agent.profile_id` link, `performer_authority` table (who may carry whom; admin-managed, backfilled from tokens), upload-page performer selector gated by RLS `work_owner_ins` and the honesty trigger, `canManageWork` carrier rights, DB proof script.
- **Evidence:** supabase/migrations/20260731001500_performer_and_cee.sql, 20260731143000_ui_performer_authority.sql, 20260801054045_performer_the_sigma_band.sql, 20260730235500_performer_placement_and_carrier_rights.sql; src/lib/works/{performers,authority}.ts; supabase/tests/ui_performer_gate.sql; README.md (§Performers).
- **Gap to client-ready:** none; a new performer is one migration-style insert (profile + agent + grant). Two exist today per docs: (&) CEE and The Sigma Band.
- **Constraints:** Platform admin must create the performer and the grant; no self-service.
- **Domain:** Deliver & control access
- **Fits client types:** AI-music studios, brands with virtual artists, agencies, research groups studying AI creativity
- **Confidence:** high

---

## 3 · LATENT capabilities

> The hard part exists but is not packaged for a client outside AIRED.

### AIRED-L01
- **Name:** Deploy a white-label provenance-ledger audio platform for a client
- **What it does:** Stand up a separate, rebranded instance of the AIRED stack for a client's own community or catalog.
- **Client problem it solves:** Organisations that want their own credited-AI audio platform rather than publishing on AIRED.
- **Built from:** The whole repo: Next.js app, worker, MCP, in-repo migrations from 2026-06-18 onward, brand token system (`globals.css`, `aired-mark.tsx`, brand/generate_social.py).
- **Evidence:** README.md; supabase/migrations/README.md (states Phase 0–4 schema "lives only in the project's schema_migrations table").
- **Gap to client-ready:** Base schema (profile, agent, work, volleys, certification, play, `declare_volley`, `record_play`, storage buckets) must be exported from the live project into migrations; brand and copy are hard-coded (ai-red.io origins, AIRED wording); committed fallback Supabase config in `src/lib/supabase/config.ts` must be made per-tenant; no multi-tenancy. Effort: 3–6 weeks for a single-tenant clone.
- **Constraints:** Supabase + Vercel + R2 + Railway dependencies; target cost per docs ~$5–15/month at launch scale.
- **Domain:** Deliver & control access
- **Fits client types:** labels, broadcasters, cultural institutions, universities, incubators running creative programs
- **Confidence:** medium

### AIRED-L02
- **Name:** Record tamper-evident public/private provenance ledgers for any creative or knowledge work
- **What it does:** Stores the *shape* of each contribution publicly (who, role, origin, change type) and the *content* (prompts, rejected branches, rationale) encrypted and owner-only, linked by a hash so authorship can be proven on demand without publishing the recipe.
- **Client problem it solves:** Teams using AI need to show how a deliverable was made (for clients, funders, regulators) without exposing proprietary prompts.
- **Built from:** `writeVolley` (one writer for every door), `canonicalCraft` + SHA-256 `provenanceHash`, AES-256-GCM server sealing with `creator_key_ref` upgrade seam, atomic `declare_volley` RPC, `enforce_volley_origin` trigger (origin must agree with contributor type), owner-correctable public fields without re-sealing, contributor find-or-create resolution.
- **Evidence:** src/lib/ledger/{write,seal,types}.ts; src/lib/agents/resolve.ts; supabase/migrations/20260622204101_volley_origin_guard_and_editability.sql; CLAUDE.md §4.
- **Gap to client-ready:** Roles are music-specific (`lyric_thrown`, `vocal_render`, …); needs a configurable vocabulary, a generic "work" entity, a decrypt-on-demand verification flow and an embeddable UI. Effort: 4–8 weeks.
- **Constraints:** Server-held key (not creator-held) in v1. Postgres/Supabase assumed.
- **Domain:** Clean & structure
- **Fits client types:** research and advisory firms, design studios, donors and development programs with AI-use policies, government
- **Confidence:** medium

### AIRED-L03
- **Name:** Strip third-party names from user input and map them to neutral descriptors
- **What it does:** At the input boundary, detects "sounds like X" / bare proper-noun references, blocks them from public storage, maps known references to descriptor lists, and prompts the user to describe instead of name.
- **Client problem it solves:** Products that accept free-text style references must avoid storing or indexing third-party names (brand, artist, person) for legal and reputational reasons.
- **Built from:** `sanitizeReference`, `sanitizeDescriptorList` (pure, shared by client preview and server enforcement), extensible `descriptorDictionary`, GIN-indexed sanitized descriptor set.
- **Evidence:** src/lib/ledger/{sanitizeReference,descriptorDictionary,descriptors}.ts.
- **Gap to client-ready:** Dictionary has one seed entry; name detection relies on Title-Case heuristics that do not work for Arabic or all-lowercase input; no NER or LLM pass. Effort: 1–3 weeks to harden with a model-backed classifier and a real dictionary.
- **Constraints:** English-centric heuristics today.
- **Domain:** Clean & structure
- **Fits client types:** creative-tool vendors, marketplaces, UGC platforms, legal/compliance teams
- **Confidence:** medium

### AIRED-L04
- **Name:** Transcode uploaded audio to HLS and serve it from a zero-egress CDN with lifecycle cleanup
- **What it does:** A containerised worker streams a master from private storage, produces an AAC HLS VOD rendition, stores master and segments in R2, records keys, and can purge everything for a deleted item.
- **Client problem it solves:** Any product that needs cheap, seekable, long-form audio streaming without egress bills or a media-platform vendor.
- **Built from:** worker/src/{transcode,ffmpeg,r2,purge,supabase}.js, Dockerfile with build-time ffmpeg verification, shared-secret HTTP contract, fire-and-forget trigger with abort window, CLI for backfills.
- **Evidence:** worker/README.md; src/lib/works/{transcode,purge}.ts; worker/Dockerfile.
- **Gap to client-ready:** Reads/writes AIRED's `work` row and Supabase bucket; needs a generic job contract (input URL → output prefix + callback). Single rendition; no adaptive ladder, no DRM. Effort: 1–2 weeks.
- **Constraints:** Railway + R2 + Supabase today; synchronous HTTP transcode per request.
- **Domain:** Deliver & control access
- **Fits client types:** podcasters, education platforms, archives, broadcasters, SMEs with audio content
- **Confidence:** high

### AIRED-L05
- **Name:** Render multilingual caption/lyric videos from audio plus timed text (standalone)
- **What it does:** The reel pipeline (R04) as a service: given audio, timed lines (LRC), names and a cover, produce karaoke or line-reveal MP4s in three shapes with correct Arabic RTL, CJK wrapping and brand overlays.
- **Client problem it solves:** Arabic-first and mixed-script captioned video is poorly served by mainstream tools; organisations need batch, consistent, on-brand output.
- **Built from:** Everything in R04, especially `reel-text.js` (script detection, per-run fonts, width calibration), `reel-ass.js`, `jobs.js`.
- **Evidence:** worker/src/reel*.js; worker/README.md (§Air it, render limits).
- **Gap to client-ready:** Decouple from the AIRED manifest route and `work` row; accept arbitrary branding; expose as an API with its own auth and storage target. Effort: 2–4 weeks.
- **Constraints:** CPU-bound (≈4 min per 12-min video on 4 vCPU); fonts limited to Geist/Tajawal/Noto CJK unless extended.
- **Domain:** Generate & publish
- **Fits client types:** media houses, NGOs producing awareness content, educators, religious and cultural publishers, marketing agencies
- **Confidence:** medium

### AIRED-L06
- **Name:** Tap-to-sync timed text (LRC) editor and synced display
- **What it does:** An owner plays the audio and taps to timestamp each line; output is standard LRC, which drives a live "lit line" display and the video renderer.
- **Client problem it solves:** Timing transcripts or lyrics to audio usually needs desktop software; this runs in a mobile browser.
- **Built from:** `LyricsSyncEditor` (own `<audio>` on the HLS stream, keyboard/button stamping, re-timing from any line), `parseLrc` / `toLrc` (minutes unbounded for long tracks), `SyncedLyrics`, timing-preserving text edits in `work-editor`.
- **Evidence:** src/components/lyrics-sync-editor.tsx; src/lib/lyrics/lrc.ts; src/components/synced-lyrics.tsx; src/components/works/work-editor.tsx.
- **Gap to client-ready:** Extract as a component package with a pluggable save; add word-level timing if needed. Effort: 1–2 weeks.
- **Constraints:** Line-level timing only (word timing is interpolated downstream).
- **Domain:** Clean & structure
- **Fits client types:** podcasters, language educators, accessibility teams, music publishers
- **Confidence:** high

### AIRED-L07
- **Name:** Let AI agents submit content into a system under named human authority (audited agent write door)
- **What it does:** A reusable pattern: token → (human authority, acting persona) grant; idempotent submission; scoped signed upload URLs; draft-on-arrival; database triggers that refuse any record misreporting how it arrived; an MCP wrapper so agents can call it.
- **Client problem it solves:** Organisations adopting agents need agents to *propose* records (documents, listings, entries) with a human accountable and in the loop, provably, not by policy alone.
- **Built from:** src/lib/ingest/*, `enforce_publish_honesty`, `guard_work_placement`, `performer_authority`, mcp/src/index.js (MCP SDK + zod schema), scripts/publish-work.mjs.
- **Evidence:** README.md (§Why the database is the guarantee); supabase/migrations/20260730105721, 20260731143000; mcp/README.md.
- **Gap to client-ready:** Generalise the target entity and grant model; package the MCP server as a template; add token issuance UI. Effort: 3–6 weeks.
- **Constraints:** Postgres with RLS assumed; secrets are env-managed.
- **Domain:** Deliver & control access
- **Fits client types:** enterprises piloting agents, government digital teams, marketplaces, research institutions
- **Confidence:** medium

### AIRED-L08
- **Name:** Database-enforced community governance: trust tiers, review queue, take-downs, privilege guards
- **What it does:** New creators' publishes hold in a review queue; trusted ones go live instantly; admins approve/decline with reasons, trust artists, and take down or restore any work; triggers stop users from editing their own trust/admin flags or clearing a take-down; covenant acceptance is stamped at publish.
- **Client problem it solves:** Any UGC product needs moderation that cannot be bypassed by hitting the API directly.
- **Built from:** SECURITY DEFINER RPCs with in-function admin asserts (`review_approve`, `review_decline`, `set_artist_trusted`, `admin_takedown_work`, `admin_restore_work`), `guard_profile_privilege_columns`, `guard_work_takedown`, `work_read_live_or_owner` policy, `/review` surface, `GoLiveButton` covenant modal, `/terms`.
- **Evidence:** supabase/migrations/20260618102025, 20260618110720, 20260618134225; src/lib/review/*; src/app/review/*; src/components/go-live-button.tsx; src/app/terms/page.tsx.
- **Gap to client-ready:** Extract as a Supabase module (SQL + server actions + admin UI) with configurable states. Effort: 2–4 weeks.
- **Constraints:** Supabase/Postgres RLS model.
- **Domain:** Deliver & control access
- **Fits client types:** community platforms, marketplaces, accelerators and donor programs running submission portals, government portals
- **Confidence:** high

### AIRED-L09
- **Name:** Ship an installable, offline-capable web app for streamed media
- **What it does:** PWA with platform-aware install coaching, a service worker that is safe with React Server Components, offline navigation fallback, and full-song offline downloads (HLS manifest + segments + artwork into Cache Storage, IndexedDB snapshots, storage estimates, cancel/delete), with honest capability detection where offline cannot work.
- **Client problem it solves:** Media products that must work on weak or absent connectivity without a native app.
- **Built from:** public/sw.js, src/app/manifest.ts, src/components/install/*, src/lib/offline/*, src/components/offline/*, Vercel deployment-id skew protection in next.config.ts.
- **Evidence:** public/sw.js header; src/lib/offline/{download,cache,capability,store}.ts; next.config.ts.
- **Gap to client-ready:** Extract the offline library and SW as a reusable package; document the RSC caching rules. Effort: 1–3 weeks.
- **Constraints:** iPhone Safari cannot play cached HLS through a service worker (native HLS bypasses it); downloads are disabled there by design. Segments cached unencrypted.
- **Domain:** Deliver & control access
- **Fits client types:** education and training providers, NGOs in low-connectivity regions, broadcasters, field teams
- **Confidence:** high

### AIRED-L10
- **Name:** Diagnose media playback failures on mobile with an in-app flight recorder
- **What it does:** A localStorage-backed, write-through ring log of transport events, errors, recovery attempts and inter-event gaps (wall vs monotonic clock), readable on-device, plus a bounded fatal-error recovery ladder for hls.js and a foreground freeze check.
- **Client problem it solves:** "It stopped playing in the car / on lock screen" bugs are invisible to normal analytics; this captures evidence on the device.
- **Built from:** src/lib/diagnostics/{log,probe}.ts, src/components/diagnostics/diagnostics-screen.tsx, recovery logic in player-provider.tsx.
- **Evidence:** those files; commits "A black box for the player, before a single fix".
- **Gap to client-ready:** Packaging as a drop-in for any `<audio>`/`<video>` + hls.js app; optional remote upload of logs. Effort: 1–2 weeks.
- **Constraints:** Browser-only; log capped at ~400 entries.
- **Domain:** Analyze & model
- **Fits client types:** media and e-learning product teams, automotive/infotainment web apps
- **Confidence:** medium

### AIRED-L11
- **Name:** Render dynamic Arabic/Latin images server-side (certificates, cards, posters)
- **What it does:** Generates PNGs at request time with mixed Arabic and Latin text and QR codes on serverless infrastructure, avoiding the Arabic-shaping crash in next/og.
- **Client problem it solves:** Bilingual certificates, tickets, badges and social cards usually break on Arabic text in serverless image pipelines.
- **Built from:** src/lib/share/fonts.ts (bundled Geist + Tajawal, per-glyph fallback, documented failing fonts), card/cert/QR renderers.
- **Evidence:** src/lib/share/fonts.ts; commit "Fix clip-frame 500 on Arabic/non-Latin titles: bundle Arabic font".
- **Gap to client-ready:** Template system for client layouts. Effort: days to 2 weeks per template family.
- **Constraints:** Satori flexbox subset; Tajawal is the only verified Arabic face; no full RTL paragraph layout beyond what Satori provides.
- **Domain:** Generate & publish
- **Fits client types:** training providers, event organisers, government services, schools, donors issuing certificates
- **Confidence:** high

---

## 4 · POTENTIAL capabilities

> Not built; credible on current assets.

### AIRED-P01
- **Name:** Certify AI involvement in non-music deliverables (reports, designs, code, research)
- **What it does:** A disclosure certificate and public lineage page for any document or asset, stating who (human and AI) contributed what, backed by a sealed private trail.
- **Client problem it solves:** Funders, journals, procurement and regulators increasingly ask for AI-use disclosure; most teams have nothing verifiable.
- **Built from (foundation):** L02 ledger model, R03 certificate issuance and cards, L11 bilingual rendering, L07 agent door.
- **Evidence:** CLAUDE.md §4 (ledger described as "a Vn-Trail adapted for creation"); src/lib/works/actions.ts (`issueCertificate`).
- **Gap to client-ready:** Generic role vocabulary, document/file attachment and hashing, verifier UI, policy mapping (e.g. to funder or journal AI policies), legal review of claims. Effort: 2–3 months.
- **Constraints:** Certifies declared process, not detection; needs clear wording to avoid over-claiming.
- **Domain:** Advise & method
- **Fits client types:** research and advisory firms, universities, donors and development programs, government, design agencies
- **Confidence:** medium

### AIRED-P02
- **Name:** Build a creator-owned private knowledge corpus from sealed working notes ("Carbon RAG")
- **What it does:** Retrieval over a creator's own encrypted prompts, rejected branches and rationale, so their past craft informs new work without ever being public.
- **Client problem it solves:** Knowledge workers lose the reasoning behind past outputs; shared AI tools leak it.
- **Built from (foundation):** `private_volley` canonical JSON craft rows, `openCraft` decrypt path, owner-only RLS.
- **Evidence:** CLAUDE.md §4 ("This is also the creator's private Carbon RAG corpus"); src/lib/ledger/seal.ts.
- **Gap to client-ready:** Decrypt-on-demand service, embeddings and index with the same ownership boundary, client-held keys (the documented "Option B"), retrieval UI. Effort: 2–4 months.
- **Constraints:** Key management and residency decisions are open.
- **Domain:** Analyze & model
- **Fits client types:** advisory firms, authors and studios, R&D teams
- **Confidence:** low

### AIRED-P03
- **Name:** Attribute and split revenue by ledger contribution and verified plays
- **What it does:** Uses the per-track contributor ledger and server-verified play counts to compute attribution shares and payouts.
- **Client problem it solves:** Human+AI collaborations have no standard for crediting or paying collaborators and tool vendors.
- **Built from (foundation):** `record_play` RPC (live-only, per-session hourly dedupe, server-attributed), `public_volley` roles/origins, catalog and artist play stats.
- **Evidence:** src/lib/plays/actions.ts; src/lib/works/queries.ts (`getArtistPlayStats`, `getMostAired`); CLAUDE.md §5 lists Stripe + Paymob as post-launch.
- **Gap to client-ready:** Payment integration, split rules, statements, tax/KYC, dispute flow. Effort: 3+ months.
- **Constraints:** Egypt-side payments (Paymob) and international (Stripe) both untouched; legal design needed.
- **Domain:** Analyze & model
- **Fits client types:** labels, collecting societies, creator platforms
- **Confidence:** low

### AIRED-P04
- **Name:** Detect duplicate or re-uploaded audio at ingest (fingerprint dedupe)
- **What it does:** Fingerprints each master during transcode and flags matches against the catalog before a work goes live.
- **Client problem it solves:** Catalog hygiene and basic rights protection for any audio platform.
- **Built from (foundation):** The worker already holds every master in a controlled pipeline step (L04) and the review queue can hold flagged items (L08).
- **Evidence:** CLAUDE.md §5 ("fingerprint dedupe" listed as later); worker/src/transcode.js.
- **Gap to client-ready:** Fingerprinting library/service choice, index storage, matching thresholds, reviewer UI. Effort: 4–8 weeks.
- **Constraints:** Third-party fingerprint dependency likely.
- **Domain:** Ingest & extract
- **Fits client types:** audio platforms, archives, broadcasters
- **Confidence:** medium

---

## 5 · Cross-cutting enablers

- **Structural enforcement in the database:** RLS plus BEFORE triggers (`enforce_volley_origin`, `enforce_album_ownership`, `enforce_publish_honesty`, `guard_work_placement`, privilege and take-down guards) so invariants hold for every writer, including bugs and hand-crafted requests. (supabase/migrations/*)
- **Proof-style SQL test scripts** that run as `authenticated` with a real JWT `sub` and report PASS/FAIL per policy, unwinding all writes. (supabase/tests/*.sql)
- **Pure functions shared by client preview and server enforcement:** reference sanitizer, LRC parser, handle validation, authority predicate. (src/lib/ledger, src/lib/lyrics, src/lib/identity, src/lib/works/authority.ts)
- **Server-only sealing and secrets discipline:** AES-256-GCM in Node runtime, hashed tokens, constant-time comparison, secrets never echoed. (src/lib/ledger/seal.ts, src/lib/ingest/tokens.ts)
- **Mixed-script text rendering stack:** Geist + Tajawal + Noto Sans CJK across Satori (images) and libass/HarfBuzz/FriBidi (video). (src/lib/share/fonts.ts, worker/src/reel-text.js, worker/Dockerfile)
- **Scoped signed upload URLs and idempotent ingest** to bypass serverless body limits safely. (src/lib/ingest/upload.ts, publish.ts)
- **Worker pattern:** single Docker service, Bearer-secret HTTP contract, fire-and-forget trigger, in-memory two-lane job queue, content-hashed cache keys so stale renders are never served. (worker/src/index.js, jobs.js, reel.js)
- **Live-only data discipline** for every public read (explicit `status='live' and not taken_down` filters, never trusting RLS alone). (src/lib/works/queries.ts, src/lib/share/data.ts)
- **Catalog identity:** bigint identity column displayed as zero-padded `AIRED-####` with free-text title; no ceiling. (src/lib/catalog.ts)
- **Brand token system** reused across app, images, video and a Python asset generator. (src/app/globals.css, src/lib/branding/aired-mark.tsx, brand/generate_social.py)
- **Vercel deployment-id skew protection + RSC-safe service worker** for long-lived PWA sessions. (next.config.ts, public/sw.js)

## 6 · Know-how assets (sellable as advice without software)

- **The Volley Ledger model:** shape vs craft separation; roles / origins / delta types; why public rows hold structure only. (CLAUDE.md §4, src/lib/ledger/types.ts)
- **Reciprocal provenance and delegation doctrine:** "the artist vs the hands", delegation never autonomy, draft-on-arrival, human-in-the-loop as a structural property. (README.md §The honest wheelbarrow; migrations 20260730*)
- **Disclosure-certificate wording:** certify authorship and process only, never resemblance; names of makers vs descriptors of sound. (CLAUDE.md §1.2–1.3a)
- **Trust-tiered moderation design** with database-level privilege guards. (migrations 20260618*)
- **Next.js 16 / React 19 / Supabase SSR practices** (Proxy session refresh, Server Actions authorization inside the function, `after()` dispatch, `useSyncExternalStore` stores). (src/proxy.ts, src/lib/*/actions.ts, src/lib/offline/store.ts)
- **Arabic rendering pitfalls and fixes** in Satori and libass (which fonts crash, face naming for weights, RTL alignment rules, CJK row breaking). (src/lib/share/fonts.ts, worker/src/reel-text.js, worker/README.md)
- **Mobile playback resilience:** hls.js recovery ladder, background throttling signatures, iOS MSE limits for offline. (player-provider.tsx, diagnostics/log.ts, offline/capability.ts)
- **Serverless media constraints:** 4.5 MB body cap workaround, 2-hour signed URL TTL, per-instance rate limiting trade-offs. (src/lib/ingest/upload.ts, rateLimit.ts)
- **Low-cost streaming architecture** (R2 zero-egress, single-rendition HLS, Railway worker) with a stated ~$5–15/month launch target. (CLAUDE.md §3)

## 7 · Proof points (as stated in repo text; not externally verified)

- Live platform at **ai-red.io** with production worker URL `aired-production.up.railway.app` configured. (README.md, .env.example)
- Catalog has passed **AIRED-0098**; works 0097 and 0098 sit on an AI performer's rail. (migration 20260731143000 header)
- Two AI performer-artists created: **(&) CEE** and **The Sigma Band**; silicon contributor rows for Claude, Suno, AISong.org, chatGPT, Gemini. (migrations; scripts/README.md)
- Named human artists on the platform besides the founder: Taim, Osama. (README.md §Performers)
- Seed catalog: AIRED-0001 "ALL (Σ I)", AIRED-0002 "SO SO AIRED". (CLAUDE.md §6)
- Repository activity: 103 commits, 37 merged pull requests, 2026-06-15 to 2026-09-30.
- Render benchmarks: teaser reels ~15–20 s; 12-minute full reel ~4 min on 4 vCPU, ~52 MB output. (worker/README.md)
- Two database proof scripts (library isolation; performer gate) covering RLS and trigger behaviour. (supabase/tests)
- Real-world fixes shipped from field failures: Arabic-title 500s, raw RSC on PWA launch, playback dying on sleeping phones. (git log)

## 8 · Top 3 to lead with

1. **AIRED-L02 / P01 — Provenance ledgers and AI-disclosure certificates.** The most differentiated asset in the portfolio: a working, database-enforced model for recording human and AI contributions with sealed private craft and public, shareable certificates. It transfers to reports, designs and research, which is where advisory firms, donors and government are being asked for AI disclosure now.
2. **AIRED-L07 — Audited agent write door (human authority, idempotent, MCP-ready).** Every organisation piloting agents needs agents to submit records with a named accountable human and no autonomy claim. This exists end-to-end (API, triggers, MCP server, CLI) and is easy to demonstrate.
3. **AIRED-R04 / L05 / L11 — Multilingual (Arabic-first) media generation.** Lyric/caption video and bilingual image rendering that handles Arabic, Latin and CJK correctly on serverless and container infrastructure is scarce, demonstrable today, and relevant to media, education, NGO and government communications across the region.

## 9 · Open questions

- **Live status and traffic:** the repo cannot confirm uptime, user counts, play counts or that the Railway worker and R2 buckets are currently funded and running.
- **Base schema provenance:** Phase 0–4 DDL (core tables, `declare_volley`, `record_play`, storage policies) is not in the repo; needs export before any clone or audit.
- **Observability stack:** CLAUDE.md names Resend, Plausible and Sentry; only `@vercel/analytics` is in package.json. Unclear what is wired in production.
- **Sanitizer coverage in production:** the committed dictionary has one entry; unknown whether a larger list exists outside the repo.
- **Data residency:** Supabase is eu-central-1; R2 bucket location and Vercel function region are not stated.
- **Key custody:** a single server-held AES key (`AIRED_VOLLEY_ENC_KEY`) seals all private craft; rotation and creator-held keys are not implemented.
- **Legal posture of the Red Line certificate** and of the Covenant (/terms) has no documented review.
- **Ownership and licensing** of the codebase (Supabase org "VC", founder Kahotia) for client reuse is not stated in the repo.
- **Tests:** no automated app-level test suite exists (only two SQL proof scripts); CI configuration is not in the repo.
- **Legacy waveform clip path** (`/share-video`) is marked for removal pending production verification of the reel; status unknown.
