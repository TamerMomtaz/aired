// The DJ TAG: a short line in the mixer's own voice ("TeeJay!") that signs
// their mixes, the way a DJ's name drops into a set. It plays twice per mix,
// in the first bars and just after the big drop, thrown into echo so it
// rings rather than shouts.
//
// The recording stays on this device (IndexedDB). It is never uploaded:
// nothing about it reaches AIRED's servers, and it lives only inside the mixes
// the person downloads.

const DB = "aired-mixer";
const STORE = "tag";
const KEY = "mine";
export const TAG_MAX_SECONDS = 4;

export type SavedTag = { name: string; audio: Blob };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function loadTag(): Promise<SavedTag | null> {
  try {
    const v = (await run("readonly", (s) => s.get(KEY))) as SavedTag | undefined;
    return v && v.audio instanceof Blob ? v : null;
  } catch {
    return null;
  }
}

export async function saveTag(tag: SavedTag): Promise<void> {
  await run("readwrite", (s) => s.put(tag, KEY));
}

export async function deleteTag(): Promise<void> {
  await run("readwrite", (s) => s.delete(KEY));
}

// Decode the recording, trim the silence around it, cap its length and bring
// it to a steady level, ready to drop into a mix.
export async function decodeTag(audio: Blob, sampleRate: number): Promise<AudioBuffer | null> {
  try {
    const ctx = new OfflineAudioContext(1, 1, sampleRate);
    const raw = await ctx.decodeAudioData(await audio.arrayBuffer());
    const ch = raw.numberOfChannels;
    const mono = new Float32Array(raw.length);
    for (let c = 0; c < ch; c++) {
      const d = raw.getChannelData(c);
      for (let i = 0; i < d.length; i++) mono[i] += d[i] / ch;
    }
    let peak = 0;
    for (const x of mono) peak = Math.max(peak, Math.abs(x));
    if (peak < 1e-3) return null;
    const gate = peak * 0.05; // ≈ −26 dB under the loudest moment
    let a = 0;
    while (a < mono.length && Math.abs(mono[a]) < gate) a++;
    let b = mono.length - 1;
    while (b > a && Math.abs(mono[b]) < gate) b--;
    const pad = Math.round(0.03 * raw.sampleRate);
    a = Math.max(0, a - pad);
    b = Math.min(mono.length, b + pad * 4, a + Math.round(TAG_MAX_SECONDS * raw.sampleRate));
    const out = new AudioBuffer({ numberOfChannels: 1, length: Math.max(1, b - a), sampleRate: raw.sampleRate });
    const o = out.getChannelData(0);
    const k = 0.9 / peak;
    const fade = Math.min(pad, o.length >> 2);
    for (let i = 0; i < o.length; i++) {
      const env = Math.min(1, i / Math.max(1, fade), (o.length - i) / Math.max(1, fade));
      o[i] = mono[a + i] * k * env;
    }
    return out;
  } catch {
    return null;
  }
}
