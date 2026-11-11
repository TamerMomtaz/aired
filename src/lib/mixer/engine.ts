// The AIRED Mixer engine: two decks in, one club mix out.
//
// Everything is rendered in an OfflineAudioContext — faster than real time, no
// second live audio element fighting the global player (the one-<audio>
// invariant in player-provider stays untouched), and the result is a plain
// AudioBuffer we can preview, download, and later publish.
//
// The shape of the mix is what a club DJ does with two records:
//   1. Deck A plays; its beat grid becomes the master clock.
//   2. Deck B is pitched (vinyl-style rate change) to A's tempo and dropped in on
//      a bar line, bass cut, faded up underneath.
//   3. A riser builds; on the drop the basses SWAP — B's comes in, A's goes out —
//      and A is filtered away.
//   4. B carries on, then the mix echoes out.
// "Additions" ride on the same grid: a synthesized kick that glues the blend, an
// off-beat hat, claps, the riser, the drop impact, and sidechain pumping on the
// music — so the two songs breathe like one track.

import type { LoadedDeck } from "./load";
import { MIX_SAMPLE_RATE } from "./load";
import type { Tempo } from "./tempo";

export type Energy = "lounge" | "club" | "peak";
export type MixLength = "short" | "long";

export const SOLO_SECONDS: Record<MixLength, number> = { short: 60, long: 120 };
const TRANSITION_BARS: Record<Energy, number> = { lounge: 32, club: 16, peak: 8 };
const OUTRO_BARS = 8;
const TAIL_SECONDS = 3;
// How far Deck B may be pitched to meet Deck A. Past this the blend would sound
// like a different song, so we fall back to an un-synced filter blend.
const MAX_NUDGE = 0.12;

// How much audio to fetch for each deck before we know the tempi. Generous
// enough for the longest transition (32 bars at 85 BPM ≈ 90 s) and the most
// B can be slowed down.
export function deckWindowSeconds(length: MixLength): { a: number; b: number } {
  const solo = SOLO_SECONDS[length];
  return { a: solo + 100, b: (solo + 100 + 30) * (1 + MAX_NUDGE) };
}

export type MixPlan = {
  bpm: number;
  synced: boolean;
  // Deck B's playback rate (1 = untouched). 1.031 → "+3.1%".
  rateB: number;
  transitionStart: number;
  transitionBars: number;
  dropAt: number;
  end: number;
  bpmA: number;
  bpmB: number;
};

export type MixResult = { buffer: AudioBuffer; plan: MixPlan };

function chooseRate(bpmA: number, bpmB: number): { rate: number; synced: boolean } {
  const ratio = bpmA / bpmB;
  const candidates = [ratio, ratio * 2, ratio / 2];
  let best = candidates[0];
  for (const c of candidates) if (Math.abs(c - 1) < Math.abs(best - 1)) best = c;
  if (Math.abs(best - 1) <= MAX_NUDGE) return { rate: best, synced: true };
  return { rate: 1, synced: false };
}

function noiseBuffer(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export function planMix(
  a: LoadedDeck,
  b: LoadedDeck,
  ta: Tempo,
  tb: Tempo,
  energy: Energy,
  length: MixLength,
): MixPlan {
  const { rate, synced } = chooseRate(ta.bpm, tb.bpm);
  // Deck A's tempo is the master clock.
  const bpm = ta.bpm;
  const bar = (60 / bpm) * 4;

  let bars = synced ? TRANSITION_BARS[energy] : 8;
  // A must still be playing through the whole transition.
  while (bars > 4 && ta.firstBeat + bar * (bars + 2) > a.seconds) bars /= 2;
  const L = bars * bar;

  const desired = SOLO_SECONDS[length];
  let k = Math.max(1, Math.round((desired - ta.firstBeat) / bar));
  while (k > 1 && ta.firstBeat + k * bar + L > a.seconds) k--;
  const transitionStart = ta.firstBeat + k * bar;
  const dropAt = transitionStart + L / 2;

  // B's audio left after its first beat, in output seconds.
  const bOutputAvail = (b.seconds - tb.firstBeat) / rate;
  const barB = synced ? bar : (60 / tb.bpm) * 4;
  let soloBars = Math.round(desired / barB);
  while (soloBars > OUTRO_BARS && L + soloBars * barB > bOutputAvail) soloBars--;
  const end = transitionStart + L + soloBars * barB;

  return {
    bpm,
    synced,
    rateB: rate,
    transitionStart,
    transitionBars: bars,
    dropAt,
    end,
    bpmA: ta.bpm,
    bpmB: tb.bpm,
  };
}

export async function renderMix(
  a: LoadedDeck,
  b: LoadedDeck,
  ta: Tempo,
  tb: Tempo,
  energy: Energy,
  plan: MixPlan,
): Promise<MixResult> {
  const total = plan.end + TAIL_SECONDS;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * MIX_SAMPLE_RATE), MIX_SAMPLE_RATE);
  const beat = 60 / plan.bpm;
  const { transitionStart: ts, dropAt } = plan;
  const L = plan.transitionBars * beat * 4;
  const tEnd = ts + L;
  const barOut = plan.synced ? beat * 4 : ((60 / tb.bpm) * 4) / plan.rateB;
  const outroStart = Math.max(tEnd, plan.end - OUTRO_BARS * barOut);
  const noise = noiseBuffer(ctx);

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

  // Outro: sweep the low end away and fade, while the echo tail rings on.
  masterHp.frequency.setValueAtTime(20, outroStart);
  masterHp.frequency.exponentialRampToValueAtTime(1200, plan.end);
  master.gain.setValueAtTime(0.85, outroStart);
  master.gain.linearRampToValueAtTime(0.0001, plan.end + TAIL_SECONDS);

  // ---- music bus with sidechain pump ------------------------------------
  const music = ctx.createGain();
  music.connect(master);
  const pumpDepth = energy === "peak" ? 0.4 : energy === "club" ? 0.22 : 0;
  // Pump only where the grid is trustworthy: everywhere when synced, only on
  // A's solo otherwise.
  const pumpUntil = plan.synced ? plan.end : ts;
  if (pumpDepth > 0) {
    for (let t = ta.firstBeat; t < pumpUntil; t += beat) {
      music.gain.setValueAtTime(1 - pumpDepth, t);
      music.gain.linearRampToValueAtTime(1, t + beat * 0.45);
    }
  }

  // Echo send (used to throw A out at the drop, and for the outro).
  const echoSend = ctx.createGain();
  echoSend.gain.value = 0;
  const delay = ctx.createDelay(2);
  delay.delayTime.value = beat * 0.75;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.42;
  const echoTone = ctx.createBiquadFilter();
  echoTone.type = "bandpass";
  echoTone.frequency.value = 1500;
  echoTone.Q.value = 0.6;
  echoSend.connect(delay);
  delay.connect(echoTone).connect(feedback).connect(delay);
  echoTone.connect(master);
  echoSend.gain.setValueAtTime(0, outroStart);
  echoSend.gain.linearRampToValueAtTime(0.6, plan.end);

  // ---- deck A -------------------------------------------------------------
  const srcA = ctx.createBufferSource();
  srcA.buffer = a.buffer;
  const bassA = ctx.createBiquadFilter();
  bassA.type = "lowshelf";
  bassA.frequency.value = 220;
  const hpA = ctx.createBiquadFilter();
  hpA.type = "highpass";
  hpA.frequency.value = 20;
  const gainA = ctx.createGain();
  srcA.connect(bassA).connect(hpA).connect(gainA).connect(music);
  const aThrow = ctx.createGain();
  aThrow.gain.value = 0;
  gainA.connect(aThrow).connect(echoSend);

  bassA.gain.setValueAtTime(0, 0);
  bassA.gain.setValueAtTime(0, dropAt - 0.01);
  bassA.gain.linearRampToValueAtTime(-30, dropAt);
  hpA.frequency.setValueAtTime(20, dropAt);
  hpA.frequency.exponentialRampToValueAtTime(900, tEnd);
  gainA.gain.setValueAtTime(1, dropAt);
  gainA.gain.linearRampToValueAtTime(0, tEnd);
  // Throw the last of A into the echo so it trails off over B.
  aThrow.gain.setValueAtTime(0, tEnd - beat * 4);
  aThrow.gain.linearRampToValueAtTime(0.8, tEnd - beat);
  aThrow.gain.linearRampToValueAtTime(0, tEnd);
  srcA.start(0, 0, tEnd + 0.05);

  // ---- deck B -------------------------------------------------------------
  const srcB = ctx.createBufferSource();
  srcB.buffer = b.buffer;
  srcB.playbackRate.value = plan.rateB;
  const bassB = ctx.createBiquadFilter();
  bassB.type = "lowshelf";
  bassB.frequency.value = 220;
  const gainB = ctx.createGain();
  srcB.connect(bassB).connect(gainB).connect(music);

  bassB.gain.setValueAtTime(-30, 0);
  bassB.gain.setValueAtTime(-30, dropAt - 0.01);
  bassB.gain.linearRampToValueAtTime(0, dropAt);
  gainB.gain.setValueAtTime(0, ts);
  gainB.gain.linearRampToValueAtTime(0.85, dropAt);
  gainB.gain.linearRampToValueAtTime(1, tEnd);
  srcB.start(ts, tb.firstBeat);

  // ---- additions on the grid ---------------------------------------------
  const drums = ctx.createGain();
  drums.gain.value = 1;
  drums.connect(master);

  const kickLevel = energy === "peak" ? 0.75 : energy === "club" ? 0.6 : 0.35;
  const kick = (t: number, level: number) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(drums);
    o.start(t);
    o.stop(t + 0.4);
  };
  const hat = (t: number, level: number) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 8000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    s.connect(f).connect(g).connect(drums);
    s.start(t, Math.random());
    s.stop(t + 0.08);
  };
  const clap = (t: number, level: number) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1400;
    f.Q.value = 0.9;
    const g = ctx.createGain();
    // Three quick flams then a tail — the shape that reads as hands.
    for (const [dt, v] of [
      [0, level],
      [0.012, level * 0.8],
      [0.024, level],
    ] as const) {
      g.gain.setValueAtTime(v, t + dt);
      g.gain.exponentialRampToValueAtTime(0.05 * level, t + dt + 0.01);
    }
    g.gain.setValueAtTime(level * 0.7, t + 0.034);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    s.connect(f).connect(g).connect(drums);
    s.start(t, Math.random());
    s.stop(t + 0.25);
  };

  if (plan.synced) {
    // The bridge beat: kicks through the blend (and the whole mix at peak).
    const kickFrom = energy === "peak" ? ta.firstBeat : ts;
    const kickTo = energy === "peak" ? outroStart : tEnd;
    let i = 0;
    for (let t = kickFrom; t < kickTo - 1e-3; t += beat, i++) {
      // Fade the bridge kick in over the first bar of the blend.
      const ramp = t < ts + beat * 4 && energy !== "peak" ? (t - ts) / (beat * 4) : 1;
      kick(t, kickLevel * Math.max(0.25, ramp));
    }
    if (energy !== "lounge") {
      for (let t = ts + beat / 2; t < tEnd; t += beat) hat(t, energy === "peak" ? 0.18 : 0.12);
    }
    if (energy === "peak") {
      // Claps on 2 and 4 from the drop to the outro.
      const first = dropAt + beat;
      for (let t = first; t < outroStart; t += beat * 2) clap(t, 0.35);
    }
  }

  if (energy !== "lounge") {
    // Riser: filtered noise climbing into the drop.
    const riseFrom = Math.max(ts, dropAt - Math.min(L / 2, beat * 16));
    const r = ctx.createBufferSource();
    r.buffer = noise;
    r.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 2.5;
    f.frequency.setValueAtTime(300, riseFrom);
    f.frequency.exponentialRampToValueAtTime(7000, dropAt);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, riseFrom);
    g.gain.exponentialRampToValueAtTime(energy === "peak" ? 0.35 : 0.22, dropAt - 0.02);
    g.gain.linearRampToValueAtTime(0, dropAt);
    r.connect(f).connect(g).connect(master);
    r.start(riseFrom);
    r.stop(dropAt + 0.05);

    // The drop: a sub boom and a crash.
    const boom = ctx.createOscillator();
    const bg = ctx.createGain();
    boom.frequency.setValueAtTime(70, dropAt);
    boom.frequency.exponentialRampToValueAtTime(38, dropAt + 1);
    bg.gain.setValueAtTime(energy === "peak" ? 0.8 : 0.55, dropAt);
    bg.gain.exponentialRampToValueAtTime(0.001, dropAt + 1.4);
    boom.connect(bg).connect(drums);
    boom.start(dropAt);
    boom.stop(dropAt + 1.5);

    const crash = ctx.createBufferSource();
    crash.buffer = noise;
    const cf = ctx.createBiquadFilter();
    cf.type = "highpass";
    cf.frequency.value = 3500;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.3, dropAt);
    cg.gain.exponentialRampToValueAtTime(0.001, dropAt + 1.8);
    crash.connect(cf).connect(cg).connect(master);
    crash.start(dropAt);
    crash.stop(dropAt + 1.9);
  }

  const rendered = await ctx.startRendering();
  normalize(rendered, 0.89); // ≈ −1 dBFS peak
  return { buffer: rendered, plan };
}

function normalize(buf: AudioBuffer, target: number) {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const v = Math.abs(d[i]);
      if (v > peak) peak = v;
    }
  }
  if (peak <= 0) return;
  const k = target / peak;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
}
