import { createHmac } from "node:crypto";

import { NextResponse } from "next/server";

import { R2_BASE } from "@/lib/stream-url";
import { getVoiceCatalog } from "@/lib/voice/catalog";

// GET /api/mix/stems?ids=12,63,119 — where each song's stems are, for the
// Mixer only. Reply: { stems: { "63": "<base url>" | null, … } }.
//
// The worker (worker/src/stems.js) writes a song's stems under a folder named
// by an HMAC of its id with the shared worker secret, so a clean vocal can't be
// found by guessing. Only live songs are answered, and only once all four
// stems are in place (done.json).

export const runtime = "nodejs";

const token = (secret: string, id: number) =>
  createHmac("sha256", secret).update(`aired-stems:${id}`).digest("hex").slice(0, 32);

const ready = new Map<number, { at: number; ok: boolean }>();
const TTL_OK = 6 * 60 * 60_000;
const TTL_MISS = 5 * 60_000;

export async function GET(req: Request) {
  const secret = process.env.TRANSCODE_SHARED_SECRET;
  const url = new URL(req.url);
  const ids = [
    ...new Set(
      (url.searchParams.get("ids") ?? "")
        .split(",")
        .map((x) => Number(x))
        .filter((x) => Number.isInteger(x) && x > 0),
    ),
  ].slice(0, 12);
  const out: Record<string, string | null> = {};
  if (!secret || !R2_BASE || ids.length === 0) return NextResponse.json({ stems: out });

  const live = new Set((await getVoiceCatalog().catch(() => [])).map((s) => s.id));
  await Promise.all(
    ids.map(async (id) => {
      out[id] = null;
      if (!live.has(id)) return;
      const base = `${R2_BASE}/work/${id}/stems/${token(secret, id)}`;
      const hit = ready.get(id);
      let ok = hit && Date.now() - hit.at < (hit.ok ? TTL_OK : TTL_MISS) ? hit.ok : null;
      if (ok === null) {
        ok = await fetch(`${base}/done.json`, { method: "HEAD", cache: "no-store" })
          .then((r) => r.ok)
          .catch(() => false);
        ready.set(id, { at: Date.now(), ok });
      }
      if (ok) out[id] = base;
    }),
  );
  return NextResponse.json({ stems: out }, { headers: { "cache-control": "no-store" } });
}
