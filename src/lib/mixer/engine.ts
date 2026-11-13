// The AIRED Mixer engine: plays a SET SCRIPT (script.ts) as one long club mix.
//
// The script, written by the DJ brain or the built-in planner, says which part
// of which song plays when, for how long, how it comes in, and what is added
// on top. This file turns that into sound:
//
//   prepareSongs — decode ONLY the parts the script uses, from each song's
//                  compressed audio, each re-aligned on its own downbeat;
//   planTimes    — lay the parts end to end on the master bar grid;
//   renderSet    — play them through per-part filters, with the moves between
//                  parts and the additions:
//        blend    — the next part creeps in bass-cut (2, 4 or 8 bars by
//                   energy); on the "one"
//                   the basses swap and the old part is filtered away;
//        mash-up  — for 4 bars the old part keeps only its beat and bass under
//                   the new part's top;
//        trade    — call and response: the songs swap every 1–2 bars for 8;
//        lines    — 1–4 bar lines lifted from another song, laid on top in
//                   the voice range (lifted, chopped or thrown into echo);
//        cut      — echo throw out, slam in (always for a song whose tempo
//                   can't lock, and after a loop build);
//        loop build, breakdown, filter rise, riser, drop, kick, hats, claps,
//        and sidechain pump, wherever the script asks for them.
//
// It all renders in an OfflineAudioContext: faster than real time, and never a
// second live audio element beside the global player (the one-<audio>
// invariant in player-provider stays untouched).

import {
  decodeRange,
  decodeStemRange,
  MIX_SAMPLE_RATE,
  STEM_NAMES,
  type AdtsIndex,
  type StemName,
  type StemSource,
} from "./load";
import { camelotDistance, type MusicalKey } from "./key";
import { applyGrains, KEY_LOCK_MIN, stretchWithGrains } from "./stretch";
import {
  barSeconds,
  chooseRate,
  POST_BARS,
  STYLE,
  type Energy,
  type Fx,
  type Layer,
  type Move,
  type SetScript,
} from "./script";
import { classicMood, type Groove, type Mood } from "./moods";
import { refineStart, type Structure } from "./structure";
import type { Tempo } from "./tempo";

export type { Energy, MixMinutes, Move } from "./script";

export const MIN_TRACKS = 1; // one song = a remix of it
export const MAX_TRACKS = 6;
export const MAX_REPEATS = 3; // times one song may be added to a set
// How much of each song to read. A long song (no length cap, CLAUDE.md Rule 4)
// is still fully usable; the Mixer picks its parts from the first 8 minutes,
// which keeps a phone's memory in bounds.
export const LOAD_SECONDS = 480;

const PRE_BARS = 8; // audio kept before a part, for blends (8 bars at Lounge)
const TAIL_SECONDS = 8;
const SEAM = 0.006; // half the crossfade where a song flows on into its next part

// What the Mixer keeps of a song after its first listen: the analysis and the
// compressed audio. The decoded PCM is let go straight away.
export type SongAnalysis = {
  title: string;
  tempo: Tempo;
  structure: Structure;
  key: MusicalKey;
  duration: number;
  adts: AdtsIndex;
  // The song split into vocals / drums / bass / the rest, when the worker has
  // done it. With stems the Mixer mixes like a DJ on stems: one bassline at a
  // time, beats under voices, clean acapellas on top.
  stems?: StemSource | null;
};

// A stretch of a part played from its stems instead of the whole song. c0 and
// c1 are clip seconds; every buffer starts at c0.
export type StemWindow = { c0: number; c1: number; bufs: Record<StemName, AudioBuffer> };

export type Part = {
  clip: AudioBuffer;
  start: number;
  rms: number;
  // Where the clip came from, so its stems can be cut to match it exactly:
  // the source second at clip input sample 0, and the key-lock grains.
  src0: number;
  grains: Int32Array;
  windows: StemWindow[];
  // A line's clean voice, from the vocal stem (lines only).
  voice?: AudioBuffer | null;
};

export type PreparedSong = {
  title: string;
  rate: number;
  // How fast its clips play back. With key lock the clips are already
  // stretched to the set's tempo, so this is 1 and the pitch never moves.
  playRate: number;
  synced: boolean;
  bpm: number;
  key: MusicalKey; // key lock: the song keeps its own key
  parts: Map<string, Part>; // "phrase:bars" → decoded audio
  lines: Map<string, Part>; // "phrase:bar:len" → a lifted line
};

export type PlannedVisit = {
  song: number;
  phrase: number;
  skip?: number;
  bars: number;
  at: number; // output seconds
  dur: number;
  move: Move;
  fx: Fx;
  layers: Layer[];
  note?: string;
  sourceStart: number;
};

export type MixPlan = {
  bpm: number;
  title: string;
  story: string;
  by: "brain" | "rules";
  visits: PlannedVisit[];
  end: number;
  songs: { title: string; bpm: number; rate: number; synced: boolean; key: MusicalKey }[];
};

const partKey = (phrase: number, bars: number, skip = 0) => `${phrase}:${bars}:${skip}`;
const lineKey = (l: Pick<Layer, "phrase" | "bar" | "len">) => `${l.phrase}:${l.bar}:${l.len}`;

// The set's tempo: fixScript stores it; older scripts fall back to the opener.
const setBpm = (songs: SongAnalysis[], script: SetScript) => script.bpm ?? songs[script.visits[0].song].tempo.bpm;

// How loud a stretch of a clip sounds, close to how loudness meters (LUFS)
// hear it: the sub-bass under ~60 Hz, which the ear barely registers, is left
// out. Used to level parts and lines against each other from the real audio.
function loudness(clip: AudioBuffer, from: number, to: number): number {
  const sr = clip.sampleRate;
  const a = Math.max(0, Math.floor(from * sr));
  const b = Math.min(clip.length, Math.floor(to * sr));
  const k = Math.exp((-2 * Math.PI * 60) / sr);
  let upper = 0;
  let n = 0;
  for (let c = 0; c < clip.numberOfChannels; c++) {
    const d = clip.getChannelData(c);
    let lp = 0;
    for (let i = a; i < b; i++) {
      const x = d[i];
      lp = (1 - k) * x + k * lp;
      if (i & 3) continue;
      upper += (x - lp) * (x - lp);
      n++;
    }
  }
  if (!n) return 1e-4;
  return Math.max(1e-4, Math.sqrt(upper / n));
}

// Decode `len` source seconds starting `pre` before `at`, and copy it into a
// clip whose `pre` mark is exactly the downbeat nearest `at`.
async function cutClip(
  s: SongAnalysis,
  at: number,
  pre: number,
  len: number,
): Promise<{ clip: AudioBuffer; src0: number } | null> {
  const from = at - pre;
  const dec = await decodeRange(s.adts, Math.max(0, from), len + Math.min(0, from));
  if (!dec) return null;
  const approx = dec.lead + (at - Math.max(0, from));
  const exact = refineStart(dec.buffer, approx, s.structure.beat);
  const sr = dec.buffer.sampleRate;
  const frames = Math.ceil(len * sr);
  const clip = new AudioBuffer({ numberOfChannels: 2, length: frames, sampleRate: sr });
  const shift = Math.round((exact - pre) * sr);
  for (let c = 0; c < 2; c++) {
    const src = dec.buffer.getChannelData(Math.min(c, dec.buffer.numberOfChannels - 1));
    const dst = clip.getChannelData(c);
    const a = Math.max(0, shift);
    const b = Math.min(src.length, shift + frames);
    if (b > a) dst.set(src.subarray(a, b), a - shift);
  }
  return { clip, src0: Math.max(0, from) - dec.lead + shift / sr };
}

export async function prepareSongs(
  songs: SongAnalysis[],
  script: SetScript,
  onProgress?: (fraction: number) => void,
): Promise<PreparedSong[]> {
  const master = setBpm(songs, script);
  const mBar = barSeconds(master);
  const out: PreparedSong[] = songs.map((s) => {
    const { rate, synced } = chooseRate(master, s.tempo.bpm);
    return {
      title: s.title,
      rate,
      playRate: rate,
      synced,
      bpm: s.tempo.bpm,
      key: s.key,
      parts: new Map(),
      lines: new Map(),
    };
  });
  const jobs = [...new Map(script.visits.map((v) => [`${v.song}:${partKey(v.phrase, v.bars, v.skip)}`, v])).values()];
  const lineJobs = [
    ...new Map(
      script.visits.flatMap((v) => v.layers ?? []).map((l) => [`${l.song}:${lineKey(l)}`, l]),
    ).values(),
  ];
  const all = jobs.length + lineJobs.length;
  let done = 0;
  for (const v of jobs) {
    const s = songs[v.song];
    const p = out[v.song];
    const srcBar = mBar * p.rate;
    const ph = s.structure.phrases[v.phrase];
    const pre = PRE_BARS * srcBar;
    const raw = await cutClip(s, ph.start + (v.skip ?? 0) * srcBar, pre, (PRE_BARS + v.bars + POST_BARS) * srcBar);
    if (!raw) continue;
    const { clip, scale, grains } = lockKey(raw.clip, p.rate);
    p.parts.set(partKey(v.phrase, v.bars, v.skip), {
      clip,
      start: pre * scale,
      rms: loudness(clip, pre * scale, (pre + v.bars * srcBar) * scale),
      src0: raw.src0,
      grains,
      windows: [],
    });
    await tick();
    onProgress?.(++done / all);
  }
  for (const l of lineJobs) {
    const s = songs[l.song];
    const p = out[l.song];
    const srcBar = mBar * p.rate;
    const ph = s.structure.phrases[l.phrase];
    if (!ph) continue;
    const pre = srcBar / 8;
    const raw = await cutClip(s, ph.start + l.bar * srcBar, pre, (l.len + 1) * srcBar + pre);
    if (!raw) continue;
    const { clip, scale, grains } = lockKey(raw.clip, p.rate);
    const line: Part = {
      clip,
      start: pre * scale,
      rms: loudness(clip, pre * scale, (pre + l.len * srcBar) * scale),
      src0: raw.src0,
      grains,
      windows: [],
    };
    // With stems, a lifted line is the singer alone: no second beat or
    // bassline sneaking in under the song that's playing.
    if (s.stems) {
      const w = await stemWindow(s.stems, line, 0, clip.duration, s.stems.lag === undefined ? STEM_NAMES : ["vocals"]).catch(() => null);
      if (w) {
        line.voice = w.bufs.vocals;
        line.rms = loudness(w.bufs.vocals, line.start, line.start + l.len * srcBar * scale);
      }
    }
    p.lines.set(lineKey(l), line);
    onProgress?.(++done / all);
  }
  for (const p of out) if (Math.abs(p.rate - 1) > KEY_LOCK_MIN) p.playRate = 1;
  return out;
}

// Key lock: stretch a clip to the set's tempo without moving its pitch.
// `scale` turns a time in the source into a time in the returned clip.
function lockKey(clip: AudioBuffer, rate: number): { clip: AudioBuffer; scale: number; grains: Int32Array } {
  if (Math.abs(rate - 1) <= KEY_LOCK_MIN) return { clip, scale: 1, grains: identityGrains(clip.length) };
  const { out, grains } = stretchWithGrains(clip, rate);
  return { clip: out, scale: 1 / rate, grains };
}

// Grains that copy the clip as it is (no key lock needed): the stems still go
// through applyGrains, so one code path serves both.
function identityGrains(length: number): Int32Array {
  const g = new Int32Array(Math.ceil(length / 1024) + 1);
  for (let k = 0; k < g.length; k++) g[k] = k * 1024;
  return g;
}

// Cut the stems for clip seconds [c0, c1) of a part, stretched with the part's
// own grains so they line up with it sample for sample.
async function stemWindow(
  src: StemSource,
  part: Part,
  c0: number,
  c1: number,
  names: readonly StemName[] = STEM_NAMES,
): Promise<StemWindow | null> {
  const sr = part.clip.sampleRate;
  const o0 = Math.max(0, Math.floor(c0 * sr));
  const o1 = Math.min(part.clip.length, Math.ceil(c1 * sr));
  if (o1 - o0 < sr * 0.05) return null;
  const k0 = Math.max(0, Math.floor(o0 / 1024) - 2);
  const k1 = Math.min(part.grains.length - 1, Math.ceil(o1 / 1024) + 1);
  let ia = Infinity;
  let ib = -Infinity;
  for (let k = k0; k <= k1; k++) {
    ia = Math.min(ia, part.grains[k]);
    ib = Math.max(ib, part.grains[k] + 2048);
  }
  if (!Number.isFinite(ia)) return null;
  const from = part.src0 + ia / sr;
  const seconds = (ib - ia) / sr;
  const decoded = {} as Record<StemName, { buffer: AudioBuffer; inOffset: number }>;
  for (const name of STEM_NAMES) {
    if (!names.includes(name)) continue;
    const dec = await decodeStemRange(src, name, Math.max(0, from), seconds);
    if (!dec) return null;
    // Input sample of the decoded buffer's first sample.
    decoded[name] = { buffer: dec.buffer, inOffset: Math.round((Math.max(0, from) - dec.lead - part.src0) * sr) };
  }
  const build = (lag: number) => {
    const bufs = {} as Record<StemName, AudioBuffer>;
    for (const name of names) {
      const d = decoded[name];
      bufs[name] = applyGrains(d.buffer, d.inOffset - lag, part.grains, o0, o1);
    }
    return bufs;
  };
  if (src.lag === undefined && names.length === STEM_NAMES.length) {
    // First use: find how far the stems sit from the song, once per song.
    src.lag = 0;
    const found = measureLag(build(0), part.clip, o0);
    if (found !== null) src.lag = found;
  }
  return { c0: o0 / sr, c1: o1 / sr, bufs: build(src.lag ?? 0) };
}

// How many samples the summed stems sit late against the clip (positive =
// late), searched within ±2048 over two seconds in the middle of the window.
// Null when the match is too weak to trust.
function measureLag(bufs: Record<StemName, AudioBuffer>, clip: AudioBuffer, o0: number): number | null {
  const n = bufs.vocals.length;
  const sr = clip.sampleRate;
  const len = Math.min(n - 4200, 2 * sr);
  if (len < sr / 2) return null;
  const a = Math.floor((n - len) / 2);
  const sum = new Float32Array(len);
  for (const k of STEM_NAMES) {
    const d = bufs[k].getChannelData(0);
    for (let i = 0; i < len; i++) sum[i] += d[a + i];
  }
  const mix = clip.getChannelData(0);
  let best = -1;
  let lag = 0;
  const STEP = 3;
  for (let L = -2048; L <= 2048; L++) {
    let xy = 0;
    let xx = 0;
    let yy = 0;
    for (let i = 0; i < len; i += STEP) {
      const j = o0 + a + i - L;
      const y = j >= 0 && j < mix.length ? mix[j] : 0;
      const x = sum[i];
      xy += x * y;
      xx += x * x;
      yy += y * y;
    }
    const c = xy / Math.sqrt(xx * yy + 1e-12);
    if (c > best) {
      best = c;
      lag = L;
    }
  }
  return best > 0.5 ? lag : null;
}

// The stretches of each part the moves want on stems: the blend or mash-up in
// and out, a breakdown, a line laid on top. Decoded after the plan is timed and
// before the render, only for songs that have stems.
export async function prepareStems(
  songs: SongAnalysis[],
  prepared: PreparedSong[],
  plan: MixPlan,
  energy: Energy,
  onProgress?: (fraction: number) => void,
): Promise<number> {
  const bar = barSeconds(plan.bpm);
  const beat = bar / 4;
  const st = STYLE[energy];
  const mashBars = energy === "lounge" ? 8 : 4;
  const wanted: { v: PlannedVisit; ranges: [number, number][] }[] = [];
  plan.visits.forEach((v, idx) => {
    if (!songs[v.song].stems) return;
    const T = v.at;
    const Tend = T + v.dur;
    const next = plan.visits[idx + 1];
    const prev = plan.visits[idx - 1];
    const ranges: [number, number][] = [];
    const clash =
      !!prev && prev.song !== v.song && camelotDistance(prepared[prev.song].key, prepared[v.song].key) >= 3;
    if (v.move === "blend") ranges.push([T - (clash ? 2 : st.blendBars) * bar - 0.05, T + bar]);
    if (v.move === "mashup") ranges.push([T - 0.05, T + mashBars * bar + beat]);
    if (v.fx.breakdown) ranges.push([T, (v.fx.loopBuild ? Tend - 4 * bar : Tend) - 0.02]);
    for (const l of v.layers) ranges.push([T + l.at * bar - 0.1, T + (l.at + l.len * l.times) * bar + 0.1]);
    if (next?.move === "blend") ranges.push([Tend - bar, Tend + (energy === "lounge" ? 4 : 1) * bar + 0.05]);
    if (next?.move === "mashup") ranges.push([Tend - beat, Tend + mashBars * bar + 0.05]);
    if (ranges.length) wanted.push({ v, ranges });
  });
  let done = 0;
  let made = 0;
  for (const { v, ranges } of wanted) {
    const part = prepared[v.song].parts.get(partKey(v.phrase, v.bars, v.skip));
    const src = songs[v.song].stems;
    if (!part || !src) continue;
    const rate = prepared[v.song].playRate;
    // Output seconds → clip seconds, merged where they touch.
    const clipRanges = ranges
      .map(([a, b]) => [part.start + (a - v.at) * rate, part.start + (b - v.at) * rate] as [number, number])
      .sort((x, y) => x[0] - y[0]);
    const merged: [number, number][] = [];
    for (const r of clipRanges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1] + 0.5) last[1] = Math.max(last[1], r[1]);
      else merged.push([...r]);
    }
    for (const [a, b] of merged) {
      const w = await stemWindow(src, part, a, b).catch(() => null);
      if (w) {
        part.windows.push(w);
        made++;
      }
    }
    onProgress?.(++done / wanted.length);
    await tick();
  }
  return made;
}

// Let the page breathe between long stretches of work.
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export function planTimes(script: SetScript, songs: SongAnalysis[], prepared: PreparedSong[]): MixPlan {
  const master = setBpm(songs, script);
  const mBar = barSeconds(master);
  let at = 0;
  const visits: PlannedVisit[] = [];
  for (const v of script.visits) {
    if (!prepared[v.song].parts.has(partKey(v.phrase, v.bars, v.skip))) continue;
    const dur = v.bars * mBar;
    visits.push({
      ...v,
      layers: (v.layers ?? []).filter((l) => prepared[l.song].lines.has(lineKey(l))),
      at,
      dur,
      sourceStart: songs[v.song].structure.phrases[v.phrase].start + (v.skip ?? 0) * mBar * prepared[v.song].rate,
    });
    at += dur;
  }
  return {
    bpm: master,
    title: script.title,
    story: script.story,
    by: script.by,
    visits,
    end: at,
    songs: prepared.map((p) => ({ title: p.title, bpm: p.bpm, rate: p.rate, synced: p.synced, key: p.key })),
  };
}

function noiseBuffer(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export async function renderSet(
  prepared: PreparedSong[],
  plan: MixPlan,
  energy: Energy,
  tag?: AudioBuffer | null,
  mood: Mood = classicMood(energy),
): Promise<AudioBuffer> {
  const total = plan.end + TAIL_SECONDS;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * MIX_SAMPLE_RATE), MIX_SAMPLE_RATE);
  const beat = 60 / plan.bpm;
  const bar = beat * 4;
  const noise = noiseBuffer(ctx);
  const visits = plan.visits;
  const level = { lounge: 0.6, club: 0.85, peak: 1 }[energy];
  const st = STYLE[energy];
  const mashBars = energy === "lounge" ? 8 : 4; // how long a mash-up overlaps

  // ---- master chain -------------------------------------------------------
  const comp = ctx.createDynamicsCompressor();
  // Lounge breathes, Peak is squeezed hard.
  comp.threshold.value = { lounge: -10, club: -12, peak: -17 }[energy];
  comp.knee.value = 6;
  comp.ratio.value = { lounge: 2.5, club: 4, peak: 6 }[energy];
  comp.attack.value = 0.004;
  comp.release.value = 0.2;
  comp.connect(ctx.destination);
  const master = ctx.createGain();
  master.gain.value = 0.85;
  const masterHp = ctx.createBiquadFilter();
  masterHp.type = "highpass";
  masterHp.frequency.value = 20;
  // Lounge is warmer: the very top is rolled off.
  const warmth = ctx.createBiquadFilter();
  warmth.type = "lowpass";
  warmth.frequency.value = energy === "lounge" ? 9000 : 20000;
  // The mood's tone: Deep House warm and round, Strings Lift bright, Oud
  // Spotlight with the melody range forward.
  const tone = mood.tone ?? { low: 0, mid: 0, high: 0 };
  const toneLow = ctx.createBiquadFilter();
  toneLow.type = "lowshelf";
  toneLow.frequency.value = 150;
  toneLow.gain.value = tone.low;
  const toneMid = ctx.createBiquadFilter();
  toneMid.type = "peaking";
  toneMid.frequency.value = 1800;
  toneMid.Q.value = 0.7;
  toneMid.gain.value = tone.mid;
  const toneHigh = ctx.createBiquadFilter();
  toneHigh.type = "highshelf";
  toneHigh.frequency.value = 7000;
  toneHigh.gain.value = tone.high;
  master.connect(masterHp).connect(warmth).connect(toneLow).connect(toneMid).connect(toneHigh).connect(comp);
  // The outro: over the last 8 bars the low end thins and the level eases
  // down, then the music fades out through the tail under the echo, the way a
  // DJ rides the fader down on a last record.
  const outroFrom = Math.max(0, plan.end - 8 * bar);
  masterHp.frequency.setValueAtTime(20, plan.end - 4 * bar);
  masterHp.frequency.exponentialRampToValueAtTime(400, plan.end + TAIL_SECONDS * 0.5);
  master.gain.setValueAtTime(0.85, outroFrom);
  master.gain.linearRampToValueAtTime(0.5, plan.end);
  master.gain.exponentialRampToValueAtTime(0.03, plan.end + TAIL_SECONDS * 0.75);
  master.gain.exponentialRampToValueAtTime(0.0001, plan.end + TAIL_SECONDS);

  const music = ctx.createGain();
  music.connect(master);
  const drums = ctx.createGain();
  drums.connect(master);

  // Echo bus: throws at cuts, and the closing tail.
  const echoSend = ctx.createGain();
  echoSend.gain.value = 0;
  const delay = ctx.createDelay(2);
  delay.delayTime.value = beat * 0.75;
  const fb = ctx.createGain();
  fb.gain.value = 0.42;
  const echoTone = ctx.createBiquadFilter();
  echoTone.type = "bandpass";
  echoTone.frequency.value = 1500;
  echoTone.Q.value = 0.6;
  echoSend.connect(delay);
  delay.connect(echoTone).connect(fb).connect(delay);
  echoTone.connect(master);
  echoSend.gain.setValueAtTime(0, outroFrom);
  echoSend.gain.linearRampToValueAtTime(0.6, plan.end);

  // Balance songs to a common loudness.
  const partOf = (v: PlannedVisit) => prepared[v.song].parts.get(partKey(v.phrase, v.bars, v.skip))!;
  const rmsAll = visits.map((v) => partOf(v).rms).sort((a, b) => a - b);
  const target = rmsAll[Math.floor(rmsAll.length / 2)] || 0.1;

  // ---- the parts ------------------------------------------------------------
  visits.forEach((v, idx) => {
    const song = prepared[v.song];
    const part = partOf(v);
    const next = visits[idx + 1];
    const g = Math.max(0.5, Math.min(2, target / part.rms));
    const T = v.at;
    const Tend = T + v.dur;
    const rate = song.playRate;

    const shelf = ctx.createBiquadFilter();
    shelf.type = "lowshelf";
    shelf.frequency.value = 220;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 20;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 20000;
    // Steps back in the voice range while a line from another song is on top.
    const mid = ctx.createBiquadFilter();
    mid.type = "peaking";
    mid.frequency.value = 1500;
    mid.Q.value = 0.8;
    mid.gain.value = 0;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    shelf.connect(hp).connect(lp).connect(mid).connect(gain).connect(music);
    const send = ctx.createGain();
    send.gain.value = 0;
    gain.connect(send).connect(echoSend);

    // -- stems: where this part plays from its four stems instead of the song --
    // The whole song and its stems are cut and stretched alike, so they swap
    // over in 8 ms without a seam. Each stem has its own fader; events are
    // collected and written in time order at the end of the part.
    const mixGate = ctx.createGain();
    const stemGate = ctx.createGain();
    stemGate.gain.value = 0;
    const faders = {} as Record<StemName, GainNode>;
    for (const n of STEM_NAMES) {
      faders[n] = ctx.createGain();
      faders[n].connect(stemGate);
    }
    stemGate.connect(shelf);
    mixGate.connect(shelf);
    const events = new Map<AudioParam, [number, number, number][]>();
    const ev = (param: AudioParam, t: number, value: number, ramp = 0.015) => {
      const list = events.get(param) ?? [];
      list.push([t, value, ramp]);
      events.set(param, list);
    };
    const stem = (names: StemName[], t: number, value: number, ramp = 0.015) => {
      for (const n of names) ev(faders[n].gain, t, value, ramp);
    };
    const winOut = part.windows.map((w) => ({
      w,
      a: T + (w.c0 - part.start) / rate,
      b: T + (w.c1 - part.start) / rate,
    }));
    const covered = (a: number, b: number) => winOut.some((x) => x.a <= a + 0.02 && x.b >= b - 0.02);

    // Clip time for an output time inside this part.
    const clipAt = (t: number) => part.start + (t - T) * rate;
    const play = (from: number, to: number, clipFrom: number) => {
      // Near a song's very start there may be no audio before the clip: start
      // later rather than out of time.
      if (clipFrom < 0) {
        from -= clipFrom / rate;
        clipFrom = 0;
      }
      if (to - from < 0.01) return;
      const src = ctx.createBufferSource();
      src.buffer = part.clip;
      src.playbackRate.value = rate;
      src.connect(mixGate);
      src.start(from, clipFrom, (to - from) * rate);
    };
    // Call and response: for 8 bars the songs swap the top every
    // `tradeEvery` bars, while the outgoing song keeps one continuous beat and
    // bass line underneath; on bar 8 the bass hands over. The groove never
    // breaks, only the voices answer each other.
    const trade = (from: number, incoming: boolean, after: number) => {
      const k = st.tradeEvery * bar;
      const end = from + 8 * bar;
      if (incoming) {
        hp.frequency.setValueAtTime(250, from);
        let cur = 0;
        gain.gain.setValueAtTime(0, from);
        for (let i = 0; i * k < 8 * bar - 1e-6; i++) {
          const t0 = from + i * k;
          const want = i % 2 === 0 ? g : 0;
          gain.gain.setValueAtTime(cur, t0);
          gain.gain.linearRampToValueAtTime(want, t0 + 0.012);
          cur = want;
        }
        gain.gain.setValueAtTime(cur, end);
        gain.gain.linearRampToValueAtTime(after, end + 0.012);
        hp.frequency.setValueAtTime(250, end - 0.01);
        hp.frequency.exponentialRampToValueAtTime(20, end + 0.03);
      } else {
        gain.gain.setValueAtTime(g, from);
        let cur = 20000;
        lp.frequency.setValueAtTime(cur, from);
        for (let i = 0; i * k < 8 * bar - 1e-6; i++) {
          const t0 = from + i * k;
          const want = i % 2 === 0 ? 250 : 20000; // even turns belong to the new song
          lp.frequency.setValueAtTime(cur, t0);
          lp.frequency.exponentialRampToValueAtTime(want, t0 + 0.015);
          cur = want;
        }
        gain.gain.setValueAtTime(g, end);
        gain.gain.linearRampToValueAtTime(after, end + 0.03);
      }
    };

    // -- how it comes in --
    let startAt = T;
    // Keys that clash (3+ steps apart on the Camelot wheel) sound sour layered
    // for long, so those blends are kept short.
    const prevSong = idx > 0 ? prepared[visits[idx - 1].song] : null;
    const clash = !!prevSong && prevSong !== song && camelotDistance(prevSong.key, song.key) >= 3;
    if (v.move === "flow") {
      // The same song carrying on: a 12 ms seam, nothing a listener hears.
      startAt = T - SEAM;
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(g, T + SEAM);
    } else if (v.move === "blend") {
      startAt = T - (clash ? 2 : st.blendBars) * bar;
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(g * 0.8, T);
      gain.gain.setValueAtTime(g, T);
      if (covered(startAt, T)) {
        // On stems: the new song's drums and music ride in under the old
        // song; its bassline takes over exactly on the one, its singer after.
        stem(["bass", "vocals"], startAt - 0.05, 0, 0.001);
        stem(["bass"], T - 0.015, 1);
        stem(["vocals"], T, 1, beat / 2);
      } else {
        shelf.gain.setValueAtTime(-30, startAt);
        shelf.gain.setValueAtTime(-30, T - 0.01);
        shelf.gain.linearRampToValueAtTime(0, T);
      }
    } else if (v.move === "trade") {
      trade(T, true, g);
    } else if (v.move === "mashup") {
      gain.gain.setValueAtTime(g, T);
      if (covered(T, T + mashBars * bar)) {
        // On stems, a true mash-up: this song's voice and music over the old
        // song's beat and bassline, then its own beat takes over.
        stem(["drums", "bass"], T - 0.05, 0, 0.001);
        stem(["drums", "bass"], T + mashBars * bar - 0.015, 1);
      } else {
        hp.frequency.setValueAtTime(300, T);
        hp.frequency.setValueAtTime(300, T + mashBars * bar - 0.01);
        hp.frequency.linearRampToValueAtTime(20, T + mashBars * bar);
      }
    } else if (v.move === "cut" && !visits[idx - 1]?.fx.loopBuild) {
      // A cut that isn't a drop lands soft: in over half a beat, its top
      // opening over the first bar, under the old song's echo tail.
      gain.gain.setValueAtTime(0, T);
      gain.gain.linearRampToValueAtTime(g, T + beat / 2);
      lp.frequency.setValueAtTime(700, T);
      lp.frequency.exponentialRampToValueAtTime(20000, T + bar);
    } else {
      gain.gain.setValueAtTime(v.move === "open" ? 0 : g, T);
      if (v.move === "open") gain.gain.linearRampToValueAtTime(g, T + bar);
    }

    // -- inside the part --
    const loopFrom = v.fx.loopBuild ? Tend - 4 * bar : Tend;
    // A drum solo instead of the stutter build: the music is thrown into
    // its echo and falls away, and the darbuka plays alone into the drop.
    const solo = v.fx.loopBuild && mood.signature === "drumSolo" && !!mood.groove && !!next;
    if (solo) {
      gain.gain.setValueAtTime(g, loopFrom - 0.04);
      gain.gain.linearRampToValueAtTime(0, loopFrom + 0.01);
      send.gain.setValueAtTime(0, loopFrom - beat);
      send.gain.linearRampToValueAtTime(0.8, loopFrom - 0.02);
      send.gain.linearRampToValueAtTime(0, loopFrom + 0.01);
    }
    // A taqsim: in a breakdown the melody plays alone into a long echo.
    if (v.fx.breakdown && mood.signature === "taqsim" && next) {
      send.gain.setValueAtTime(0, T);
      send.gain.linearRampToValueAtTime(0.32, T + bar);
      send.gain.setValueAtTime(0.32, Math.max(T + bar, loopFrom - 2 * bar));
      send.gain.linearRampToValueAtTime(0, Math.max(T + bar + 0.01, loopFrom - 2 * beat));
    }
    if (v.fx.breakdown && covered(T + beat, loopFrom - bar)) {
      // On stems: the beat and the bass fall away, leaving the voice and the
      // music; the drums build back over the last bar, the bass lands after.
      stem(["drums", "bass"], T, 0, beat);
      stem(["drums"], loopFrom - bar, 1, bar);
      stem(["bass"], loopFrom - 0.03, 1);
    } else if (v.fx.breakdown) {
      // Bass out until the last bar, then it swells back for what follows.
      shelf.gain.setValueAtTime(0, T + 0.01);
      shelf.gain.linearRampToValueAtTime(-24, T + beat);
      shelf.gain.setValueAtTime(-24, Tend - bar);
      shelf.gain.linearRampToValueAtTime(0, Tend - 0.02);
    }
    // A filter rise only makes sense into a cut or a drop: before a blend it
    // would strip the bass while the incoming song's bass is still held back,
    // leaving a hole.
    const rising = v.fx.filterRise && (!next || next.move === "cut" || v.fx.drop);
    if (rising || v.fx.loopBuild) {
      const from = v.fx.loopBuild ? loopFrom : Math.max(T + mashBars * bar, Tend - 8 * bar);
      hp.frequency.setValueAtTime(20, from);
      hp.frequency.exponentialRampToValueAtTime(700, Tend - 0.03);
      hp.frequency.setValueAtTime(20, Tend);
    }

    // -- how it goes out (decided by the next part's move) --
    let stopAt = Tend + 0.05;
    if (!next) {
      // The last song keeps playing under the fade instead of stopping dead
      // at the last bar line.
      stopAt = Tend + TAIL_SECONDS;
      gain.gain.setValueAtTime(g, Tend - 4 * bar);
      send.gain.setValueAtTime(0, Tend - 4 * bar);
      send.gain.linearRampToValueAtTime(0.7, Tend);
    } else if (next.move === "flow") {
      gain.gain.setValueAtTime(g, Tend - SEAM);
      gain.gain.linearRampToValueAtTime(0, Tend + SEAM);
      stopAt = Tend + SEAM + 0.01;
    } else if (next.move === "blend") {
      // Lounge lets the old song drift away over 4 bars.
      const out = (energy === "lounge" ? 4 : 1) * bar;
      if (covered(Tend - bar, Tend + out)) {
        // On stems: the old bassline hands over on the one and the old voice
        // finishes its line; only the drums and music drift away.
        stem(["bass"], Tend - 0.015, 0);
        stem(["vocals"], Tend - beat / 2, 0, beat / 2);
      } else {
        shelf.gain.setValueAtTime(0, Tend - 0.01);
        shelf.gain.linearRampToValueAtTime(-30, Tend);
      }
      hp.frequency.setValueAtTime(20, Tend);
      hp.frequency.exponentialRampToValueAtTime(1000, Tend + out);
      gain.gain.setValueAtTime(g, Tend);
      gain.gain.linearRampToValueAtTime(0, Tend + out);
      stopAt = Tend + out + 0.05;
    } else if (next.move === "trade") {
      trade(Tend, false, 0);
      stopAt = Tend + 8 * bar + 0.05;
    } else if (next.move === "mashup") {
      if (covered(Tend - beat, Tend + mashBars * bar)) {
        // On stems: only this song's beat and bassline stay, under the new
        // song's voice.
        stem(["vocals", "other"], Tend - 0.015, 0);
      } else {
        lp.frequency.setValueAtTime(20000, Tend);
        lp.frequency.exponentialRampToValueAtTime(320, Tend + 0.25);
      }
      gain.gain.setValueAtTime(g, Tend + mashBars * bar - beat);
      gain.gain.linearRampToValueAtTime(0, Tend + mashBars * bar);
      stopAt = Tend + mashBars * bar + 0.05;
    } else {
      send.gain.setValueAtTime(0, Tend - beat);
      send.gain.linearRampToValueAtTime(0.9, Tend - 0.02);
      send.gain.linearRampToValueAtTime(0, Tend);
      gain.gain.setValueAtTime(g, Tend - 0.02);
      gain.gain.linearRampToValueAtTime(0, Tend);
    }

    // -- the audio itself --
    play(startAt, Math.min(stopAt, v.fx.loopBuild ? loopFrom + (solo ? 0.02 : 0) : stopAt), clipAt(startAt));
    if (v.fx.loopBuild && !solo) {
      // The stutter build: the bar before the loop, repeated, tighter and
      // tighter: 1 bar, 1 bar, ½, ½, then four ¼-bar hits.
      const src0 = clipAt(loopFrom - bar);
      const pattern = [1, 1, 0.5, 0.5, 0.25, 0.25, 0.25, 0.25];
      let t = loopFrom;
      for (const len of pattern) {
        const dur = len * bar;
        play(t, t + dur, src0);
        t += dur;
      }
    }

    // -- the stem windows: stems in, whole song out, and back --
    const playTo = Math.min(stopAt, v.fx.loopBuild ? loopFrom : stopAt);
    for (const { w, a, b } of winOut) {
      const from = Math.max(a, startAt);
      const to = Math.min(b, playTo);
      if (to - from < 0.05) continue;
      for (const n of STEM_NAMES) {
        const src = ctx.createBufferSource();
        src.buffer = w.bufs[n];
        src.playbackRate.value = rate;
        src.connect(faders[n]);
        src.start(from, (from - a) * rate, (to - from) * rate);
      }
      ev(stemGate.gain, from, 1, 0.008);
      ev(mixGate.gain, from, 0, 0.008);
      ev(stemGate.gain, to - 0.008, 0, 0.008);
      ev(mixGate.gain, to - 0.008, 1, 0.008);
    }

    // -- the lines dropped on top --
    for (const l of v.layers) {
      const ls = prepared[l.song];
      const line = ls.lines.get(lineKey(l));
      if (!line) continue;
      const voice = line.voice ?? null;
      const lg = Math.max(0.5, Math.min(2, target / line.rms)) * (energy === "lounge" ? 0.75 : 0.9);
      const lhp = ctx.createBiquadFilter();
      lhp.type = "highpass";
      // A clean voice from the stems needs no carving; a line cut from the
      // whole song is thinned to keep its beat and bass out of the way.
      lhp.frequency.value = voice ? 110 : l.style === "chop" ? 280 : 380;
      lhp.Q.value = 0.7;
      const lgain = ctx.createGain();
      lgain.gain.value = 0;
      lhp.connect(lgain).connect(music);
      const lsend = ctx.createGain();
      lsend.gain.value = l.style === "echo" ? 0.35 : 0.12;
      lgain.connect(lsend).connect(echoSend);
      // One slice of the line: `off` output seconds into it, for `dur`.
      const hit = (t: number, off: number, dur: number) => {
        const src = ctx.createBufferSource();
        src.buffer = voice ?? line.clip;
        src.playbackRate.value = ls.playRate;
        src.connect(lhp);
        src.start(t, line.start + off * ls.playRate, dur * ls.playRate + 0.01);
        lgain.gain.setValueAtTime(0, t);
        lgain.gain.linearRampToValueAtTime(lg, t + 0.005);
        lgain.gain.setValueAtTime(lg, t + dur - 0.01);
        lgain.gain.linearRampToValueAtTime(0, t + dur);
      };
      const w0 = T + l.at * bar;
      const w1 = w0 + l.len * l.times * bar;
      for (let r = 0; r < l.times; r++) {
        const t0 = w0 + r * l.len * bar;
        if (l.style === "chop") {
          // Stutter the line's first half-beat, then let it speak: "ha-ha-hey".
          for (let m = 0; m < l.len; m++) {
            const b0 = t0 + m * bar;
            for (const h of [0, 0.75, 1.5]) hit(b0 + h * beat, m * bar, beat / 2);
            hit(b0 + 2 * beat, m * bar, 2 * beat);
          }
        } else {
          hit(t0, 0, l.len * bar);
        }
      }
      if (l.style === "echo") {
        lsend.gain.setValueAtTime(0.35, w1 - beat);
        lsend.gain.linearRampToValueAtTime(0.95, w1 - 0.02);
        lsend.gain.linearRampToValueAtTime(0, w1);
      }
      if (covered(w0, w1)) {
        // On stems the singer underneath steps aside for the line.
        stem(["vocals"], w0 - 0.06, 0.12, 0.06);
        stem(["vocals"], w1, 1, 0.08);
      } else {
        mid.gain.setValueAtTime(0, Math.max(T, w0 - 0.05));
        mid.gain.linearRampToValueAtTime(-7, w0);
        mid.gain.setValueAtTime(-7, w1);
        mid.gain.linearRampToValueAtTime(0, w1 + 0.08);
      }
    }

    // Write every fader move in time order (each a short ramp from where the
    // fader was to where it goes).
    for (const [param, list] of events) {
      list.sort((x, y) => x[0] - y[0]);
      let cur = param.value;
      for (const [t, value, ramp] of list) {
        const t0 = Math.max(0, t);
        param.setValueAtTime(cur, t0);
        param.linearRampToValueAtTime(value, t0 + Math.max(0.001, ramp));
        cur = value;
      }
    }
  });

  // ---- additions on the grid ---------------------------------------------
  // The drum hits (hundreds of them in a long set) are synthesized straight into
  // one buffer, and the sidechain pump is one control curve. Scheduling each hit
  // as its own Web Audio nodes made a 5-minute set take minutes to render.
  const sr = MIX_SAMPLE_RATE;
  const drumBuf = ctx.createBuffer(1, Math.ceil(total * sr), sr);
  const dr = drumBuf.getChannelData(0);
  const PUMP_RATE = 3000;
  const pumpBuf = ctx.createBuffer(1, Math.ceil(total * PUMP_RATE), PUMP_RATE);
  const pump = pumpBuf.getChannelData(0);
  pump.fill(1);

  // A soft kick (deep house, oud electro) is rounder: a lower start and a
  // slower sweep, so it thumps instead of clicking.
  const kick = (t: number, lvl: number, soft = false) => {
    const s0 = Math.round(t * sr);
    const n = Math.round(0.4 * sr);
    const f0 = soft ? 95 : 150;
    const sweep = soft ? 0.08 : 0.12;
    let phase = 0;
    for (let i = 0; i < n && s0 + i < dr.length; i++) {
      const x = i / sr;
      const f = x < sweep ? f0 * Math.pow(45 / f0, x / sweep) : 45;
      phase += (2 * Math.PI * f) / sr;
      dr[s0 + i] += lvl * Math.exp(-x * (soft ? 16 : 19.7)) * Math.sin(phase);
    }
  };
  // A tuned membrane: a sine gliding from f0 to f1 over `glide` seconds,
  // dying away at `decay` per second.
  const membrane = (t: number, lvl: number, f0: number, f1: number, glide: number, decay: number, len: number) => {
    const s0 = Math.round(t * sr);
    const n = Math.round(len * sr);
    let phase = 0;
    for (let i = 0; i < n && s0 + i < dr.length; i++) {
      const x = i / sr;
      const f = x < glide ? f0 * Math.pow(f1 / f0, x / glide) : f1;
      phase += (2 * Math.PI * f) / sr;
      // A 2 ms attack so the hit never clicks.
      const a = Math.min(1, x / 0.002);
      dr[s0 + i] += lvl * a * Math.exp(-x * decay) * Math.sin(phase);
    }
  };
  // Filtered noise with an exponential tail, through a one-off biquad.
  const noiseHit = (t: number, lvl: number, kind: "hp" | "bp", freq: number, q: number, len: number) => {
    const s0 = Math.round(t * sr);
    const n = Math.round((len + 0.02) * sr);
    const w = (2 * Math.PI * freq) / sr;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    let b0: number, b1: number, b2: number;
    if (kind === "hp") {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    const a0 = 1 + alpha;
    const a1 = -2 * cos;
    const a2 = 1 - alpha;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const k = Math.log(0.001) / len;
    for (let i = 0; i < n && s0 + i < dr.length; i++) {
      const x = Math.random() * 2 - 1;
      const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      dr[s0 + i] += lvl * Math.exp((k * i) / sr) * y;
    }
  };
  const hat = (t: number, lvl: number) => noiseHit(t, lvl, "hp", 8000, 0.7, 0.06);
  const clap = (t: number, lvl: number) => {
    noiseHit(t, lvl, "bp", 1400, 0.9, 0.012);
    noiseHit(t + 0.012, lvl * 0.8, "bp", 1400, 0.9, 0.012);
    noiseHit(t + 0.024, lvl, "bp", 1400, 0.9, 0.2);
  };
  const openHat = (t: number, lvl: number) => noiseHit(t, lvl, "hp", 7500, 0.7, 0.24);
  const shaker = (t: number, lvl: number) => noiseHit(t, lvl, "hp", 6500, 0.7, 0.035);
  // The hand drums. A darbuka's doum is a tuned low thump with a slap of skin
  // on top; its tek is the bright crack of the rim. The dabke tabl is bigger
  // and deeper, struck with a stick. Congas sit in between.
  const doum = (t: number, lvl: number, drum: Groove["drum"]) => {
    if (drum === "tabl") {
      membrane(t, lvl, 92, 54, 0.07, 7, 0.6);
      noiseHit(t, lvl * 0.25, "bp", 500, 1, 0.03);
    } else {
      membrane(t, lvl * 0.9, 120, 82, 0.05, 10, 0.45);
      noiseHit(t, lvl * 0.18, "bp", 700, 1, 0.02);
    }
  };
  const tek = (t: number, lvl: number, drum: Groove["drum"], soft = false) => {
    const l = soft ? lvl * 0.5 : lvl;
    if (drum === "tabl") {
      noiseHit(t, l * 0.9, "bp", 2400, 1, 0.06);
      membrane(t, l * 0.3, 720, 680, 0.02, 45, 0.08);
    } else {
      noiseHit(t, l, "bp", soft ? 3000 : 3800, 1.4, 0.045);
      membrane(t, l * 0.35, 1250, 1180, 0.01, 60, 0.06);
    }
  };
  const conga = (t: number, lvl: number, high: boolean) => {
    const f = high ? 330 : 215;
    membrane(t, lvl, f * 1.06, f, 0.03, 14, 0.3);
    noiseHit(t, lvl * 0.15, "bp", 2000, 1, 0.01);
  };
  const strike = (ch: string, t: number, lvl: number, drum: Groove["drum"]) => {
    if (ch === "D") doum(t, lvl * 0.55, drum);
    else if (ch === "T") tek(t, lvl * 0.32, drum);
    else if (ch === "k") tek(t, lvl * 0.32, drum, true);
    else if (ch === "c") conga(t, lvl * 0.3, true);
    else if (ch === "C") conga(t, lvl * 0.34, false);
    else if (ch === "s") shaker(t, lvl * 0.06);
  };
  // The groove from `from` to `to`, locked to the set's bar grid (so the
  // pattern never restarts mid-bar at a part change), with its fill on the
  // last bar of every eight.
  const setStart = visits[0]?.at ?? 0;
  const sixteenth = beat / 4;
  const playGroove = (gr: Groove, from: number, to: number, lvl: number) => {
    const first = Math.ceil((from - setStart) / sixteenth - 1e-6);
    for (let k = first; ; k++) {
      const t = setStart + k * sixteenth;
      if (t >= to - 1e-3) break;
      const barNo = Math.floor(k / 16);
      const step = ((k % 16) + 16) % 16;
      const fillBar = gr.fill && barNo % 8 === 7;
      const ch = fillBar ? gr.fill![step] : gr.steps[(k % gr.steps.length + gr.steps.length) % gr.steps.length];
      if (ch && ch !== ".") strike(ch, t, lvl, gr.drum);
    }
  };
  // The drum solo: four bars that climb. Two bars of fills, a bar of doum and
  // tek trading every sixteenth, then a roll of the rim in thirty-seconds
  // swelling into the drop.
  // It plays alone, so it plays up: about as loud as the music it replaced.
  const drumSolo = (gr: Groove, from: number, to: number, level: number) => {
    const lvl = level * 1.7;
    const fill = gr.fill ?? "D.TkTkD.TkTkTkTk";
    for (let b = 0; b < 2; b++) {
      for (let st = 0; st < 16; st++) {
        const ch = fill[st];
        if (ch !== ".") strike(ch, from + b * bar + st * sixteenth, lvl * (b === 0 ? 0.9 : 1.05), gr.drum);
      }
    }
    for (let st = 0; st < 16; st++) {
      const t = from + 2 * bar + st * sixteenth;
      strike(st % 4 === 0 ? "D" : st % 2 === 0 ? "T" : "k", t, lvl * (0.85 + (0.3 * st) / 16), gr.drum);
    }
    const rollFrom = from + 3 * bar;
    for (let st = 0; st < 32; st++) {
      const t = rollFrom + st * (sixteenth / 2);
      if (t >= to - 1e-3) break;
      if (st % 8 === 0) strike("D", t, lvl * (0.9 + (0.4 * st) / 32), gr.drum);
      strike(st % 2 === 0 ? "T" : "k", t, lvl * (0.7 + (0.6 * st) / 32), gr.drum);
    }
  };
  const pumpAt = (t: number, depth: number) => {
    const s0 = Math.round(t * PUMP_RATE);
    const n = Math.round(beat * 0.45 * PUMP_RATE);
    for (let i = 0; i < n && s0 + i < pump.length; i++) {
      pump[s0 + i] = Math.min(pump[s0 + i], 1 - depth * (1 - i / n));
    }
  };

  const fx = ctx.createGain();
  fx.connect(master);
  const riser = (from: number, to: number, lvl: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 2.5;
    f.frequency.setValueAtTime(300, from);
    f.frequency.exponentialRampToValueAtTime(7000, to);
    const gg = ctx.createGain();
    gg.gain.setValueAtTime(0.0001, from);
    gg.gain.exponentialRampToValueAtTime(lvl, to - 0.02);
    gg.gain.linearRampToValueAtTime(0, to);
    src.connect(f).connect(gg).connect(fx);
    src.start(from);
    src.stop(to + 0.05);
  };
  const drop = (t: number, lvl: number) => {
    // Sub boom, written into the drum buffer.
    const s0 = Math.round(t * sr);
    const n = Math.round(1.5 * sr);
    let phase = 0;
    for (let i = 0; i < n && s0 + i < dr.length; i++) {
      const x = i / sr;
      const f = 70 * Math.pow(38 / 70, Math.min(1, x));
      phase += (2 * Math.PI * f) / sr;
      dr[s0 + i] += 0.7 * lvl * Math.exp(-x * 4.9) * Math.sin(phase);
    }
    noiseHit(t, 0.28 * lvl, "hp", 3500, 0.7, 1.8); // crash
  };

  visits.forEach((v, idx) => {
    const song = prepared[v.song];
    const T = v.at;
    const Tend = T + v.dur;
    const next = visits[idx + 1];
    const fx = v.fx;

    if (fx.pump && song.synced) {
      const depth = (fx.claps ? 0.35 : 0.22) * level * (energy === "peak" ? 1.3 : 1);
      for (let b = T; b < Tend - 1e-3; b += beat) pumpAt(b, depth);
    }
    if (song.synced) {
      const kit = mood.kit;
      const kLvl = (fx.claps ? 0.65 : 0.5) * level * (kit.kick === "soft" ? 0.7 : 1);
      // During a loop build the kick doubles up with the stutter.
      const loopFrom = fx.loopBuild ? Tend - 4 * bar : Tend;
      const solo = fx.loopBuild && mood.signature === "drumSolo" && !!mood.groove && !!next;
      const drumsTo = solo ? loopFrom : Tend;
      if (fx.kick && kit.kick !== "none") {
        for (let b = T; b < loopFrom - 1e-3; b += beat) kick(b, kLvl, kit.kick === "soft");
        if (fx.loopBuild && !solo) {
          for (let b = loopFrom; b < Tend - 2 * bar - 1e-3; b += beat) kick(b, kLvl);
          for (let b = Tend - 2 * bar; b < Tend - bar - 1e-3; b += beat / 2) kick(b, kLvl * 0.9);
          for (let b = Tend - bar; b < Tend - 1e-3; b += beat / 4) kick(b, kLvl * 0.8);
        }
      }
      if (fx.hats) {
        if (kit.hats === "off") for (let b = T + beat / 2; b < drumsTo; b += beat) hat(b, 0.13 * level);
        else if (kit.hats === "open") for (let b = T + beat / 2; b < drumsTo; b += beat) openHat(b, 0.11 * level);
        else if (kit.hats === "sixteenths") {
          for (let k = 0, b = T; b < drumsTo - 1e-3; k++, b = T + (k * beat) / 4) {
            hat(b, (k % 4 === 2 ? 0.13 : 0.06) * level);
          }
        }
      }
      if (fx.claps && kit.claps) for (let b = T + beat; b < drumsTo; b += 2 * beat) clap(b, 0.3 * level);
      const drumsOn = fx.kick || fx.hats || fx.claps;
      if (kit.shaker && (drumsOn || mood.grooveIn === "always") && !fx.breakdown) {
        for (let k = 0, b = T; b < drumsTo - 1e-3; k++, b = T + (k * beat) / 4) {
          shaker(b, (k % 2 === 1 ? 0.07 : 0.04) * level);
        }
      }
      // The mood's own groove: darbuka, tabl or hand percussion.
      const gr = mood.groove;
      const where = mood.grooveIn ?? "drums";
      const grooveOn =
        !!gr && (where === "always" ? !fx.breakdown : where === "breaks" ? fx.breakdown : drumsOn);
      if (gr && grooveOn) {
        const lvl = gr.level * level * (where === "always" && !drumsOn ? 0.65 : 1);
        playGroove(gr, T, drumsTo, lvl);
      }
      if (gr && solo) drumSolo(gr, loopFrom, Tend, level);
    }
    if (next && (fx.riser || fx.loopBuild)) {
      const len = (fx.loopBuild ? 4 : Math.min(8, v.bars / 2)) * bar;
      // Under a drum solo the riser stays low, so the drum leads.
      const soloing = fx.loopBuild && mood.signature === "drumSolo" && !!mood.groove;
      riser(Tend - len, Tend, (0.22 * level + 0.05) * (soloing ? 0.45 : 1));
    }
    if (next && (fx.drop || fx.loopBuild)) drop(Tend, level);
  });

  // ---- the DJ tag: twice, in the first bars and just after the big drop ----
  if (tag && visits.length) {
    const times = tagTimes(plan, bar);
    for (const t of times) {
      const src = ctx.createBufferSource();
      src.buffer = tag;
      const thp = ctx.createBiquadFilter();
      thp.type = "highpass";
      thp.frequency.value = 120;
      const tg = ctx.createGain();
      tg.gain.value = 0.6;
      const tsend = ctx.createGain();
      tsend.gain.setValueAtTime(0.35, t);
      tsend.gain.setValueAtTime(0.35, t + Math.max(0, tag.duration - 0.25));
      tsend.gain.linearRampToValueAtTime(0.85, t + tag.duration);
      tsend.gain.linearRampToValueAtTime(0, t + tag.duration + 0.05);
      src.connect(thp).connect(tg).connect(master);
      tg.connect(tsend).connect(echoSend);
      src.start(t);
      // The music steps back while the tag speaks.
      const a = Math.round((t - 0.03) * PUMP_RATE);
      const b = Math.round((t + tag.duration) * PUMP_RATE);
      const fadeN = Math.round(0.08 * PUMP_RATE);
      for (let i = Math.max(0, a); i < Math.min(pump.length, b + fadeN); i++) {
        const k = i < b ? 0.6 : 0.6 + 0.4 * ((i - b) / fadeN);
        pump[i] = Math.min(pump[i], k);
      }
    }
  }

  const drumSrc = ctx.createBufferSource();
  drumSrc.buffer = drumBuf;
  drumSrc.connect(drums);
  drumSrc.start(0);
  // The pump curve drives the music bus gain directly.
  music.gain.value = 0;
  const pumpSrc = ctx.createBufferSource();
  pumpSrc.buffer = pumpBuf;
  pumpSrc.connect(music.gain);
  pumpSrc.start(0);

  const rendered = await ctx.startRendering();
  normalize(rendered, 0.89); // ≈ −1 dBFS peak
  return rendered;
}

// Where the tag lands: one bar into the set, and one bar after the big drop
// (the part after the first loop build past a third of the set, else after a
// drop, else at about 60% through), always on a downbeat.
export function tagTimes(plan: MixPlan, bar: number): number[] {
  const v = plan.visits;
  if (!v.length) return [];
  const first = v[0].at + bar;
  const third = plan.end / 3;
  let i = v.findIndex((x, k) => k > 0 && x.at >= third && v[k - 1].fx.loopBuild);
  if (i < 0) i = v.findIndex((x, k) => k > 0 && x.at >= third && v[k - 1].fx.drop);
  if (i < 0) {
    const target = plan.end * 0.6;
    i = v.reduce((best, x, k) => (Math.abs(x.at - target) < Math.abs(v[best].at - target) ? k : best), 0);
  }
  const second = v[i].at + bar;
  return second - first > 8 * bar && second < plan.end - 4 * bar ? [first, second] : [first];
}

function normalize(buf: AudioBuffer, peakTarget: number) {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const x = Math.abs(d[i]);
      if (x > peak) peak = x;
    }
  }
  if (peak <= 0) return;
  const k = peakTarget / peak;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
}
