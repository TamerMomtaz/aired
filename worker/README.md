# AIRED transcoding worker (Phase 3)

Turns **one** work's audio master into a streamable HLS rendition and stores it
in Cloudflare R2. Per CLAUDE.md §5 (Phase 3) and Rule 6 (audio is served only
from R2).

The web app **auto-triggers** this worker as soon as a new `work` row is
inserted (`src/lib/works/transcode.ts`, called via `after()` from
`createWork`). The status stays `draft` — Go Live is still a deliberate click.
The CLI + curl forms below are still here for re-runs, debugging, and the
backfill case where the auto-trigger didn't fire (e.g. env vars missing on a
preview deploy). There is **no polling loop**.

What one run does, for a given `work_id`:

1. Read the `work` row from Supabase with the **service-role** key → get
   `master_storage_path`.
2. Download the master from the private Supabase Storage `masters` bucket
   (streamed to disk, so a 12-minute master never sits in memory).
3. `ffmpeg` → audio-only **HLS**, a single **AAC @ 192 kbps** rendition, **VOD**
   playlist (`-hls_playlist_type vod`, ~6 s MPEG-TS segments).
4. Upload to R2:
   - the **master copy** → `aired-masters` → sets `work.audio_master_key`
     (`work/<id>/master.<ext>`)
   - the **playlist + segments** → `aired-hls` → sets `work.hls_playlist_key`
     (`work/<id>/hls/playlist.m3u8`)
5. Update the `work` row with both keys. **Status stays `draft`** — taking a work
   live is Phase 4.

It is a plain-JavaScript Node service (no build step) so the container has the
fewest ways to break; `ffmpeg` is installed in the image and verified at build
time.

## Deploy on Railway

This lives in a **self-contained folder** so Railway deploys it straight from
this monorepo:

- **Root Directory:** `worker`
- **Builder:** Dockerfile (auto-detected — `worker/Dockerfile`). ffmpeg is
  installed inside the image, so nothing else is needed.
- Railway injects `PORT`; the server binds it automatically.
- Optional: point Railway's healthcheck at `/health`.

New Railway service → connect this GitHub repo → **Settings → Root Directory =
`worker`** → add the variables below → deploy.

## Environment variables

Set these on the Railway service (see `.env.example`). Secrets are env-only and
never committed (CLAUDE.md §1.7).

| Variable | Required? | Default | Notes |
| --- | --- | --- | --- |
| `SUPABASE_URL` | no | `https://bfvgqvpoecakwintxhap.supabase.co` | aired-platform API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes (secret)** | — | reads any work row + signs the master download |
| `SUPABASE_MASTERS_BUCKET` | no | `masters` | private bucket holding uploaded masters |
| `R2_ACCOUNT_ID` | no | `da822c931d669d9e250ed67ab8fd7323` | Cloudflare R2 account |
| `R2_ENDPOINT` | no | `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` | S3 endpoint |
| `R2_ACCESS_KEY_ID` | **yes (secret)** | — | R2 API token access key id |
| `R2_SECRET_ACCESS_KEY` | **yes (secret)** | — | R2 API token secret |
| `R2_MASTERS_BUCKET` | no | `aired-masters` | archival master copy |
| `R2_HLS_BUCKET` | no | `aired-hls` | served playlist + segments |
| `TRANSCODE_SHARED_SECRET` | **yes (secret)** | — | guards the HTTP endpoint; `openssl rand -hex 32` |
| `AUDIO_BITRATE` | no | `192k` | rendition bitrate |
| `HLS_SEGMENT_SECONDS` | no | `6` | target segment length |
| `APP_ORIGIN` | no | `https://ai-red.io` | where SHARE VIDEO fetches the burned-in still frame |
| `CLIP_DEFAULT_SECONDS` | no | `20` | SHARE VIDEO audio window |
| `CLIP_MAX_SECONDS` | no | `30` | SHARE VIDEO window cap |
| `CLIP_FPS` | no | `30` | SHARE VIDEO frame rate |
| `REEL_SNIPPET_FPS` | no | `30` | REEL frame rate, snippet mode |
| `REEL_FULL_FPS` | no | `24` | REEL frame rate, full-song mode |
| `REEL_SNIPPET_CONCURRENCY` | no | `2` | snippet reels rendering at once |
| `REEL_FULL_CONCURRENCY` | no | `1` | full-song reels rendering at once |
| `REEL_FONTS_DIR` | no | `/app/fonts` | Geist + Tajawal for the reel typesetter |
| `PORT` | no | `8080` | Railway injects this |

> The two R2 buckets (`aired-masters`, `aired-hls`) must already exist in the R2
> account. The R2 API token needs object read/write on both.

## Trigger a transcode

### HTTP (the deployed worker)

```bash
curl -X POST "$WORKER_URL/transcode" \
  -H "Authorization: Bearer $TRANSCODE_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"work_id": 1}'
```

`work_id` may also be passed as `?work_id=1`. The request runs the transcode
synchronously and returns JSON:

```json
{
  "ok": true,
  "workId": 1,
  "audioMasterKey": "work/1/master.mp3",
  "hlsPlaylistKey": "work/1/hls/playlist.m3u8",
  "segmentCount": 56,
  "masterBytes": 7912345,
  "elapsedMs": 8421
}
```

Errors return `{ "ok": false, "error": "…" }` with a 4xx/5xx status. A second
request for a work already transcoding gets `409`.

## Purge a discarded work (EDIT & TIDY)

When a creator **discards** a work, the web app deletes the `work` row (and its
cascaded volley / cert / play rows) and then calls this endpoint to sweep the
work's stored blobs — the only component that holds R2 credentials. Same
`Authorization: Bearer $TRANSCODE_SHARED_SECRET` guard as `/transcode`.

```bash
curl -X POST "$WORKER_URL/purge" \
  -H "Authorization: Bearer $TRANSCODE_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"work_id": 23, "master_storage_path": "<uid>/<uuid>/master.mp3"}'
```

It deletes, by `work/<id>/` prefix, everything under `aired-masters` and
`aired-hls`, plus the private transcode source at `masters/<master_storage_path>`
if given. Artwork (public bucket) is left alone — an album cover may reference a
song's image. The keys are derived from `work_id`, so the purge needs no DB row
(the row is already gone). Response:

```json
{ "ok": true, "workId": 23, "mastersDeleted": 1, "hlsDeleted": 57, "sourceDeleted": 1 }
```

## Make a reel — the lyric video (`/reel`)

The share sheet's **Make video** asks this endpoint (via the app route
`/share/song/<id>/reel`). A reel is the song as an MP4 with its **lyrics big on
screen**, so it doubles as a lyric video:

| option | values |
| --- | --- |
| `mode` | `snippet` — the owner's teaser window (≤ 50 s, same clamp as the clip below) · `full` — the whole song, hard cap **12:00** (longer songs stop at 12:00 with a fade) |
| `shape` | `vertical` 1080×1920 (Reels / TikTok / Shorts) · `square` 1080×1080 (feed) · `landscape` 1920×1080 (YouTube) — each with its own tuned type size, row budget and safe margins (`src/reel-layout.js`) |
| `highlight` | `karaoke` — each word lights as it's sung · `line` — each line fades in whole |

```bash
curl -X POST "$WORKER_URL/reel" \
  -H "Authorization: Bearer $TRANSCODE_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"work_id": 1, "mode": "full", "shape": "landscape", "highlight": "karaoke"}'
```

It **never renders inside the request** — it answers at once with the variant's
status, and enqueues the render if nothing is cached or running:

```json
{ "ok": true, "state": "rendering", "progress": 0.37, "position": 0,
  "key": "work/1/share/reel-full-landscape-karaoke-3f2a….mp4",
  "lyrics": "synced", "seconds": 412, "truncated": false,
  "filename": "AIRED-0001-full-16x9.mp4" }
```

`state` is `queued` (with `position`) → `rendering` (with `progress` 0–1) →
`ready` (with `bytes`), or `failed` (with `error`; send `"retry": true` to
re-queue). Poll until `ready`; the MP4 is then on the CDN at `key`. A song that
can't have a public reel (not live, taken down, no master yet) answers `404`.

**The queue** (`src/jobs.js`) is in memory, with two lanes so a long render never
stands in front of a teaser: snippets (2 at a time) and full songs (1 at a time).
Renders run under `nice` so uploads' transcodes stay quick. A restart drops the
queue; the app's next poll simply re-enqueues (a render is idempotent by key).

**The key** carries a hash of everything that shapes the picture — the words,
names, window, cover, style, and a render version — so an edited lyric or a new
cover is a new key and a stale reel is never served. Older renders of the same
variant are swept after each upload.

What one render does:

1. Read the `work` row and **guard it is live & not taken down** (again at render
   time — it may have been pulled while queued).
2. Fetch the **manifest** from the app —
   `{APP_ORIGIN}/share/song/<id>/reel-manifest`: catalog id, title, the makers by
   name (the SAME builder as the share cards), the address, and the synced
   lyrics (timed LRC lines).
3. Pull the master from `aired-masters` and the cover art (https only; any
   failure falls back to the branded near-black field).
4. **Background, once:** the cover scaled to cover a frame 8% wider than the
   output, softly blurred, dimmed by a scrim that deepens behind the lyric and
   caption zones. The corner's mean luma decides the lockup colour (off-white,
   or ink on a bright cover).
5. **Typeset** (`src/reel-text.js`, `src/reel-ass.js`) one ASS script: one lyric
   line per card, wrapped and sized per shape; a title card with the makers by
   name in the intro, long instrumental breaks and the outro; the persistent
   caption (AIRED-#### · "Title", the names, the address); the Red Line as the
   progress bar; the AIRED lockup in the top-left corner, never over the lyrics.
   Each script run gets its own face — **Geist** (Latin), **Tajawal** (Arabic),
   **Noto Sans CJK SC** (Chinese / Japanese / Korean) — and libass shapes it with
   HarfBuzz and orders it with FriBidi: Arabic joins and carries its diacritics,
   an Arabic-first line reads right-to-left and hangs flush **right**. The
   typesetter breaks rows itself (libass can't break CJK runs).
6. `ffmpeg` → the background drifting slowly sideways (a Ken-Burns pan) + the ASS
   layer burned in + the audio window → **H.264/AAC MP4** (yuv420p, faststart).
   Snippets: 30 fps, CRF 21. Full songs: 24 fps, CRF 23 capped at 3 Mb/s.
7. Upload to `aired-hls` with a download filename (`AIRED-0001-full-16x9.mp4`).

Word timing in karaoke mode is **interpolated** inside each line's window — the
tap-sync editor records when a line starts, not each word. Words light in reading
order; Latin and CJK words sweep, Arabic words light whole (libass sweeps
left→right, which would run backwards through an Arabic word).

**Render limits** (measured locally, 4 vCPU, the same ffmpeg/libass stack):

| | resolution | render time | file | peak memory |
| --- | --- | --- | --- | --- |
| snippet, 30 s | 1080×1920 · 1080×1080 · 1920×1080, 30 fps | ~15–20 s | ~2–3 MB | — |
| full, 12:00 (the cap) | same, 24 fps | ~4 min (236 s at 9:16, 252 s at 16:9) | ~52 MB with drifting cover art (31.5 MB on the plain field); the 3 Mb/s cap bounds the worst case at ~290 MB | ffmpeg ~440 MB + worker ~115 MB |

Render time scales with the Railway service's vCPUs — on 2 vCPU expect roughly
double. One full render at a time (the default lane) keeps that bounded.

## Render a share video — the waveform clip (legacy)

> Superseded in the share sheet by **`/reel`** above, which renders the same
> teaser window with the lyrics on screen. Kept (with its app routes) until the
> lyric reel is verified in production, then removable.

Instagram & TikTok take no links and only **video** carries audio, so to share a
song *with sound* we render a real MP4. The web app's share sheet used to
dispatch this endpoint (`src/lib/share/video.ts`); the clip is rendered **once**
and cached in R2, then served off the CDN. Same `Authorization: Bearer` guard.

```bash
curl -X POST "$WORKER_URL/share-video" \
  -H "Authorization: Bearer $TRANSCODE_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"work_id": 1, "orientation": "vertical"}'
```

`orientation` is `vertical` (1080×1920, Reels / TikTok / Stories) or `square`
(1080×1080, IG feed). Optional: `start_seconds`, `duration_seconds` (≤30),
`force` (re-render past the cache). One run:

1. Read the `work` row and **guard it is live & not taken down** — a draft /
   pending / pulled song never gets a public clip.
2. If the clip is already cached in R2, return immediately.
3. Fetch the burned-in still frame from the app
   (`{APP_ORIGIN}/share/song/<id>/clip-frame/<orientation>` — the SAME credits as
   the image cards) and read the waveform band from its `X-Clip-Band` header.
4. Pull the song's master from `aired-masters` (the clip's audio source).
5. `ffmpeg` → looped frame + glowing cert-red `showwaves` waveform painted into
   the band + the audio window → **H.264/AAC MP4** (yuv420p + faststart).
6. Cache it in `aired-hls` at `work/<id>/share/clip-<orientation>.mp4`.

```json
{ "ok": true, "workId": 1, "orientation": "vertical",
  "key": "work/1/share/clip-vertical.mp4", "bytes": 2317644, "durationSeconds": 20,
  "elapsedMs": 6120, "cached": false }
```

A second request for a clip already rendering gets `409` (the app polls and the
worker dedups by `work_id` + `orientation`).

### CLI (no HTTP, no shared secret)

Good for a one-off run, or a very long master that could outlast an HTTP timeout:

```bash
# locally, with the env vars set:
npm install
npm run transcode -- 1          # or: node src/cli.js 1

# or against the Railway service's environment:
railway run npm run transcode -- 1
```

## Local development

```bash
cp .env.example .env     # fill in the three secrets + TRANSCODE_SHARED_SECRET
npm install
npm start                # HTTP server on :8080
# ffmpeg must be on your PATH for local runs (the Docker image bundles it)
```
