// Fetch just the part of a song the mix needs, straight from the public HLS
// bucket (CLAUDE.md Rule 6 — audio only ever comes from R2), and decode it.
//
// Only the segments that cover [0, seconds) are fetched, so a 12-minute track
// (Rule 4 — no length cap) costs no more to mix than a 3-minute one, and two
// decks fit comfortably in a phone's memory.

import { buildStreamUrl } from "@/lib/stream-url";

import { demuxAdts } from "./ts-demux";

export const MIX_SAMPLE_RATE = 44100;

type Segment = { url: string; duration: number };

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, { signal, mode: "cors" });
  if (!res.ok) throw new Error(`Couldn't read the playlist (HTTP ${res.status}).`);
  return res.text();
}

function parseMedia(text: string, base: string): { segments: Segment[]; variant: string | null } {
  const segments: Segment[] = [];
  let pending = 6;
  let variant: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF:")) {
      const d = parseFloat(line.slice(8));
      pending = Number.isFinite(d) && d > 0 ? d : 6;
      continue;
    }
    if (line.startsWith("#")) continue;
    const abs = new URL(line, base).toString();
    if (/\.m3u8($|\?)/i.test(line)) {
      variant ??= abs;
      continue;
    }
    segments.push({ url: abs, duration: pending });
  }
  return { segments, variant };
}

export type LoadedDeck = {
  buffer: AudioBuffer;
  // Seconds of real audio the buffer holds (may be less than asked for when the
  // song is shorter than the window).
  seconds: number;
};

export async function loadDeck(
  hlsPlaylistKey: string | null,
  seconds: number,
  opts: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<LoadedDeck> {
  const manifestUrl = buildStreamUrl(hlsPlaylistKey);
  if (!manifestUrl) throw new Error("This song isn't streaming yet.");

  let parsed = parseMedia(await fetchText(manifestUrl, opts.signal), manifestUrl);
  if (parsed.segments.length === 0 && parsed.variant) {
    const v = parsed.variant;
    parsed = parseMedia(await fetchText(v, opts.signal), v);
  }
  if (parsed.segments.length === 0) throw new Error("This song has no audio yet.");

  const wanted: Segment[] = [];
  let covered = 0;
  for (const seg of parsed.segments) {
    if (covered >= seconds) break;
    wanted.push(seg);
    covered += seg.duration;
  }

  // Fetch a few at a time; keep the order for the join.
  const parts: Uint8Array[] = new Array(wanted.length);
  let done = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < wanted.length) {
      const i = cursor++;
      const res = await fetch(wanted[i].url, { signal: opts.signal, mode: "cors" });
      if (!res.ok) throw new Error(`Couldn't fetch the audio (HTTP ${res.status}).`);
      parts[i] = demuxAdts(new Uint8Array(await res.arrayBuffer()));
      done++;
      opts.onProgress?.(done / wanted.length);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);

  const total = parts.reduce((n, p) => n + p.length, 0);
  if (total === 0) throw new Error("Couldn't read the audio in this song.");
  const adts = new Uint8Array(total);
  let w = 0;
  for (const p of parts) {
    adts.set(p, w);
    w += p.length;
  }

  const ctx = new OfflineAudioContext(2, MIX_SAMPLE_RATE, MIX_SAMPLE_RATE);
  const buffer = await ctx.decodeAudioData(adts.buffer);
  return { buffer, seconds: Math.min(buffer.duration, seconds) };
}
