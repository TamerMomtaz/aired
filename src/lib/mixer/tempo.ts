// Find a song's tempo and where its beats fall, so two decks can be locked
// together the way a DJ does by ear.
//
// Method: an onset envelope (how sharply the low-mid energy rises, ~172 frames a
// second), autocorrelated across the club range to find the beat period, then a
// comb search for the phase — the offset at which the strongest onsets line up
// on that period. AI-rendered songs hold a very steady tempo, which is exactly
// the case this simple method is good at.

const HOP = 256; // samples per envelope frame (~5.8 ms at 44.1 kHz)

export type Tempo = {
  bpm: number;
  // Seconds from the start of the buffer to the first beat on the grid.
  firstBeat: number;
  // 0..1 — how clearly the period stood out. Low means "no steady beat found".
  confidence: number;
};

function onsetEnvelope(buf: AudioBuffer, maxSeconds: number): Float32Array {
  const sr = buf.sampleRate;
  const n = Math.min(buf.length, Math.floor(maxSeconds * sr));
  const l = buf.getChannelData(0);
  const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
  const frames = Math.floor(n / HOP);
  const env = new Float32Array(frames);

  // One-pole low-pass (~200 Hz) so the kick and bass drive the envelope.
  const a = Math.exp((-2 * Math.PI * 200) / sr);
  let lp = 0;
  let prev = 0;
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const base = f * HOP;
    for (let i = 0; i < HOP; i++) {
      const x = (l[base + i] + r[base + i]) * 0.5;
      lp = (1 - a) * x + a * lp;
      e += lp * lp;
    }
    const v = Math.log1p(e * 1000);
    env[f] = Math.max(0, v - prev);
    prev = v;
  }
  return env;
}

export function detectTempo(buf: AudioBuffer, maxSeconds = 480): Tempo {
  const fps = buf.sampleRate / HOP;
  const env = onsetEnvelope(buf, maxSeconds);
  const n = env.length;
  if (n < fps * 8) return { bpm: 120, firstBeat: 0, confidence: 0 };

  const minLag = Math.floor((fps * 60) / 180);
  const maxLag = Math.ceil((fps * 60) / 70);
  let best = minLag;
  let bestScore = -Infinity;
  let sum = 0;
  let count = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
    s /= n - lag;
    // Gentle preference for the 110–135 BPM home of club music, so a half- or
    // double-time reading doesn't win on a near tie.
    const bpm = (60 * fps) / lag;
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 124) / 0.6, 2));
    const score = s * (0.6 + 0.4 * w);
    sum += score;
    count++;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }

  // Refine the period to sub-frame precision with a parabola through the peak.
  const ac = (lag: number) => {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
    return s / (n - lag);
  };
  const y0 = ac(best - 1);
  const y1 = ac(best);
  const y2 = ac(best + 1);
  const denom = y0 - 2 * y1 + y2;
  const shift = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom)) : 0;
  const period = best + shift;
  let bpm = (60 * fps) / period;
  while (bpm < 85) bpm *= 2;
  while (bpm > 175) bpm /= 2;

  const mean = count > 0 ? sum / count : 0;
  const confidence = mean > 0 ? Math.max(0, Math.min(1, (bestScore / mean - 1) / 1.5)) : 0;

  // Refine over the whole song: try tempos within ±1.5% of the reading in
  // 0.01 BPM steps, and keep the one whose grid stacks the most onsets. A 0.2%
  // tempo error drifts a full eighth of a second over a minute, audible as
  // flamming kicks, so the coarse reading is never good enough on its own.
  // (Snapping single beats and fitting a line was tried first: on real songs
  // with off-beat bass and triplet parts it wandered by up to 0.5%.)
  const fine = combRefine(env, bpm, fps);
  const finalBeat = (60 * fps) / fine.bpm;
  let phase = fine.phase;
  while (phase < 0) phase += finalBeat;
  while (phase >= finalBeat) phase -= finalBeat;
  return { bpm: (60 * fps) / finalBeat, firstBeat: phase / fps, confidence };
}

function combRefine(env: Float32Array, bpm: number, fps: number): { bpm: number; phase: number } {
  const PHASES = 48;
  let best = { score: -1, bpm, phase: 0 };
  const lo = Math.round(bpm * 0.985 * 100);
  const hi = Math.round(bpm * 1.015 * 100);
  for (let c = lo; c <= hi; c++) {
    const b = c / 100;
    const per = (60 * fps) / b;
    for (let k = 0; k < PHASES; k++) {
      const o = (k * per) / PHASES;
      let s = 0;
      for (let t = o; t < env.length - 1; t += per) s += env[Math.round(t)];
      if (s > best.score) best = { score: s, bpm: b, phase: o };
    }
  }
  // Settle the phase to the frame: the offset in ±half a phase step that
  // stacks hardest at the chosen tempo.
  const per = (60 * fps) / best.bpm;
  const step = per / PHASES;
  let phase = best.phase;
  let top = -1;
  for (let d = -step / 2; d <= step / 2; d += 0.25) {
    let s = 0;
    for (let t = best.phase + d; t < env.length - 1; t += per) if (t >= 0) s += env[Math.round(t)];
    if (s > top) {
      top = s;
      phase = best.phase + d;
    }
  }
  return { bpm: best.bpm, phase };
}
