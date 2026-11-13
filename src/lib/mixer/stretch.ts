// Key lock: change a clip's tempo without changing its pitch.
//
// Locking two songs to one tempo by playing one faster or slower (the way a
// record speeds up) also moves its pitch: 3% faster is half a semitone sharp.
// Half a semitone is the worst possible distance between two songs in the same
// key, so every overlap sounded sour. DJ decks solve this with "key lock"
// (master tempo); this is the same idea, done offline before the mix renders.
//
// Method: WSOLA (waveform-similarity overlap-add). The output is built from
// short Hann-windowed grains of the input, half overlapped. Each grain is read
// from about where the tempo change says it should be, nudged by up to ~12 ms
// to the spot whose waveform best continues the previous grain, so the seams
// line up instead of phasing. At the small changes a DJ mix needs (a few
// percent) it is transparent on music; drums keep their attack.

const N = 2048; // grain length (~46 ms at 44.1 kHz)
const HS = N / 2; // output hop: half-overlapped Hann grains sum to one
const TOL = 512; // how far a grain may move to find its best seam (~12 ms)
const CMP = 512; // how much of the seam is compared
const STRIDE = 4; // compare every 4th sample: plenty for a seam, 4× faster

const WINDOW = (() => {
  const w = new Float32Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  return w;
})();

// `rate` > 1 plays faster (shorter output), < 1 slower, exactly as a
// playbackRate would, but the pitch stays where it was.
export function stretchBuffer(buf: AudioBuffer, rate: number): AudioBuffer {
  return stretchWithGrains(buf, rate).out;
}

// The same, also returning where each grain was read from, so the song's
// stems (stems.ts) can be stretched with exactly the same grains and still add
// up to the song sample for sample.
export function stretchWithGrains(buf: AudioBuffer, rate: number): { out: AudioBuffer; grains: Int32Array } {
  const sr = buf.sampleRate;
  const chans = buf.numberOfChannels;
  const inLen = buf.length;
  const outLen = Math.max(1, Math.round(inLen / rate));
  const out = new AudioBuffer({ numberOfChannels: chans, length: outLen, sampleRate: sr });
  const src: Float32Array[] = [];
  const dst: Float32Array[] = [];
  for (let c = 0; c < chans; c++) {
    src.push(buf.getChannelData(c));
    dst.push(out.getChannelData(c));
  }
  // The seam search listens to a mono mix.
  const mono = new Float32Array(inLen);
  for (let c = 0; c < chans; c++) {
    const s = src[c];
    for (let i = 0; i < inLen; i++) mono[i] += s[i] / chans;
  }
  const norm = new Float32Array(outLen);
  const ha = HS * rate; // input hop

  const grains = new Int32Array(Math.ceil(outLen / HS) + 1);
  let prev = -1; // where the previous grain was read from
  for (let k = 0; ; k++) {
    const o = k * HS;
    if (o >= outLen) break;
    const nominal = Math.round(k * ha);
    let pos = nominal;
    if (prev >= 0) {
      // The ideal next grain continues the previous one seamlessly.
      const want = prev + HS;
      let best = -Infinity;
      const lo = Math.max(0, nominal - TOL);
      const hi = Math.min(inLen - N, nominal + TOL);
      // Coarse search, then a fine one around the winner.
      const score = (p: number) => {
        let s = 0;
        for (let i = 0; i < CMP; i += STRIDE) {
          const a = want + i;
          if (a >= inLen) break;
          s += mono[a] * mono[p + i];
        }
        return s;
      };
      let coarse = nominal;
      for (let p = lo; p <= hi; p += 8) {
        const s = score(p);
        if (s > best) {
          best = s;
          coarse = p;
        }
      }
      pos = coarse;
      for (let p = Math.max(lo, coarse - 8); p <= Math.min(hi, coarse + 8); p++) {
        const s = score(p);
        if (s > best) {
          best = s;
          pos = p;
        }
      }
      if (hi < lo) pos = Math.max(0, Math.min(inLen - 1, nominal));
    }
    prev = pos;
    grains[k] = pos;
    for (let i = 0; i < N; i++) {
      const oi = o + i;
      if (oi >= outLen) break;
      const ii = pos + i;
      if (ii >= inLen) break;
      const w = WINDOW[i];
      norm[oi] += w;
      for (let c = 0; c < chans; c++) dst[c][oi] += src[c][ii] * w;
    }
  }
  // Even out the very start and end, where fewer grains overlap.
  for (let i = 0; i < outLen; i++) {
    const n = norm[i];
    if (n > 1e-3 && Math.abs(n - 1) > 1e-3) for (let c = 0; c < chans; c++) dst[c][i] /= n;
  }
  return { out, grains };
}

// Replay recorded grains over another signal on the same input timeline, for
// output samples [o0, o1) only. `input` holds input samples starting at
// `inOffset`; anything outside it reads as silence. The result's sample 0 is
// output sample o0.
export function applyGrains(
  input: AudioBuffer,
  inOffset: number,
  grains: Int32Array,
  o0: number,
  o1: number,
): AudioBuffer {
  const sr = input.sampleRate;
  const chans = input.numberOfChannels;
  const len = Math.max(1, o1 - o0);
  const out = new AudioBuffer({ numberOfChannels: chans, length: len, sampleRate: sr });
  const src: Float32Array[] = [];
  const dst: Float32Array[] = [];
  for (let c = 0; c < chans; c++) {
    src.push(input.getChannelData(c));
    dst.push(out.getChannelData(c));
  }
  const norm = new Float32Array(len);
  const k0 = Math.max(0, Math.floor((o0 - N) / HS));
  for (let k = k0; k < grains.length; k++) {
    const o = k * HS;
    if (o >= o1) break;
    const pos = grains[k] - inOffset;
    for (let i = 0; i < N; i++) {
      const oi = o + i - o0;
      if (oi < 0) continue;
      if (oi >= len) break;
      const w = WINDOW[i];
      norm[oi] += w;
      const ii = pos + i;
      if (ii < 0 || ii >= input.length) continue;
      for (let c = 0; c < chans; c++) dst[c][oi] += src[c][ii] * w;
    }
  }
  for (let i = 0; i < len; i++) {
    const n = norm[i];
    if (n > 1e-3 && Math.abs(n - 1) > 1e-3) for (let c = 0; c < chans; c++) dst[c][i] /= n;
  }
  return out;
}

// Below this a tempo change is inaudible as pitch (under 1/30 of a semitone)
// and the clip plays as it is.
export const KEY_LOCK_MIN = 0.002;
