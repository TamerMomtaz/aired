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
  // The compressed audio itself (~1.4 MB a minute), kept so any part of the
  // song can be decoded again later without holding the whole song as PCM
  // (~10 MB a minute) or fetching it twice.
  adts: AdtsIndex;
};

// Byte offsets of every AAC frame in an ADTS stream. Each frame is 1024
// samples at the stream's own sample rate.
export type AdtsIndex = { bytes: Uint8Array; frames: Uint32Array; sampleRate: number };

const ADTS_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

export function indexAdts(bytes: Uint8Array): AdtsIndex {
  const offs: number[] = [];
  let sampleRate = 44100;
  let i = 0;
  while (i + 7 <= bytes.length) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xf6) !== 0xf0) {
      i++;
      continue;
    }
    const len = ((bytes[i + 3] & 0x03) << 11) | (bytes[i + 4] << 3) | (bytes[i + 5] >> 5);
    if (len < 7) {
      i++;
      continue;
    }
    if (offs.length === 0) sampleRate = ADTS_RATES[(bytes[i + 2] >> 2) & 0x0f] ?? 44100;
    offs.push(i);
    i += len;
  }
  return { bytes, frames: Uint32Array.from(offs), sampleRate };
}

// Decode [from, from + seconds) of a song from its compressed frames. Returns
// the buffer and where `from` landed inside it (a little audio is decoded
// before it so the decoder is warmed up and nothing clicks at the start).
export async function decodeRange(
  idx: AdtsIndex,
  from: number,
  seconds: number,
): Promise<{ buffer: AudioBuffer; lead: number } | null> {
  const fd = 1024 / idx.sampleRate;
  const WARM = 4; // frames decoded before the range and kept as lead-in
  const want0 = Math.floor(Math.max(0, from) / fd);
  const f0 = Math.max(0, want0 - WARM);
  const f1 = Math.min(idx.frames.length, Math.ceil((from + seconds) / fd) + 2);
  if (f1 <= f0) return null;
  const start = idx.frames[f0];
  const end = f1 < idx.frames.length ? idx.frames[f1] : idx.bytes.length;
  const slice = idx.bytes.slice(start, end);
  const ctx = new OfflineAudioContext(2, MIX_SAMPLE_RATE, MIX_SAMPLE_RATE);
  const buffer = await ctx.decodeAudioData(slice.buffer);
  return { buffer, lead: from - f0 * fd };
}

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

  const index = indexAdts(adts);
  const ctx = new OfflineAudioContext(2, MIX_SAMPLE_RATE, MIX_SAMPLE_RATE);
  // decodeAudioData detaches what it's given, so it gets a copy.
  const buffer = await ctx.decodeAudioData(adts.slice().buffer);
  return { buffer, seconds: Math.min(buffer.duration, seconds), adts: index };
}

// ---- stems --------------------------------------------------------------
// A song split into vocals, drums, bass and the rest by the worker (worker/
// src/stems.js). Each stem is its own HLS rendition on the same timeline as
// the song, so only the stretches a mix actually uses are fetched.

export const STEM_NAMES = ["vocals", "drums", "bass", "other"] as const;
export type StemName = (typeof STEM_NAMES)[number];

type StemPlaylist = { segments: (Segment & { t0: number })[] };
export type StemSource = {
  playlists: Record<StemName, StemPlaylist>;
  cache: Map<string, Uint8Array>;
  // Samples the stems sit late (+) or early (−) against the song, measured on
  // first use (an encoder's start-up delay can differ by a frame).
  lag?: number;
};

export async function loadStemSource(base: string, signal?: AbortSignal): Promise<StemSource | null> {
  try {
    const entries = await Promise.all(
      STEM_NAMES.map(async (name) => {
        const url = `${base}/${name}/playlist.m3u8`;
        const { segments } = parseMedia(await fetchText(url, signal), url);
        let t = 0;
        const timed = segments.map((s) => {
          const x = { ...s, t0: t };
          t += s.duration;
          return x;
        });
        return [name, { segments: timed }] as const;
      }),
    );
    if (entries.some(([, p]) => p.segments.length === 0)) return null;
    return { playlists: Object.fromEntries(entries) as Record<StemName, StemPlaylist>, cache: new Map() };
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    return null;
  }
}

// Decode [from, from + seconds) of one stem, fetching only the segments that
// cover it (plus one before, to warm the decoder). Same return as decodeRange.
export async function decodeStemRange(
  src: StemSource,
  stem: StemName,
  from: number,
  seconds: number,
  signal?: AbortSignal,
): Promise<{ buffer: AudioBuffer; lead: number } | null> {
  const segs = src.playlists[stem].segments;
  const a = Math.max(0, from - 0.5);
  const b = from + seconds;
  let i0 = segs.findIndex((s) => s.t0 + s.duration > a);
  if (i0 < 0) return null;
  let i1 = i0;
  while (i1 + 1 < segs.length && segs[i1 + 1].t0 < b) i1++;
  i0 = Math.max(0, i0);
  const parts: Uint8Array[] = [];
  for (let i = i0; i <= i1; i++) {
    const url = segs[i].url;
    let bytes = src.cache.get(url);
    if (!bytes) {
      const res = await fetch(url, { signal, mode: "cors" });
      if (!res.ok) throw new Error(`Couldn't fetch a stem (HTTP ${res.status}).`);
      bytes = demuxAdts(new Uint8Array(await res.arrayBuffer()));
      src.cache.set(url, bytes);
    }
    parts.push(bytes);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const adts = new Uint8Array(total);
  let w = 0;
  for (const p of parts) {
    adts.set(p, w);
    w += p.length;
  }
  const idx = indexAdts(adts);
  const t0 = segs[i0].t0;
  return decodeRange(idx, from - t0, seconds);
}
