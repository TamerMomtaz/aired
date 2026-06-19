import {
  renderShareCard,
  renderShareFallback,
  SHARE_DIMENSIONS,
} from "@/lib/share/card";
import { buildAlbumCard } from "@/lib/share/data";
import { createClient } from "@/lib/supabase/server";

// Per-album link preview — an album is shareable too, with its own publicity
// card: the cover, the album title, the artist, and the makers across its live
// songs, carbon and silicon by name. Built live-only (its songs are status='live'
// only), so an album with no public songs still resolves to a tasteful card and a
// missing album degrades to the neutral AIRED fallback.

export const alt = "AIRED — an album, credited to human and AI by name";
export const size = SHARE_DIMENSIONS.og;
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const data = await buildAlbumCard(supabase, id);
  return data ? renderShareCard(data, "og") : renderShareFallback("og");
}
