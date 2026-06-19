import {
  renderShareCard,
  renderShareFallback,
  SHARE_DIMENSIONS,
} from "@/lib/share/card";
import { buildSongCard } from "@/lib/share/data";
import { createClient } from "@/lib/supabase/server";

// Per-song link preview: when a registry URL is dropped into WhatsApp / X /
// Facebook / LinkedIn / Slack, this is the card the unfurler renders. It's the
// upgraded publicity card (one design, shared with the downloadable square/story
// formats) — cover, AIRED-#### · title, and the makers carbon and silicon by
// name. Identity & authorship only, never a style descriptor (CLAUDE.md §2, §3a).
// The builder is live-only, so a draft / taken-down work degrades to the neutral
// AIRED fallback rather than leaking.

export const alt = "AIRED — a song, credited to human and AI by name";
export const size = SHARE_DIMENSIONS.og;
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const data = await buildSongCard(supabase, id);
  return data ? renderShareCard(data, "og") : renderShareFallback("og");
}
