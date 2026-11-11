import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { dedupeContributors } from "@/lib/works/queries";
import { parseLrc } from "@/lib/lyrics/lrc";
import { foldText } from "./normalize";

// The searchable catalog behind voice search: every LIVE work with the public
// text a listener might remember it by — title, the words of its lyrics, who
// made it, its album, its artist, and its sonic descriptors.
//
// Everything here is already public on the song page. Nothing private is read:
// the client is the anon key with no session, so RLS shows exactly what a
// logged-out visitor sees, and we still filter live + not taken down explicitly.
// No private_volley, no prompt, ever (CLAUDE.md §1.1).
//
// The catalog is small (hundreds of songs), so we hold it in module memory for a
// few minutes per serverless instance instead of querying on every request.

export type CatalogSong = {
  id: number;
  title: string;
  artworkUrl: string | null;
  durationSeconds: number | null;
  hlsPlaylistKey: string | null;
  contributors: { name: string; profile_slug: string | null }[];
  album: string | null;
  artist: string | null;
  descriptors: string[];
  // Lyric lines with LRC timestamps stripped, blank lines dropped.
  lines: string[];
  // Folded forms for matching, computed once.
  foldedTitle: string;
  foldedMeta: string; // contributors + album + artist + descriptors
  foldedLines: string[];
};

const TTL_MS = 5 * 60 * 1000;
let cached: { at: number; songs: CatalogSong[] } | null = null;
let inflight: Promise<CatalogSong[]> | null = null;

type Row = {
  id: number;
  title: string;
  artwork_url: string | null;
  duration_seconds: number | null;
  hls_playlist_key: string | null;
  lyrics: string | null;
  descriptors: string[] | null;
  creator_id: string | null;
  album: { title: string } | null;
  public_volley: Array<{
    agent: { name: string; profile_slug: string | null } | null;
  }>;
};

async function load(): Promise<CatalogSong[]> {
  const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("work")
    .select(
      "id, title, artwork_url, duration_seconds, hls_playlist_key, lyrics, descriptors, creator_id, album:album_id(title), public_volley(agent(name, profile_slug))",
    )
    .eq("status", "live")
    .eq("taken_down", false)
    .order("id", { ascending: true })
    .limit(5000);
  if (error) throw new Error(`voice catalog: ${error.message}`);
  const rows = (data ?? []) as unknown as Row[];

  const creatorIds = Array.from(
    new Set(rows.map((r) => r.creator_id).filter((x): x is string => !!x)),
  );
  const artistById = new Map<string, string>();
  if (creatorIds.length) {
    const { data: profiles } = await supabase
      .from("profile")
      .select("id, display_name")
      .in("id", creatorIds);
    for (const p of (profiles ?? []) as {
      id: string;
      display_name: string | null;
    }[]) {
      if (p.display_name) artistById.set(p.id, p.display_name);
    }
  }

  return rows.map((r) => {
    const contributors = dedupeContributors(r.public_volley);
    const lines = parseLrc(r.lyrics)
      .map((l) => l.text.trim())
      .filter((t) => t.length > 0);
    const album = r.album?.title ?? null;
    const artist = r.creator_id ? (artistById.get(r.creator_id) ?? null) : null;
    const descriptors = Array.isArray(r.descriptors) ? r.descriptors : [];
    return {
      id: r.id,
      title: r.title,
      artworkUrl: r.artwork_url,
      durationSeconds: r.duration_seconds,
      hlsPlaylistKey: r.hls_playlist_key,
      contributors,
      album,
      artist,
      descriptors,
      lines,
      foldedTitle: foldText(r.title),
      foldedMeta: foldText(
        [
          ...contributors.map((c) => c.name),
          album ?? "",
          artist ?? "",
          ...descriptors,
        ].join(" "),
      ),
      foldedLines: lines.map(foldText),
    };
  });
}

export async function getVoiceCatalog(): Promise<CatalogSong[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.songs;
  if (!inflight) {
    inflight = load()
      .then((songs) => {
        cached = { at: Date.now(), songs };
        return songs;
      })
      .finally(() => {
        inflight = null;
      });
  }
  try {
    return await inflight;
  } catch (err) {
    // A failed refresh keeps serving the last good copy rather than going dark.
    if (cached) return cached.songs;
    throw err;
  }
}
