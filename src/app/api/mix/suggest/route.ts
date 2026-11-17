import { NextResponse } from "next/server";

import { feelingById } from "@/lib/mixer/feelings";
import { rulesPick, teejayEnabled, teejayPick } from "@/lib/mixer/suggest";
import { getVoiceCatalog } from "@/lib/voice/catalog";

// POST /api/mix/suggest — TeeJay picks a set for a feeling.
//
// Body: { feeling: "dance" | "romance" | "hype" | "wahda", avoid?: number[] }
// (GET ?feeling= works too.)
// Reply: { suggestion: { ids, mood, minutes, title, why, by } } or { error }.
//
// Reads only the public live catalog (lib/voice/catalog). Nothing is stored.

export const runtime = "nodejs";
export const maxDuration = 45;

const WINDOW_MS = 60_000;
const LIMIT = 10;
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

export async function POST(req: Request) {
  let body: { feeling?: unknown; avoid?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  return suggest(req, body);
}

// GET /api/mix/suggest?feeling=dance — the same, for a shareable link or a quick check.
export async function GET(req: Request) {
  const url = new URL(req.url);
  return suggest(req, { feeling: url.searchParams.get("feeling") });
}

async function suggest(req: Request, body: { feeling?: unknown; avoid?: unknown }) {
  const feeling = feelingById(body.feeling);
  if (!feeling) return NextResponse.json({ error: "unknown feeling" }, { status: 400 });
  const avoid = Array.isArray(body.avoid)
    ? body.avoid.filter((x): x is number => typeof x === "number" && Number.isInteger(x)).slice(0, 30)
    : [];

  let songs;
  try {
    songs = (await getVoiceCatalog()).filter((s) => s.hlsPlaylistKey);
  } catch (err) {
    console.warn("mix-suggest catalog", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "catalog unavailable" }, { status: 503 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const t0 = Date.now();
  if (teejayEnabled() && allow(ip)) {
    try {
      const suggestion = await teejayPick(feeling, songs, avoid);
      if (suggestion) {
        console.log(`mix-suggest ok ${feeling.id} ${suggestion.ids.length} songs in ${Date.now() - t0}ms`);
        return NextResponse.json({ suggestion });
      }
      console.log(`mix-suggest empty ${feeling.id} in ${Date.now() - t0}ms`);
    } catch (err) {
      console.warn(`mix-suggest error ${feeling.id} in ${Date.now() - t0}ms`, err instanceof Error ? err.message : err);
    }
  }
  const suggestion = rulesPick(feeling, songs, avoid);
  if (!suggestion) return NextResponse.json({ error: "not enough songs" }, { status: 404 });
  return NextResponse.json({ suggestion });
}
