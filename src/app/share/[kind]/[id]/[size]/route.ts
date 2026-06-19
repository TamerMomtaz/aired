import {
  renderShareCard,
  renderShareFallback,
  type ShareVariant,
} from "@/lib/share/card";
import {
  buildAlbumCard,
  buildArtistCard,
  buildSongCard,
} from "@/lib/share/data";
import { shareFilenameBase } from "@/lib/share/props";
import { createClient } from "@/lib/supabase/server";

// The downloadable publicity assets — the Instagram / TikTok path (CONTEXT:
// image platforms take no links, so a creator saves the PNG and posts it with
// the link in bio). One route serves both portrait sizes for every subject:
//   GET /share/song/1/square      → 1080×1080 PNG (IG feed)
//   GET /share/album/<uuid>/story → 1080×1920 PNG (IG / Reels / TikTok story)
//   GET /share/artist/<handle>/story
// The og (1200×630) link-preview is colocated per route as opengraph-image, so
// it's never requested here. Each response is forced to download with a friendly
// filename. Subjects are resolved live-only by the builders, so a draft / taken-
// down subject degrades to the neutral AIRED card rather than leaking.

const KINDS = new Set(["song", "album", "artist"]);
// Only the portrait, downloadable formats are served here; "og" is the
// link-preview and lives at each route's opengraph-image.
const SIZES = new Set<ShareVariant>(["square", "story"]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ kind: string; id: string; size: string }> },
) {
  const { kind, id, size } = await params;

  if (!KINDS.has(kind) || !SIZES.has(size as ShareVariant)) {
    return new Response("Not found", { status: 404 });
  }
  const variant = size as ShareVariant;

  const supabase = await createClient();
  const data =
    kind === "song"
      ? await buildSongCard(supabase, id)
      : kind === "album"
        ? await buildAlbumCard(supabase, id)
        : await buildArtistCard(supabase, id);

  if (!data) {
    // A subject that vanished between page load and download still returns a
    // valid, branded PNG (attachment) instead of an error.
    return renderShareFallback(variant, {
      headers: {
        "Content-Disposition": `attachment; filename="aired-${variant}.png"`,
      },
    });
  }

  const base = shareFilenameBase(kind as "song" | "album" | "artist", {
    catalogId: data.eyebrow,
    title: data.title,
    handle: data.byline?.replace(/^@/, "") ?? null,
  });

  return renderShareCard(data, variant, {
    headers: {
      "Content-Disposition": `attachment; filename="${base}-${variant}.png"`,
    },
  });
}
