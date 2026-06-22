import {
  CLIP_LENGTH_DEFAULT,
  CLIP_START_DEFAULT,
  dispatchShareVideo,
  isClipOrientation,
  shareClipFilename,
  shareClipUrl,
} from "@/lib/share/video";
import { createClient } from "@/lib/supabase/server";
import { getWorkById } from "@/lib/works/queries";

// The downloadable SHARE VIDEO — a song's audible Reels / TikTok / IG clip.
// Instagram & TikTok take no links and only VIDEO carries audio, so this is how
// a song spreads on those apps: the listener saves this MP4 and posts it; it
// plays in-feed with the cover, a moving waveform, the named credits, ai-red.io.
//
//   GET /share/song/1/video/vertical → 1080×1920 MP4 (Reels / TikTok / Stories)
//   GET /share/song/1/video/square   → 1080×1080 MP4 (IG feed)
//
// The render is heavy, so it runs on the Railway worker (ffmpeg), async, and is
// cached in R2 (rendered once, reused). This route NEVER renders inline:
//   • cache hit  → stream the MP4 from the CDN as a download (friendly filename)
//   • cache miss → dispatch the worker and answer 202 "preparing"; the client
//                  (share sheet) polls until the clip is ready
// Live-only: a draft / pending / taken-down song 404s — it never gets a public
// clip (CLAUDE.md §1.5; the brief's drafts-never-share).

export const dynamic = "force-dynamic";
// Allow time to stream a cached clip through; the render itself is on the worker.
export const maxDuration = 60;

function preparing() {
  return new Response(JSON.stringify({ status: "preparing" }), {
    status: 202,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; orientation: string }> },
) {
  const { id, orientation } = await params;
  if (!isClipOrientation(orientation)) {
    return new Response("Not found", { status: 404 });
  }
  const workId = Number(id);
  if (!Number.isInteger(workId) || workId <= 0) {
    return new Response("Not found", { status: 404 });
  }

  // Live-only gate — a non-live song never resolves, so never gets a clip.
  const supabase = await createClient();
  const work = await getWorkById(supabase, workId);
  if (!work) {
    return new Response("Not found", { status: 404 });
  }

  // The CDN key is versioned by the owner's teaser window, so a changed window
  // resolves to a different (not-yet-cached) URL → re-render — never the stale
  // clip. The worker reads + clamps the same columns when it renders, so its key
  // matches this one. Null columns coalesce to the shared default window.
  const clipStart = work.clip_start_seconds ?? CLIP_START_DEFAULT;
  const clipLength = work.clip_length_seconds ?? CLIP_LENGTH_DEFAULT;
  const url = shareClipUrl(workId, orientation, clipStart, clipLength);
  if (!url) {
    return new Response(
      JSON.stringify({ error: "streaming not configured" }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }

  // Cache hit → stream the MP4 through as a download (same-origin, so the share
  // sheet can blob it for navigator.share / save-to-gallery).
  const cdn = await fetch(url, { cache: "no-store" });
  if (cdn.ok && cdn.body) {
    const headers: Record<string, string> = {
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename="${shareClipFilename(workId, orientation)}"`,
      "Cache-Control": "no-store",
    };
    const len = cdn.headers.get("content-length");
    if (len) headers["Content-Length"] = len;
    return new Response(cdn.body, { headers });
  }

  // Cache miss → kick the worker (deduped) and tell the client to keep polling.
  await dispatchShareVideo(workId, orientation);
  return preparing();
}
