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
//        blend    — the next part creeps in bass-cut for 4 bars; on the "one"
//                   the basses swap and the old part is filtered away;
//        mash-up  — for 4 bars the old part keeps only its beat and bass under
//                   the new part's top;
//        cut      — echo throw out, slam in (always for a song whose tempo
//                   can't lock, and after a loop build);
//        loop build, breakdown, filter rise, riser, drop, kick, hats, claps,
//        and sidechain pump, wherever the script asks for them.
//
// It all renders in an OfflineAudioContext: faster than real time, and never a
// second live audio element beside the global player (the one-<audio>
// invariant in player-provider stays untouched).

import { decodeRange, MIX_SAMPLE_RATE, type AdtsIndex } from "./load";
import { shiftKey, type MusicalKey } from "./key";
import { barSeconds, chooseRate, type Energy, type Fx, type Move, type SetScript } from "./script";
import { refineStart, type Structure } from "./structure";
import type { Tempo } from "./tempo";

export type { Energy, MixMinutes, Move } from "./script";

export const MIN_TRACKS = 2;
export const MAX_TRACKS = 6;
// How much of each song to read. A long song (no length cap, CLAUDE.md Rule 4)
// is still fully usable; the Mixer picks its parts from the first 8 minutes,
// which keeps a phone's memory in bounds.
export const LOAD_SECONDS = 480;

const PRE_BARS = 4; // audio kept before a part, for blends
const POST_BARS = 4; // audio kept after it, for mash-ups and filter-outs
const TAIL_SECONDS = 4;

// What the Mixer keeps of a song after its first listen: the analysis and the
// compressed audio. The decoded PCM is let go straight away.
export type SongAnalysis = {
  title: string;
  tempo: Tempo;
  structure: Structure;
  key: MusicalKey;
  duration: number;
  adts: AdtsIndex;
};

export type Part = { clip: AudioBuffer; start: number; rms: number };

export type PreparedSong = {
  title: string;
  rate: number;
  synced: boolean;
  bpm: number;
  key: MusicalKey; // after the tempo lock's pitch change
  parts: Map<string, Part>; // "phrase:bars" → decoded audio
};

export type PlannedVisit = {
  song: number;
  phrase: number;
  bars: number;
  at: number; // output seconds
  dur: number;
  move: Move;
  fx: Fx;
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

const partKey = (phrase: number, bars: number) => `${phrase}:${bars}`;

export async function prepareSongs(
  songs: SongAnalysis[],
  script: SetScript,
  onProgress?: (fraction: number) => void,
): Promise<PreparedSong[]> {
  const master = songs[script.visits[0].song].tempo.bpm;
  const mBar = barSeconds(master);
  const out: PreparedSong[] = songs.map((s) => {
    const { rate, synced } = chooseRate(master, s.tempo.bpm);
    return { title: s.title, rate, synced, bpm: s.tempo.bpm, key: shiftKey(s.key, rate), parts: new Map() };
  });
  const jobs = [...new Map(script.visits.map((v) => [`${v.song}:${partKey(v.phrase, v.bars)}`, v])).values()];
  let done = 0;
  for (const v of jobs) {
    const s = songs[v.song];
    const p = out[v.song];
    const srcBar = mBar * p.rate;
    const ph = s.structure.phrases[v.phrase];
    const pre = PRE_BARS * srcBar;
    const len = (PRE_BARS + v.bars + POST_BARS) * srcBar;
    const from = ph.start - pre;
    const dec = await decodeRange(s.adts, Math.max(0, from), len + Math.min(0, from));
    if (!dec) continue;
    // Where the part's first downbeat sits in the decoded audio, fine-tuned.
    const approx = dec.lead + (ph.start - Math.max(0, from));
    const exact = refineStart(dec.buffer, approx, s.structure.beat);
    // Copy into a clip whose PRE_BARS mark is exactly the downbeat.
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
    p.parts.set(partKey(v.phrase, v.bars), {
      clip,
      start: pre,
      rms: Math.max(1e-4, (s.structure.phrases[v.phrase].rms + (s.structure.phrases[v.phrase + 1]?.rms ?? s.structure.phrases[v.phrase].rms)) / 2),
    });
    done++;
    onProgress?.(done / jobs.length);
  }
  return out;
}

export function planTimes(script: SetScript, songs: SongAnalysis[], prepared: PreparedSong[]): MixPlan {
  const master = songs[script.visits[0].song].tempo.bpm;
  const mBar = barSeconds(master);
  let at = 0;
  const visits: PlannedVisit[] = [];
  for (const v of script.visits) {
    if (!prepared[v.song].parts.has(partKey(v.phrase, v.bars))) continue;
    const dur = v.bars * mBar;
    visits.push({
      ...v,
      at,
      dur,
      sourceStart: songs[v.song].structure.phrases[v.phrase].start,
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
): Promise<AudioBuffer> {
  const total = plan.end + TAIL_SECONDS;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * MIX_SAMPLE_RATE), MIX_SAMPLE_RATE);
  const beat = 60 / plan.bpm;
  const bar = beat * 4;
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
  const partOf = (v: PlannedVisit) => prepared[v.song].parts.get(partKey(v.phrase, v.bars))!;
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
    const rate = song.rate;

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
    shelf.connect(hp).connect(lp).connect(gain).connect(music);
    const send = ctx.createGain();
    send.gain.value = 0;
    gain.connect(send).connect(echoSend);

    // Clip time for an output time inside this part.
    const clipAt = (t: number) => part.start + (t - T) * rate;
    const play = (from: number, to: number, clipFrom: number) => {
      const src = ctx.createBufferSource();
      src.buffer = part.clip;
      src.playbackRate.value = rate;
      src.connect(shelf);
      src.start(from, Math.max(0, clipFrom), Math.max(0.01, (to - from) * rate));
    };

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
      gain.gain.setValueAtTime(g, T);
      hp.frequency.setValueAtTime(300, T);
      hp.frequency.setValueAtTime(300, T + PRE_BARS * bar - 0.01);
      hp.frequency.linearRampToValueAtTime(20, T + PRE_BARS * bar);
    } else {
      gain.gain.setValueAtTime(v.move === "open" ? 0 : g, T);
      if (v.move === "open") gain.gain.linearRampToValueAtTime(g, T + bar);
    }

    // -- inside the part --
    if (v.fx.breakdown) {
      // Bass out until the last bar, then it swells back for what follows.
      shelf.gain.setValueAtTime(0, T + 0.01);
      shelf.gain.linearRampToValueAtTime(-24, T + beat);
      shelf.gain.setValueAtTime(-24, Tend - bar);
      shelf.gain.linearRampToValueAtTime(0, Tend - 0.02);
    }
    const loopFrom = v.fx.loopBuild ? Tend - 4 * bar : Tend;
    if (v.fx.filterRise || v.fx.loopBuild) {
      const from = v.fx.loopBuild ? loopFrom : Math.max(T + PRE_BARS * bar, Tend - 8 * bar);
      hp.frequency.setValueAtTime(20, from);
      hp.frequency.exponentialRampToValueAtTime(700, Tend - 0.03);
      hp.frequency.setValueAtTime(20, Tend);
    }

    // -- how it goes out (decided by the next part's move) --
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
      lp.frequency.setValueAtTime(20000, Tend);
      lp.frequency.exponentialRampToValueAtTime(320, Tend + 0.25);
      gain.gain.setValueAtTime(g, Tend + PRE_BARS * bar - beat);
      gain.gain.linearRampToValueAtTime(0, Tend + PRE_BARS * bar);
      stopAt = Tend + PRE_BARS * bar + 0.05;
    } else {
      send.gain.setValueAtTime(0, Tend - beat);
      send.gain.linearRampToValueAtTime(0.9, Tend - 0.02);
      send.gain.linearRampToValueAtTime(0, Tend);
      gain.gain.setValueAtTime(g, Tend - 0.02);
      gain.gain.linearRampToValueAtTime(0, Tend);
    }

    // -- the audio itself --
    play(startAt, Math.min(stopAt, v.fx.loopBuild ? loopFrom : stopAt), clipAt(startAt));
    if (v.fx.loopBuild) {
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
    const song = prepared[v.song];
    const T = v.at;
    const Tend = T + v.dur;
    const next = visits[idx + 1];
    const fx = v.fx;

    if (fx.pump && song.synced) {
      const depth = (fx.claps ? 0.35 : 0.22) * level;
      for (let b = T; b < Tend - 1e-3; b += beat) pumpAt(b, depth);
    }
    if (song.synced) {
      const kLvl = (fx.claps ? 0.65 : 0.5) * level;
      // During a loop build the kick doubles up with the stutter.
      const loopFrom = fx.loopBuild ? Tend - 4 * bar : Tend;
      if (fx.kick) {
        for (let b = T; b < loopFrom - 1e-3; b += beat) kick(b, kLvl);
        if (fx.loopBuild) {
          for (let b = loopFrom; b < Tend - 2 * bar - 1e-3; b += beat) kick(b, kLvl);
          for (let b = Tend - 2 * bar; b < Tend - bar - 1e-3; b += beat / 2) kick(b, kLvl * 0.9);
          for (let b = Tend - bar; b < Tend - 1e-3; b += beat / 4) kick(b, kLvl * 0.8);
        }
      }
      if (fx.hats) for (let b = T + beat / 2; b < Tend; b += beat) hat(b, 0.13 * level);
      if (fx.claps) for (let b = T + beat; b < Tend; b += 2 * beat) clap(b, 0.3 * level);
    }
    if (next && (fx.riser || fx.loopBuild)) {
      const len = (fx.loopBuild ? 4 : Math.min(8, v.bars / 2)) * bar;
      riser(Tend - len, Tend, 0.22 * level + 0.05);
    }
    if (next && (fx.drop || fx.loopBuild)) drop(Tend, level);
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
