// Hear a song's musical key, so the Mixer can mix HARMONICALLY: put songs next
// to each other whose keys sit close on the Camelot wheel, the way club DJs do,
// so a blend sounds like one piece of music instead of two clashing ones.
//
// Method: a chromagram (how much of each of the 12 pitch classes is sounding)
// from short FFT frames across the song, compared against the Krumhansl–Kessler
// major and minor key profiles. The best-correlating of the 24 keys wins.

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
// Camelot number for each tonic, major (B side) and minor (A side).
const CAMELOT_MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const CAMELOT_MINOR = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];
const PROFILE_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const PROFILE_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export type MusicalKey = {
  tonic: number; // 0 = C … 11 = B
  minor: boolean;
  name: string; // "A minor"
  camelot: string; // "8A"
  confidence: number; // 0..1
};

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

function correlate(a: number[], b: number[]): number {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export function keyFromTonic(tonic: number, minor: boolean, confidence = 1): MusicalKey {
  const t = ((tonic % 12) + 12) % 12;
  return {
    tonic: t,
    minor,
    name: `${NAMES[t]} ${minor ? "minor" : "major"}`,
    camelot: `${minor ? CAMELOT_MINOR[t] : CAMELOT_MAJOR[t]}${minor ? "A" : "B"}`,
    confidence,
  };
}

export function detectKey(buf: AudioBuffer, maxSeconds = 150): MusicalKey {
  const sr = buf.sampleRate;
  const DEC = 4; // analyse at ~11 kHz: plenty for pitch, 4× less work
  const fsr = sr / DEC;
  const N = 4096;
  const l = buf.getChannelData(0);
  const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
  const total = Math.min(buf.length, Math.floor(maxSeconds * sr));
  const mono = new Float64Array(Math.floor(total / DEC));
  for (let i = 0; i < mono.length; i++) {
    let s = 0;
    for (let k = 0; k < DEC; k++) s += l[i * DEC + k] + r[i * DEC + k];
    mono[i] = s / (2 * DEC);
  }

  // Map FFT bins to pitch classes once (55 Hz – 2 kHz: bass line to melody).
  const binPc = new Int8Array(N / 2).fill(-1);
  for (let k = 1; k < N / 2; k++) {
    const f = (k * fsr) / N;
    if (f < 55 || f > 2000) continue;
    const midi = 69 + 12 * Math.log2(f / 440);
    binPc[k] = ((Math.round(midi) % 12) + 12) % 12;
  }

  const chroma = new Array(12).fill(0);
  const hop = Math.floor(fsr * 0.5);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let start = 0; start + N <= mono.length; start += hop) {
    for (let i = 0; i < N; i++) {
      re[i] = mono[start + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    const frame = new Array(12).fill(0);
    for (let k = 1; k < N / 2; k++) {
      const pc = binPc[k];
      if (pc < 0) continue;
      frame[pc] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    }
    // Normalize each frame so loud passages don't drown quiet ones.
    const m = Math.max(...frame);
    if (m > 0) for (let p = 0; p < 12; p++) chroma[p] += frame[p] / m;
  }

  let best = { tonic: 0, minor: false, score: -2 };
  let second = -2;
  for (let t = 0; t < 12; t++) {
    for (const minor of [false, true]) {
      const prof = minor ? PROFILE_MINOR : PROFILE_MAJOR;
      const rotated = prof.map((_, i) => prof[(i - t + 12) % 12]);
      const s = correlate(chroma, rotated);
      if (s > best.score) {
        second = best.score;
        best = { tonic: t, minor, score: s };
      } else if (s > second) second = s;
    }
  }
  const confidence = Math.max(0, Math.min(1, (best.score - second) * 8));
  return keyFromTonic(best.tonic, best.minor, confidence);
}

// Changing playback rate (how the Mixer locks tempo) also moves the key.
export function shiftKey(key: MusicalKey, rate: number): MusicalKey {
  const semis = Math.round(12 * Math.log2(rate));
  return semis === 0 ? key : keyFromTonic(key.tonic + semis, key.minor, key.confidence);
}

// Steps apart on the Camelot wheel: 0 = same key, 1 = a perfect neighbour
// (one step around, or the relative major/minor), 2+ = increasingly tense.
export function camelotDistance(a: MusicalKey, b: MusicalKey): number {
  const na = parseInt(a.camelot, 10);
  const nb = parseInt(b.camelot, 10);
  const around = Math.min((na - nb + 12) % 12, (nb - na + 12) % 12);
  const side = a.minor === b.minor ? 0 : 1;
  if (around === 0) return side;
  return around + side;
}

// Two keys that sound sour on top of each other: 3+ steps apart on the wheel,
// and both keys actually heard. A key read with little confidence (a song with
// hand drums and few held notes) is a guess, and a guess must not stop two
// songs from blending: that turned every switch in Tee's mix of 0013 and 0118
// into a hard cut, over a 3% key reading.
export const KEY_SURE = 0.3;
export function keysClash(a: MusicalKey, b: MusicalKey): boolean {
  return a.confidence >= KEY_SURE && b.confidence >= KEY_SURE && camelotDistance(a, b) >= 3;
}
