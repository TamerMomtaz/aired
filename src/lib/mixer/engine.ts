// The AIRED Mixer engine: two to six songs in, one long club mix out.
//
// A real DJ set doesn't play half of one record and then half of another. It
// trades PARTS: a phrase of A, then B comes in on the phrase line, then back to
// A's next part, B's chorus over A's beat, and so on, with every song's story
// moving forward each time it returns. That is what this engine does:
//
//   1. Every song is beat-tracked (tempo.ts) and cut into 8-bar phrases on its
//      own downbeats (structure.ts).
//   2. The first song's tempo is the master clock. Every other song is pitched
//      vinyl-style to meet it (up to ±12%); one that can't be is still used, but
//      always entered and left with a hard echo cut instead of a blend.
//   3. The set is a row of 16-bar VISITS. Songs take turns, A B C A B C…, and
//      each visit plays that song's next strong section, in the song's own order.
//   4. Visits change on the bar line with one of three moves:
//        blend   — the next song creeps in bass-cut for 4 bars; on the "one" the
//                  basses swap and the old song is filtered away;
//        mash-up — for 4 bars the old song keeps only its bass and kick while
//                  the new one plays only its top: one song's beat under the
//                  other's voice, then the bass drops back in;
//        cut     — the old song is thrown into an echo and the new one slams in
//                  with a boom (always used when tempos couldn't be locked).
//   5. "Additions" follow an energy arc across the set (warm-up → build → peak →
//      outro): a bridge kick, off-beat hats, claps, risers into big moments,
//      drop booms and crashes, and sidechain pumping.
//
// It all renders in an OfflineAudioContext: faster than real time, and never a
// second live audio element beside the global player (the one-<audio>
// invariant in player-provider stays untouched).

import { MIX_SAMPLE_RATE } from "./load";
import { refineStart, type Structure } from "./structure";
import type { Tempo } from "./tempo";

export type Energy = "lounge" | "club" | "peak";
export type MixMinutes = 5 | 7 | 10;

export const MIN_TRACKS = 2;
export const MAX_TRACKS = 6;
// How much of each song to read. A long song (no length cap, CLAUDE.md Rule 4)
// is still fully usable; the Mixer just picks its sections from the first 8
// minutes, which keeps a phone's memory in bounds.
export const LOAD_SECONDS = 480;

const VISIT_BARS = 16;
const PRE_BARS = 4; // audio kept before a section, for blends
const POST_BARS = 4; // audio kept after it, for mash-ups and filter-outs
const TAIL_SECONDS = 4;
const MAX_NUDGE = 0.12;

// What survives of a song once its sections are chosen: just those sections,
// packed into one small buffer, so six songs never sit in memory whole.
export type PreparedTrack = {
  title: string;
  clip: AudioBuffer;
  rate: number; // playback rate to meet the master tempo
  synced: boolean;
  bpm: number;
  // Each chosen section: where it begins inside `clip`, its loudness, and
  // where it came from in the song (for the timeline shown to the listener).
  sections: { clipStart: number; rms: number; sourceStart: number }[];
};

export function chooseRate(master: number, bpm: number): { rate: number; synced: boolean } {
  const ratio = master / bpm;
  let best = ratio;
  for (const c of [ratio * 2, ratio / 2]) if (Math.abs(c - 1) < Math.abs(best - 1)) best = c;
  if (Math.abs(best - 1) <= MAX_NUDGE) return { rate: best, synced: true };
  return { rate: 1, synced: false };
}

export function visitSeconds(masterBpm: number): number {
  return VISIT_BARS * 4 * (60 / masterBpm);
}

// How many visits a set of `minutes` needs, and how many fall to each song.
export function visitCounts(masterBpm: number, minutes: MixMinutes, tracks: number) {
  const total = Math.max(tracks * 2, Math.ceil((minutes * 60) / visitSeconds(masterBpm)));
  const per = Array.from({ length: tracks }, (_, i) =>
    Math.floor(total / tracks) + (i < total % tracks ? 1 : 0),
  );
  return { total, per };
}

// Pick `count` 16-bar sections from a song and copy them out of the full
// buffer. Sections run in the song's own order, so each return moves its story
// forward; within each stretch of the song the strongest section wins. The
// opening song always starts on its real intro.
export function prepareTrack(
  title: string,
  full: AudioBuffer,
  tempo: Tempo,
  structure: Structure,
  masterBpm: number,
  count: number,
  opener: boolean,
): PreparedTrack {
  const { rate, synced } = chooseRate(masterBpm, tempo.bpm);
  const masterBar = (4 * 60) / masterBpm;
  // Source seconds covered by one output bar.
  const srcBar = masterBar * rate;
  const ph = structure.phrases;
  const visitSrc = VISIT_BARS * srcBar;

  // Candidate starts: every phrase whose 16 bars fit in the audio we have.
  const cands = ph
    .map((p, i) => ({ i, start: p.start, score: p.rms + (ph[i + 1]?.rms ?? p.rms) }))
    .filter((c) => c.start + visitSrc <= full.duration - 0.05);
  if (cands.length === 0) {
    cands.push({ i: 0, start: ph[0]?.start ?? 0, score: 1 });
  }

  const picks: number[] = [];
  const pool = [...cands];
  if (opener) picks.push(pool.shift()!.start);
  const want = count - picks.length;
  if (want > 0 && pool.length > 0) {
    // Split the rest of the song into `want` stretches; take the strongest
    // section in each, never overlapping the previous pick.
    for (let k = 0; k < want; k++) {
      const lo = Math.floor((k * pool.length) / want);
      const hi = Math.max(lo + 1, Math.floor(((k + 1) * pool.length) / want));
      let best: (typeof pool)[number] | null = null;
      const last = picks[picks.length - 1];
      for (const c of pool.slice(lo, hi)) {
        if (last !== undefined && c.start < last + visitSrc - 0.01 && pool.length >= want * 2) continue;
        if (!best || c.score > best.score) best = c;
      }
      picks.push((best ?? pool[Math.min(lo, pool.length - 1)]).start);
    }
  }
  // A short song asked for many visits loops back over its strongest parts.
  while (picks.length < count) picks.push(picks[picks.length % Math.max(1, picks.length)] ?? 0);

  // Copy each unique section, with room before and after, into one clip.
  const cache = new Map<number, number>();
  const refined = picks.map((p) => {
    if (!cache.has(p)) cache.set(p, refineStart(full, p, structure.beat));
    return cache.get(p)!;
  });
  const unique = [...new Set(refined)];
  const pre = PRE_BARS * srcBar;
  const len = (PRE_BARS + VISIT_BARS + POST_BARS) * srcBar;
  const sr = full.sampleRate;
  const segFrames = Math.ceil(len * sr);
  const clip = new AudioBuffer({
    numberOfChannels: full.numberOfChannels,
    length: segFrames * unique.length,
    sampleRate: sr,
  });
  const offsets = new Map<number, number>();
  unique.forEach((start, u) => {
    const from = Math.round((start - pre) * sr);
    for (let c = 0; c < full.numberOfChannels; c++) {
      const src = full.getChannelData(c);
      const dst = clip.getChannelData(c);
      const base = u * segFrames;
      const a = Math.max(0, from);
      const b = Math.min(src.length, from + segFrames);
      if (b > a) dst.set(src.subarray(a, b), base + (a - from));
    }
    offsets.set(start, u * segFrames / sr + pre);
  });

  const sections = refined.map((start) => {
    const nearest = ph.reduce(
      (best, p) => (Math.abs(p.start - start) < Math.abs(best.start - start) ? p : best),
      ph[0] ?? { start, rms: 0.1 },
    );
    return { clipStart: offsets.get(start)!, rms: nearest.rms || 0.1, sourceStart: start };
  });
  return { title, clip, rate, synced, bpm: tempo.bpm, sections };
}

export type Move = "open" | "blend" | "mashup" | "cut";
export type Stage = "warm" | "build" | "peak" | "outro";

export type Visit = {
  track: number;
  section: number;
  at: number; // output seconds
  move: Move; // how this visit comes in
  stage: Stage;
  sourceStart: number;
};

export type MixPlan = {
  bpm: number;
  visitSeconds: number;
  visits: Visit[];
  end: number;
  tracks: { title: string; bpm: number; rate: number; synced: boolean }[];
};

function stageAt(f: number): Stage {
  if (f < 0.14) return "warm";
  if (f < 0.34) return "build";
  if (f < 0.86) return "peak";
  return "outro";
}

export function planSet(tracks: PreparedTrack[], masterBpm: number, energy: Energy): MixPlan {
  const V = visitSeconds(masterBpm);
  const n = tracks.reduce((s, t) => s + t.sections.length, 0);
  const used = tracks.map(() => 0);
  const visits: Visit[] = [];
  for (let v = 0; v < n; v++) {
    // Round-robin, skipping a song whose sections are spent.
    let track = v % tracks.length;
    for (let k = 0; k < tracks.length && used[track] >= tracks[track].sections.length; k++) {
      track = (track + 1) % tracks.length;
    }
    const section = used[track]++;
    const prev = visits[v - 1];
    const stage = stageAt(n > 1 ? v / (n - 1) : 0);
    let move: Move = "blend";
    if (!prev) move = "open";
    else if (!tracks[track].synced || !tracks[prev.track].synced) move = "cut";
    else if (energy !== "lounge" && (stage === "build" || stage === "peak") && v % 3 === 2) move = "mashup";
    else if (energy === "peak" && stage === "peak" && v % 4 === 0) move = "cut";
    visits.push({
      track,
      section,
      at: v * V,
      move,
      stage,
      sourceStart: tracks[track].sections[section].sourceStart,
    });
  }
  return {
    bpm: masterBpm,
    visitSeconds: V,
    visits,
    end: n * V,
    tracks: tracks.map((t) => ({ title: t.title, bpm: t.bpm, rate: t.rate, synced: t.synced })),
  };
}

function noiseBuffer(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export async function renderSet(
  tracks: PreparedTrack[],
  plan: MixPlan,
  energy: Energy,
): Promise<AudioBuffer> {
  const total = plan.end + TAIL_SECONDS;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * MIX_SAMPLE_RATE), MIX_SAMPLE_RATE);
  const beat = 60 / plan.bpm;
  const bar = beat * 4;
  const V = plan.visitSeconds;
  const noise = noiseBuffer(ctx);
  const visits = plan.visits;
  const level = { lounge: 0.6, club: 0.85, peak: 1 }[energy];

  // ---- master chain -------------------------------------------------------
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.knee.value = 6;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.2;
  comp.connect(ctx.destination);
  const master = ctx.createGain();
  master.gain.value = 0.85;
  const masterHp = ctx.createBiquadFilter();
  masterHp.type = "highpass";
  masterHp.frequency.value = 20;
  master.connect(masterHp).connect(comp);
  const outroFrom = plan.end - 4 * bar;
  masterHp.frequency.setValueAtTime(20, outroFrom);
  masterHp.frequency.exponentialRampToValueAtTime(900, plan.end);
  master.gain.setValueAtTime(0.85, outroFrom);
  master.gain.linearRampToValueAtTime(0.0001, plan.end + TAIL_SECONDS);

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
  const tone = ctx.createBiquadFilter();
  tone.type = "bandpass";
  tone.frequency.value = 1500;
  tone.Q.value = 0.6;
  echoSend.connect(delay);
  delay.connect(tone).connect(fb).connect(delay);
  tone.connect(master);
  echoSend.gain.setValueAtTime(0, outroFrom);
  echoSend.gain.linearRampToValueAtTime(0.6, plan.end);

  // Balance songs to a common loudness.
  const rmsAll = visits.map((v) => tracks[v.track].sections[v.section].rms).sort((a, b) => a - b);
  const target = rmsAll[Math.floor(rmsAll.length / 2)] || 0.1;

  // ---- the visits -----------------------------------------------------------
  visits.forEach((v, idx) => {
    const t = tracks[v.track];
    const sec = t.sections[v.section];
    const next = visits[idx + 1];
    const g = Math.max(0.5, Math.min(2, target / sec.rms));
    const T = v.at;
    const Tend = T + V;

    const src = ctx.createBufferSource();
    src.buffer = t.clip;
    src.playbackRate.value = t.rate;
    const shelf = ctx.createBiquadFilter();
    shelf.type = "lowshelf";
    shelf.frequency.value = 220;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 20;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 20000;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(shelf).connect(hp).connect(lp).connect(gain).connect(music);
    const send = ctx.createGain();
    send.gain.value = 0;
    gain.connect(send).connect(echoSend);

    // -- how it comes in --
    let startAt = T;
    if (v.move === "blend") {
      startAt = T - PRE_BARS * bar;
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(g * 0.8, T);
      gain.gain.setValueAtTime(g, T);
      shelf.gain.setValueAtTime(-30, startAt);
      shelf.gain.setValueAtTime(-30, T - 0.01);
      shelf.gain.linearRampToValueAtTime(0, T);
    } else if (v.move === "mashup") {
      // Top only for 4 bars, riding over the outgoing song's beat.
      gain.gain.setValueAtTime(g, T);
      hp.frequency.setValueAtTime(300, T);
      hp.frequency.setValueAtTime(300, T + PRE_BARS * bar - 0.01);
      hp.frequency.linearRampToValueAtTime(20, T + PRE_BARS * bar);
    } else {
      // open / cut: full level on the "one".
      gain.gain.setValueAtTime(v.move === "open" ? 0 : g, T);
      if (v.move === "open") gain.gain.linearRampToValueAtTime(g, T + bar);
    }

    // -- how it goes out (decided by the next visit's move) --
    let stopAt = Tend + 0.05;
    if (!next) {
      stopAt = Tend + 0.2;
      gain.gain.setValueAtTime(g, Tend - 4 * bar);
      send.gain.setValueAtTime(0, Tend - 4 * bar);
      send.gain.linearRampToValueAtTime(0.7, Tend);
    } else if (next.move === "blend") {
      shelf.gain.setValueAtTime(0, Tend - 0.01);
      shelf.gain.linearRampToValueAtTime(-30, Tend);
      hp.frequency.setValueAtTime(20, Tend);
      hp.frequency.exponentialRampToValueAtTime(1000, Tend + bar);
      gain.gain.setValueAtTime(g, Tend);
      gain.gain.linearRampToValueAtTime(0, Tend + bar);
      stopAt = Tend + bar + 0.05;
    } else if (next.move === "mashup") {
      // Keep only the beat and bass under the incoming song's top.
      lp.frequency.setValueAtTime(20000, Tend);
      lp.frequency.exponentialRampToValueAtTime(320, Tend + 0.25);
      gain.gain.setValueAtTime(g, Tend + PRE_BARS * bar - beat);
      gain.gain.linearRampToValueAtTime(0, Tend + PRE_BARS * bar);
      stopAt = Tend + PRE_BARS * bar + 0.05;
    } else {
      // Cut: throw the last beat into the echo, then out on the bar line.
      send.gain.setValueAtTime(0, Tend - beat);
      send.gain.linearRampToValueAtTime(0.9, Tend - 0.02);
      send.gain.linearRampToValueAtTime(0, Tend);
      gain.gain.setValueAtTime(g, Tend - 0.02);
      gain.gain.linearRampToValueAtTime(0, Tend);
    }

    const offset = sec.clipStart - (T - startAt) * t.rate;
    src.start(startAt, Math.max(0, offset), (stopAt - startAt) * t.rate);
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

  const kick = (t: number, lvl: number) => {
    const s0 = Math.round(t * sr);
    const n = Math.round(0.4 * sr);
    let phase = 0;
    for (let i = 0; i < n && s0 + i < dr.length; i++) {
      const x = i / sr;
      const f = x < 0.12 ? 150 * Math.pow(45 / 150, x / 0.12) : 45;
      phase += (2 * Math.PI * f) / sr;
      dr[s0 + i] += lvl * Math.exp(-x * 19.7) * Math.sin(phase);
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
    const t = tracks[v.track];
    const T = v.at;
    const Tend = T + V;
    const synced = t.synced;
    const next = visits[idx + 1];

    const depth =
      !synced || v.stage === "warm" || v.stage === "outro"
        ? 0
        : (v.stage === "peak" ? 0.35 : 0.2) * level;
    if (depth > 0) for (let b = T; b < Tend - 1e-3; b += beat) pumpAt(b, depth);

    if (synced && energy !== "lounge" && (v.stage === "build" || v.stage === "peak")) {
      const kLvl = (v.stage === "peak" ? 0.65 : 0.45) * level;
      for (let b = T; b < Tend - 1e-3; b += beat) kick(b, kLvl);
      for (let b = T + beat / 2; b < Tend; b += beat) hat(b, 0.13 * level);
      if (v.stage === "peak") for (let b = T + beat; b < Tend; b += 2 * beat) clap(b, 0.3 * level);
    } else if (synced && energy === "lounge" && v.stage === "peak") {
      for (let b = T; b < Tend - 1e-3; b += beat) kick(b, 0.3);
    }

    // Big moment into the next visit: a riser before, a drop on the one.
    if (next && energy !== "lounge") {
      const rising =
        (next.stage === "peak" && v.stage !== "peak") ||
        next.move === "cut" ||
        (next.stage === "peak" && idx % 2 === 1);
      if (rising) {
        const len = (next.stage === "peak" && v.stage !== "peak" ? 8 : 4) * bar;
        riser(Tend - len, Tend, 0.22 * level + 0.05);
        drop(Tend, level);
      }
    }
  });

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
