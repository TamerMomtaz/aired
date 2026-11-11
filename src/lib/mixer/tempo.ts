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

export function detectTempo(buf: AudioBuffer, maxSeconds = 60): Tempo {
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
  const beatFrames = (60 * fps) / bpm;

  // Phase: the offset where onsets stack up hardest on the grid.
  let bestPhase = 0;
  let bestPhaseScore = -Infinity;
  const steps = Math.ceil(beatFrames);
  for (let o = 0; o < steps; o++) {
    let s = 0;
    for (let t = o; t < n; t += beatFrames) {
      const i = Math.round(t);
      // Allow a one-frame wobble on either side.
      s += Math.max(env[i] ?? 0, env[i - 1] ?? 0, env[i + 1] ?? 0);
    }
    if (s > bestPhaseScore) {
      bestPhaseScore = s;
      bestPhase = o;
    }
  }

  const mean = count > 0 ? sum / count : 0;
  const confidence = mean > 0 ? Math.max(0, Math.min(1, (bestScore / mean - 1) / 1.5)) : 0;

  // Refine: snap each predicted beat to its strongest nearby onset, then fit a
  // straight line through those times. A 0.2% tempo error drifts a full eighth
  // of a second over a minute — audible as flamming kicks — so the coarse
  // autocorrelation reading is never good enough on its own.
  const fit = fitGrid(env, bestPhase, beatFrames);
  const finalBeat = fit ? fit.period : beatFrames;
  let phase = fit ? fit.phase : bestPhase;
  while (phase < 0) phase += finalBeat;
  while (phase >= finalBeat) phase -= finalBeat;
  return { bpm: (60 * fps) / finalBeat, firstBeat: phase / fps, confidence };
}

function fitGrid(
  env: Float32Array,
  phase: number,
  period: number,
): { phase: number; period: number } | null {
  const reach = Math.max(2, Math.round(period * 0.12));
  const ks: number[] = [];
  const ts: number[] = [];
  const ws: number[] = [];
  let p = phase;
  let per = period;
  // Three passes: each searches around the grid the previous one fitted.
  for (let pass = 0; pass < 3; pass++) {
    ks.length = ts.length = ws.length = 0;
    for (let k = 0; ; k++) {
      const c = p + k * per;
      if (c + reach >= env.length - 1) break;
      let bi = -1;
      let bv = 0;
      for (let i = Math.max(1, Math.round(c) - reach); i <= Math.round(c) + reach; i++) {
        if (env[i] > bv) {
          bv = env[i];
          bi = i;
        }
      }
      if (bi < 0 || bv <= 0) continue;
      const y0 = env[bi - 1];
      const y2 = env[bi + 1];
      const d = y0 - 2 * bv + y2;
      const off = d !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / d)) : 0;
      ks.push(k);
      ts.push(bi + off);
      ws.push(bv);
    }
    if (ks.length < 8) return null;
    // Keep the stronger half: weak "beats" are usually off-grid noise.
    const sorted = [...ws].sort((x, y) => x - y);
    const cut = sorted[Math.floor(sorted.length / 2)];
    let sw = 0, sk = 0, st = 0, skk = 0, skt = 0;
    for (let i = 0; i < ks.length; i++) {
      if (ws[i] < cut) continue;
      const w = ws[i];
      sw += w;
      sk += w * ks[i];
      st += w * ts[i];
      skk += w * ks[i] * ks[i];
      skt += w * ks[i] * ts[i];
    }
    const den = sw * skk - sk * sk;
    if (den <= 0) return null;
    const slope = (sw * skt - sk * st) / den;
    const icpt = (st - slope * sk) / sw;
    // Never let the fit wander off the coarse reading by more than 3%.
    if (Math.abs(slope / period - 1) > 0.03) return null;
    per = slope;
    p = icpt;
  }
  return { phase: p, period: per };
}
