import {
  bandHeader,
  CLIP_DIMENSIONS,
  type ClipOrientation,
  renderClipFrame,
} from "@/lib/share/clip";
import { buildSongCard } from "@/lib/share/data";
import { createClient } from "@/lib/supabase/server";

// The burned-in still frame for a song's SHARE VIDEO (the Reels / TikTok clip).
// The worker (worker/src/clip.js) fetches this PNG, paints the audio-reactive
// waveform into the reserved band, and muxes the song's audio underneath. The
// frame is built from the SAME live-only buildSongCard() the image cards use, so
// the burned-in credits match the share cards exactly.
//
//   GET /share/song/1/clip-frame/vertical → 1080×1920 PNG (Reels / TikTok / Stories)
//   GET /share/song/1/clip-frame/square   → 1080×1080 PNG (IG feed)
//
// The waveform band rectangle rides on the response (X-Clip-Band: "x,y,w,h") so
// the worker paints it without any coordinate constant shared across services.
// A draft / pending / taken-down song resolves to null and 404s — a non-live
// work NEVER gets a clip frame (CLAUDE.md §1.5; the brief's drafts-never-share).

const ORIENTATIONS = new Set<ClipOrientation>(["vertical", "square"]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; orientation: string }> },
) {
  const { id, orientation } = await params;
  if (!ORIENTATIONS.has(orientation as ClipOrientation)) {
    return new Response("Not found", { status: 404 });
  }
  const o = orientation as ClipOrientation;

  const supabase = await createClient();
  const data = await buildSongCard(supabase, id);
  if (!data) {
    // Non-live (draft / pending / taken-down) or missing → no frame, no clip.
    return new Response("Not found", { status: 404 });
  }

  const dims = CLIP_DIMENSIONS[o];
  return renderClipFrame(data, o, {
    headers: {
      "X-Clip-Band": bandHeader(o),
      "X-Clip-Size": `${dims.width},${dims.height}`,
      // The worker re-fetches on every (re)render; let the CDN keep it briefly.
      "Cache-Control": "public, max-age=300",
    },
  });
}
