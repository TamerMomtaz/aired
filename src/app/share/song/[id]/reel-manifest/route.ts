import { parseLrc } from "@/lib/lyrics/lrc";
import { addressOf } from "@/lib/share/card";
import { buildSongCard } from "@/lib/share/data";
import { createClient } from "@/lib/supabase/server";

// The words and names of a song's REEL — what the worker (worker/src/reel.js)
// typesets over the artwork. Built from the SAME live-only buildSongCard() the
// share cards and the clip frame use, so a reel names exactly the makers the
// cards name (carbon and silicon, by name — CLAUDE.md §3a), plus the synced
// lyrics parsed by the app's one LRC parser (src/lib/lyrics/lrc.ts).
//
//   GET /share/song/1/reel-manifest →
//     { workId, catalogId, title, names[], certified, coverUrl, address,
//       lines: [{ t, text }] }          (timed lines only; t in seconds)
//
// Identity, authorship and the song's own public words — nothing else. Never a
// descriptor, never a prompt (CLAUDE.md §1–3). A draft / pending / taken-down
// song 404s: a non-live work never gets a reel.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const card = await buildSongCard(supabase, id);
  if (!card) return new Response("Not found", { status: 404 });

  const workId = Number(id);
  const { data } = await supabase
    .from("work")
    .select("lyrics")
    .eq("id", workId)
    .eq("status", "live")
    .eq("taken_down", false)
    .maybeSingle();

  // Only timed lines can be placed on a reel's clock. A blank timed line stays:
  // it is the "clear the screen" marker before an instrumental.
  const lines = parseLrc((data as { lyrics: string | null } | null)?.lyrics)
    .filter((l): l is { text: string; t: number } => l.t !== null)
    .map((l) => ({ t: l.t, text: l.text.trim() }));

  return Response.json(
    {
      workId,
      catalogId: card.eyebrow,
      title: card.title,
      names: card.names,
      certified: card.certified,
      coverUrl: card.coverUrl,
      address: addressOf(card.url),
      lines,
    },
    // The worker re-reads this whenever it plans a render; an edited lyric must
    // show up in the next reel, so it is never cached.
    { headers: { "Cache-Control": "no-store" } },
  );
}
