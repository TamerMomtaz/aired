import { NextResponse } from "next/server";

import { BRAIN_DEADLINE_MS, mixBrainEnabled, planWithBrain } from "@/lib/mixer/brain";
import { keyFromTonic } from "@/lib/mixer/key";
import type { Energy, MixMinutes, SongBrief } from "@/lib/mixer/script";
import type { PhraseLabel } from "@/lib/mixer/structure";
import { getVoiceCatalog } from "@/lib/voice/catalog";

// POST /api/mix/plan — ask the DJ brain for a set script.
//
// Body: { vibe?, energy, minutes, songs: [{ id, bpm, tonic, minor, keyConfidence,
//         duration, phrases: [{ start, label, energy, bass, vocal, lines }] }] }
// Reply: { ai: true, script } or { ai: false } (the browser then plans with its
//         built-in rules, so the Mixer always works).
//
// Titles, makers and descriptors are looked up here from the live catalog by
// id, so the brain only ever sees public song text. Nothing is stored.

export const runtime = "nodejs";
export const maxDuration = 60;

const WINDOW_MS = 60_000;
const LIMIT = 6;
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

const LABELS: PhraseLabel[] = ["intro", "breakdown", "build", "drop", "groove", "outro"];
const num = (x: unknown, lo: number, hi: number, d: number) =>
  typeof x === "number" && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d;

export async function POST(req: Request) {
  if (!mixBrainEnabled()) return NextResponse.json({ ai: false, reason: "off" });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allow(ip)) return NextResponse.json({ ai: false, reason: "busy" }, { status: 429 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ai: false }, { status: 400 });
  }
  const energy: Energy = body.energy === "lounge" || body.energy === "peak" ? body.energy : "club";
  const minutes: MixMinutes = body.minutes === 7 || body.minutes === 10 ? body.minutes : 5;
  const vibe = typeof body.vibe === "string" ? body.vibe.slice(0, 300) : "";
  const rawSongs = Array.isArray(body.songs) ? body.songs.slice(0, 6) : [];
  if (rawSongs.length < 1) return NextResponse.json({ ai: false }, { status: 400 });

  const catalog = await getVoiceCatalog();
  const byId = new Map(catalog.map((s) => [s.id, s]));
  const songs: SongBrief[] = [];
  for (const r of rawSongs as Record<string, unknown>[]) {
    const meta = byId.get(Number(r.id));
    if (!meta) return NextResponse.json({ ai: false }, { status: 400 });
    const phrases = (Array.isArray(r.phrases) ? r.phrases.slice(0, 80) : []).map(
      (p: Record<string, unknown>) => ({
        start: num(p.start, 0, 7200, 0),
        label: LABELS.includes(p.label as PhraseLabel) ? (p.label as PhraseLabel) : "groove",
        energy: Math.round(num(p.energy, 0, 9, 5)),
        bass: Math.round(num(p.bass, 0, 9, 5)),
        vocal: Math.round(num(p.vocal, 0, 9, 5)),
        lines: (Array.isArray(p.lines) ? p.lines.slice(0, 2) : [0]).map((b) => Math.round(num(b, 0, 7, 0))),
      }),
    );
    songs.push({
      title: meta.title,
      makers: meta.contributors.map((c) => c.name),
      descriptors: meta.descriptors.slice(0, 12),
      bpm: num(r.bpm, 40, 220, 120),
      key: keyFromTonic(Math.round(num(r.tonic, 0, 11, 0)), r.minor === true, num(r.keyConfidence, 0, 1, 0.5)),
      duration: num(r.duration, 1, 7200, 180),
      phrases,
      plays: Math.round(num(r.plays, 1, 3, 1)),
      stems: r.stems === true,
    });
  }

  // One line per plan, with no song or vibe text, so the logs show whether the
  // brain is answering and how fast.
  const started = Date.now();
  const log = (outcome: string) =>
    console.log(
      `mix-plan ${outcome} in ${Date.now() - started}ms · ${songs.length} song(s) · ${energy} · ${minutes} min · vibe ${vibe ? "yes" : "no"}`,
    );
  try {
    const script = await planWithBrain({ songs, energy, minutes, vibe });
    if (!script) {
      log("unreadable");
      return NextResponse.json({ ai: false, reason: "error" });
    }
    log(`ok ${script.visits.length} parts`);
    return NextResponse.json({ ai: true, script });
  } catch (e) {
    const slow = Date.now() - started >= BRAIN_DEADLINE_MS - 500;
    log(slow ? "too slow" : `failed (${e instanceof Error ? e.name : "error"})`);
    return NextResponse.json({ ai: false, reason: slow ? "slow" : "error" });
  }
}
