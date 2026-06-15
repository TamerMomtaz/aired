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
