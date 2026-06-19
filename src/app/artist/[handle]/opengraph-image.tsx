import {
  renderShareCard,
  renderShareFallback,
  SHARE_DIMENSIONS,
} from "@/lib/share/card";
import { buildArtistCard } from "@/lib/share/data";
import { createClient } from "@/lib/supabase/server";

// Per-artist link preview — an artist page is shareable too, with its own
// publicity card: their name + handle, their avatar, and the collaborators across
// their live catalogue, carbon and silicon by name (the platform's whole point —
// a creator who credits their AI). The [handle] segment resolves a handle OR a
// legacy profile id; a missing artist degrades to the neutral AIRED fallback.

export const alt = "AIRED — an artist who credits their AI, by name";
export const size = SHARE_DIMENSIONS.og;
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const supabase = await createClient();
  const data = await buildArtistCard(supabase, handle);
  return data ? renderShareCard(data, "og") : renderShareFallback("og");
}
