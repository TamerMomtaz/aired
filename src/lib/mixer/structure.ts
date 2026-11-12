// Read a song's structure off its beat grid: where the bars and the 8-bar
// phrases fall, and how hard each phrase hits. This is what lets the Mixer cut
// between songs on PHRASE lines, the way a DJ does, instead of at an arbitrary
// second.
//
// - Downbeat: of the four beat positions in a bar, beat 1 is where the kick and
//   bass land hardest on average.
// - Phrase line: of the eight bar positions in a phrase, the phrase boundary is
//   where the song's loudness changes most (a verse ending, a chorus landing).

import type { Tempo } from "./tempo";

export type Phrase = {
  // Source seconds where this 8-bar phrase starts.
  start: number;
  // Mean loudness of the phrase (linear RMS). Used to shape the energy arc and
  // to balance levels between songs.
  rms: number;
};

export type Structure = {
  beat: number; // seconds per beat
  bar: number; // seconds per bar
  phrases: Phrase[];
};

const BARS_PER_PHRASE = 8;

export function analyzeStructure(buf: AudioBuffer, tempo: Tempo): Structure {
  const sr = buf.sampleRate;
  const beat = 60 / tempo.bpm;
  const bar = beat * 4;
  const l = buf.getChannelData(0);
  const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;

  // Per-beat loudness, full band and low band (one-pole low-pass ~150 Hz).
  const nBeats = Math.floor((buf.duration - tempo.firstBeat) / beat);
  const full = new Float64Array(Math.max(0, nBeats));
  const low = new Float64Array(Math.max(0, nBeats));
  const a = Math.exp((-2 * Math.PI * 150) / sr);
  for (let b = 0; b < nBeats; b++) {
    const s0 = Math.floor((tempo.firstBeat + b * beat) * sr);
    const s1 = Math.min(l.length, Math.floor((tempo.firstBeat + (b + 1) * beat) * sr));
    const head = s0 + Math.floor((s1 - s0) / 4);
    let ef = 0;
    let el = 0;
    let lp = 0;
    for (let i = s0; i < s1; i += 2) {
      const x = (l[i] + r[i]) * 0.5;
      ef += x * x;
      lp = (1 - a) * x + a * lp;
      if (i < head) el += lp * lp;
    }
    full[b] = Math.sqrt(ef / Math.max(1, (s1 - s0) / 2));
    low[b] = el;
  }

  // Downbeat: the beat position (0..3) with the strongest low end on average.
  let down = 0;
  let downScore = -1;
  for (let d = 0; d < 4; d++) {
    let s = 0;
    let n = 0;
    for (let b = d; b < nBeats; b += 4) {
      s += low[b];
      n++;
    }
    const m = n ? s / n : 0;
    if (m > downScore) {
      downScore = m;
      down = d;
    }
  }

  const firstBar = tempo.firstBeat + down * beat;
  const nBars = Math.floor((nBeats - down) / 4);
  const barE = new Float64Array(Math.max(0, nBars));
  for (let j = 0; j < nBars; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += full[down + j * 4 + k];
    barE[j] = s / 4;
  }

  // Phrase line: the bar offset (0..7) where loudness jumps most, phrase to phrase.
  let off = 0;
  let offScore = -1;
  for (let o = 0; o < BARS_PER_PHRASE; o++) {
    let s = 0;
    for (let j = o; j < nBars; j += BARS_PER_PHRASE) {
      if (j < 1) continue;
      s += Math.abs(Math.log((barE[j] + 1e-6) / (barE[j - 1] + 1e-6)));
    }
    if (s > offScore) {
      offScore = s;
      off = o;
    }
  }

  const phrases: Phrase[] = [];
  // A short pickup before the first full phrase becomes its own "phrase 0" so
  // an intro is never thrown away.
  if (off > 0) phrases.push({ start: Math.max(0, firstBar + (off - BARS_PER_PHRASE) * bar), rms: 0 });
  for (let j = off; j + BARS_PER_PHRASE <= nBars; j += BARS_PER_PHRASE) {
    phrases.push({ start: firstBar + j * bar, rms: 0 });
  }
  for (const p of phrases) {
    const j0 = Math.max(0, Math.round((p.start - firstBar) / bar));
    let s = 0;
    let n = 0;
    for (let j = j0; j < Math.min(nBars, j0 + BARS_PER_PHRASE); j++) {
      s += barE[j];
      n++;
    }
    p.rms = n ? s / n : 0;
  }
  return { beat, bar, phrases };
}

// Fine-tune where a section starts. The tempo is measured on the first minute
// and extrapolated; deep into a long song a few milliseconds of drift add up,
// so each section re-finds its own downbeat within ±60 ms before it's used.
export function refineStart(buf: AudioBuffer, approx: number, beat: number): number {
  const sr = buf.sampleRate;
  const hop = 128;
  const span = 0.06;
  const beats = 8;
  const from = Math.max(0, Math.floor((approx - span - 0.02) * sr));
  const to = Math.min(buf.length, Math.floor((approx + beats * beat + span) * sr));
  if (to - from < hop * 16) return approx;
  const l = buf.getChannelData(0);
  const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
  const frames = Math.floor((to - from) / hop);
  const env = new Float32Array(frames);
  const a = Math.exp((-2 * Math.PI * 200) / sr);
  let lp = 0;
  let prev = 0;
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = 0; i < hop; i++) {
      const k = from + f * hop + i;
      const x = (l[k] + r[k]) * 0.5;
      lp = (1 - a) * x + a * lp;
      e += lp * lp;
    }
    const v = Math.log1p(e * 1000);
    env[f] = Math.max(0, v - prev);
    prev = v;
  }
  const fps = sr / hop;
  let best = 0;
  let bestScore = -1;
  const steps = Math.round(span * fps);
  for (let d = -steps; d <= steps; d++) {
    let s = 0;
    for (let k = 0; k < beats; k++) {
      const i = Math.round((approx - from / sr + k * beat) * fps) + d;
      s += env[i] ?? 0;
    }
    if (s > bestScore) {
      bestScore = s;
      best = d;
    }
  }
  return approx + best / fps;
}
