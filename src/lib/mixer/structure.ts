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
  // Share of the energy in the low end (kick + bass) and in the top (hats,
  // air, sibilance). A breakdown has little low end; a drop has a lot.
  low: number;
  high: number;
  // What the phrase is doing in the song, read from the numbers above.
  label: PhraseLabel;
};

export type PhraseLabel = "intro" | "breakdown" | "build" | "drop" | "groove" | "outro";

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
  const lowAll = new Float64Array(Math.max(0, nBeats));
  const highAll = new Float64Array(Math.max(0, nBeats));
  const a = Math.exp((-2 * Math.PI * 150) / sr);
  const ah = Math.exp((-2 * Math.PI * 4000) / sr);
  for (let b = 0; b < nBeats; b++) {
    const s0 = Math.floor((tempo.firstBeat + b * beat) * sr);
    const s1 = Math.min(l.length, Math.floor((tempo.firstBeat + (b + 1) * beat) * sr));
    const head = s0 + Math.floor((s1 - s0) / 4);
    let ef = 0;
    let el = 0;
    let ela = 0;
    let eh = 0;
    let lp = 0;
    let lph = 0;
    for (let i = s0; i < s1; i++) {
      const x = (l[i] + r[i]) * 0.5;
      lp = (1 - a) * x + a * lp;
      lph = (1 - ah) * x + ah * lph;
      if (i & 1) continue;
      ef += x * x;
      ela += lp * lp;
      eh += (x - lph) * (x - lph);
      if (i < head) el += lp * lp;
    }
    full[b] = Math.sqrt(ef / Math.max(1, (s1 - s0) / 2));
    low[b] = el;
    lowAll[b] = ela / (ef || 1);
    highAll[b] = eh / (ef || 1);
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
  const blank = { rms: 0, low: 0, high: 0, label: "groove" as PhraseLabel };
  if (off > 0) phrases.push({ start: Math.max(0, firstBar + (off - BARS_PER_PHRASE) * bar), ...blank });
  for (let j = off; j + BARS_PER_PHRASE <= nBars; j += BARS_PER_PHRASE) {
    phrases.push({ start: firstBar + j * bar, ...blank });
  }
  for (const p of phrases) {
    const j0 = Math.max(0, Math.round((p.start - firstBar) / bar));
    let s = 0;
    let lo = 0;
    let hi = 0;
    let n = 0;
    for (let j = j0; j < Math.min(nBars, j0 + BARS_PER_PHRASE); j++) {
      s += barE[j];
      for (let k = 0; k < 4; k++) {
        lo += lowAll[down + j * 4 + k];
        hi += highAll[down + j * 4 + k];
      }
      n++;
    }
    p.rms = n ? s / n : 0;
    p.low = n ? lo / (n * 4) : 0;
    p.high = n ? hi / (n * 4) : 0;
  }
  labelPhrases(phrases);
  return { beat, bar, phrases };
}

// Name each phrase's job from its loudness and low end relative to the song.
function labelPhrases(ph: Phrase[]) {
  if (ph.length === 0) return;
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] || 1e-9;
  };
  const mr = med(ph.map((p) => p.rms));
  const ml = med(ph.map((p) => p.low));
  ph.forEach((p, i) => {
    const loud = p.rms / mr;
    const bass = p.low / ml;
    const next = ph[i + 1];
    if (i === 0 && loud < 1) p.label = "intro";
    else if (i === ph.length - 1 && loud < 0.95) p.label = "outro";
    else if (loud < 0.75 || bass < 0.6) p.label = "breakdown";
    else if (loud >= 1.08 && bass >= 0.9) p.label = "drop";
    else if (next && next.rms / mr >= 1.08 && loud < next.rms / mr) p.label = "build";
    else p.label = "groove";
  });
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
