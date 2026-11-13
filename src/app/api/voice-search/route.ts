import { NextResponse } from "next/server";

import { getVoiceCatalog, type CatalogSong } from "@/lib/voice/catalog";
import { queryTerms } from "@/lib/voice/normalize";
import { scoreCatalog } from "@/lib/voice/score";
import { understandAndPick, voiceAiEnabled } from "@/lib/voice/understand";
import { parseCatalogQuery } from "@/lib/works/queries";

// POST /api/voice-search — "play the song where she says…"
//
// Body: { q: string }  (what the listener said or typed, any language)
// Reply: { intent, ai, results: [{ id, title, …, reason, snippet, confidence }] }
//
// Flow: keyword-score the live catalog → (AI, optional) Claude reads a card for
// every song plus those word matches and picks the song meant, by lyric, theme,
// mood or maker, and says why. With no ANTHROPIC_API_KEY it is keyword search
// alone, which handles a remembered lyric or title but not a description.
//
// Public data only (see lib/voice/catalog). The query is never stored or logged.

export const runtime = "nodejs";

const MAX_QUERY = 300;
const PLAY_WORDS =
  /^(play|put on|شغل|شغّل|شغلي|شغللي|اسمع|عايز اسمع|حط|7ot|shaghal|sha8al)\b/i;

// A light per-instance guard against a looping client running up AI cost. Not a
// security boundary — see lib/ingest/rateLimit for the same honest caveat.
const WINDOW_MS = 60_000;
const LIMIT = 20;
const hitsByIp = new Map<string, { start: number; count: number }>();
function allow(ip: string): boolean {
  const now = Date.now();
  const w = hitsByIp.get(ip);
  if (!w || now - w.start > WINDOW_MS) {
    if (hitsByIp.size > 1000) hitsByIp.clear();
    hitsByIp.set(ip, { start: now, count: 1 });
    return true;
  }
  w.count++;
  return w.count <= LIMIT;
}

type Result = {
  id: number;
  title: string;
  artworkUrl: string | null;
  durationSeconds: number | null;
  hlsPlaylistKey: string | null;
  contributors: { name: string; profile_slug: string | null }[];
  reason: string | null;
  snippet: string | null;
  confidence: number;
};

function toResult(
  song: CatalogSong,
  extra: { reason?: string | null; snippet?: string | null; confidence: number },
): Result {
  return {
    id: song.id,
    title: song.title,
    artworkUrl: song.artworkUrl,
    durationSeconds: song.durationSeconds,
    hlsPlaylistKey: song.hlsPlaylistKey,
    contributors: song.contributors,
    reason: extra.reason ?? null,
    snippet: extra.snippet ?? null,
    confidence: extra.confidence,
  };
}

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allow(ip)) {
    return NextResponse.json(
      { error: "Too many searches in a minute. Try again shortly." },
      { status: 429 },
    );
  }

  let q = "";
  try {
    const body = (await request.json()) as { q?: unknown };
    q = typeof body.q === "string" ? body.q.trim().slice(0, MAX_QUERY) : "";
  } catch {
    // fall through to the empty-query reply
  }
  if (!q) {
    return NextResponse.json({ error: "Say or type what you're looking for." }, { status: 400 });
  }

  let songs: CatalogSong[];
  try {
    songs = await getVoiceCatalog();
  } catch {
    return NextResponse.json(
      { error: "The catalog couldn't be read right now." },
      { status: 503 },
    );
  }
  const byId = new Map(songs.map((s) => [s.id, s]));

  const ai = voiceAiEnabled();
  let intent: "play" | "find" = PLAY_WORDS.test(q) ? "play" : "find";

  // A spoken catalog number ("AIRED 12") goes straight to that song.
  const num = parseCatalogQuery(q);
  if (num !== null && byId.has(num)) {
    return NextResponse.json({
      intent,
      ai,
      results: [toResult(byId.get(num)!, { confidence: 1 })],
    });
  }

  const hits = scoreCatalog(songs, queryTerms(q), [q], 12);

  if (ai) {
    // Claude sees every song's card plus these word matches as a hint, and
    // picks by meaning (see lib/voice/understand).
    try {
      const understood = await understandAndPick(q, songs, hits);
      if (understood) {
        intent = understood.intent;
        const matched = new Map(hits.map((h) => [h.song.id, h.matchedLines]));
        return NextResponse.json({
          intent,
          ai: true,
          results: understood.picks.map((p) =>
            toResult(byId.get(p.id)!, {
              reason: p.reason,
              snippet: matched.get(p.id)?.[0] ?? null,
              confidence: p.confidence,
            }),
          ),
        });
      }
    } catch (err) {
      // Never log the query itself; the error class is enough to diagnose.
      console.error(
        "voice-search: AI step failed, using word matching",
        err instanceof Error ? err.name : "unknown",
      );
    }
  }

  // Keyword-only ranking. Confidence is relative: a clear leader reads high.
  const top = hits[0]?.score ?? 0;
  const second = hits[1]?.score ?? 0;
  return NextResponse.json({
    intent,
    ai: false,
    results: hits.slice(0, 5).map((h, i) =>
      toResult(h.song, {
        snippet: h.matchedLines[0] ?? null,
        confidence:
          i === 0 ? (second === 0 ? 0.9 : Math.min(0.9, 0.4 + 0.5 * (1 - second / top))) : 0.3,
      }),
    ),
  });
}
