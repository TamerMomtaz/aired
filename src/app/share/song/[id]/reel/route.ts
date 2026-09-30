import type { NextRequest } from "next/server";

import {
  isReelHighlight,
  isReelMode,
  isReelShape,
  requestReel,
} from "@/lib/share/reel";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { canManageWork } from "@/lib/works/authority";
import { getWorkById } from "@/lib/works/queries";

// A song's REEL — the lyric-video generator behind the share sheet's "Make a
// video" (the worker renders; R2 caches; this route asks and relays).
//
//   GET /share/song/1/reel?mode=snippet&shape=vertical&highlight=karaoke
//     → 200 { status: "queued" | "rendering" | "ready" | "failed" | "preparing",
//             progress, position, lyrics, seconds, truncated, url, bytes, filename }
//     The first ask enqueues the render; the share sheet polls until "ready".
//     &retry=1 re-queues a render that failed.
//
//   GET …&download=1 (once ready)
//     snippet → streams the MP4 through, same-origin, so the sheet can hand the
//               file to the phone's share sheet (save to gallery / TikTok)
//     full    → 302 to the CDN copy (a 12-minute video never streams through a
//               function; R2 serves it with its download filename — Rule 6)
//
// Live-only: a draft / pending / taken-down song 404s (CLAUDE.md §1.5).
// FULL mode is for the song's own hands — the artist, or the human who carried
// it here: a full-length MP4 is the whole song as a file, and a 12-minute
// render is the worker's heaviest job. Anyone may make a snippet.

export const dynamic = "force-dynamic";
// Room to stream a cached snippet through; renders happen on the worker.
export const maxDuration = 60;

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workId = Number(id);
  if (!Number.isInteger(workId) || workId <= 0) {
    return json({ error: "not found" }, 404);
  }
  const q = req.nextUrl.searchParams;
  const mode = q.get("mode") ?? "snippet";
  const shape = q.get("shape") ?? "vertical";
  const highlight = q.get("highlight") ?? "karaoke";
  if (!isReelMode(mode) || !isReelShape(shape) || !isReelHighlight(highlight)) {
    return json({ error: "unknown mode, shape or highlight" }, 400);
  }

  // Live-only gate — a non-live song never resolves, so never gets a reel.
  const supabase = await createClient();
  const work = await getWorkById(supabase, workId);
  if (!work) return json({ error: "not found" }, 404);

  if (mode === "full") {
    const user = await getCurrentUser();
    const { data: placement } = await supabase
      .from("work")
      .select("creator_id, published_by_authority")
      .eq("id", workId)
      .maybeSingle();
    if (!canManageWork(placement, user?.id ?? null)) {
      return json({ error: "The full-song video is made by the song's own hands." }, 403);
    }
  }

  const result = await requestReel(workId, mode, shape, highlight, {
    retry: q.get("retry") === "1",
  });
  if (!result.ok) {
    return result.reason === "not-found"
      ? json({ error: "not found" }, 404)
      : json({ error: "video rendering is not available right now" }, 503);
  }
  const { reel } = result;

  if (q.get("download") !== "1") return json(reel);

  if (reel.status !== "ready") {
    return json({ error: "not ready yet", ...reel }, 409);
  }
  if (!reel.url) {
    // NEXT_PUBLIC_R2_PUBLIC_BASE unset — the reel exists but has no public address.
    return json({ error: "streaming not configured" }, 503);
  }
  if (mode === "full") return Response.redirect(reel.url, 302);

  const cdn = await fetch(reel.url, { cache: "no-store" });
  if (!cdn.ok || !cdn.body) return json({ error: "video not reachable" }, 502);
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Content-Disposition": `attachment; filename="${reel.filename ?? `reel-${workId}.mp4`}"`,
    "Cache-Control": "no-store",
  };
  const len = cdn.headers.get("content-length");
  if (len) headers["Content-Length"] = len;
  return new Response(cdn.body, { headers });
}
