// MIXATEE: the shelf where a person's finished mixes stay, so a mix is
// something they keep and come back to, not only a file they download.
//
// Every mix is saved on this device (IndexedDB) the moment it is made. Nothing
// is uploaded: a MixaTee is private to the person who made it, and publishing
// a mix into the catalog is a separate step that does not exist yet (it needs a
// ledger and the source creators' consent).
//
// The audio and the details live in two stores, so the shelf can list every mix
// without pulling each file off the disk.

const DB = "aired-mixatee";
const META = "meta";
const AUDIO = "audio";

export type MixCredit = { label: string; by: string };

export type SavedMix = {
  id: string;
  title: string;
  createdAt: number;
  seconds: number;
  bpm: number;
  energy: string;
  dj: string | null;
  story: string | null;
  plannedBy: "brain" | "rules";
  // Every source work and who made it. Contributor names are always kept and
  // shown (CLAUDE.md §3a).
  credits: MixCredit[];
  // Every distinct maker across the source works, for the player's artist line.
  makers: string[];
  // The catalog works it was built from (older saves may not have this).
  sourceWorkIds?: number[];
  // Set once the mix is kept on the person's AIRED account.
  accountId?: string;
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(META, { keyPath: "id" });
      req.result.createObjectStore(AUDIO);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("aborted"));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listMixes(): Promise<SavedMix[]> {
  try {
    const db = await open();
    try {
      const all = await request(db.transaction(META).objectStore(META).getAll() as IDBRequest<SavedMix[]>);
      return all.sort((a, b) => b.createdAt - a.createdAt);
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

export async function saveMix(mix: SavedMix, audio: Blob): Promise<void> {
  // Ask the browser to keep this site's storage through clean-ups. It may say
  // no; the mix is saved either way.
  void navigator.storage?.persist?.().catch(() => false);
  const db = await open();
  try {
    const tx = db.transaction([META, AUDIO], "readwrite");
    tx.objectStore(AUDIO).put(audio, mix.id);
    tx.objectStore(META).put(mix);
    await done(tx);
  } finally {
    db.close();
  }
}

export async function loadMixAudio(id: string): Promise<Blob | null> {
  const db = await open();
  try {
    const v = await request(db.transaction(AUDIO).objectStore(AUDIO).get(id));
    return v instanceof Blob ? v : null;
  } finally {
    db.close();
  }
}

export async function renameMix(id: string, title: string): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction(META, "readwrite");
    const store = tx.objectStore(META);
    const mix = (await request(store.get(id))) as SavedMix | undefined;
    if (mix) store.put({ ...mix, title });
    await done(tx);
  } finally {
    db.close();
  }
}

export async function markOnAccount(id: string, accountId: string): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction(META, "readwrite");
    const store = tx.objectStore(META);
    const mix = (await request(store.get(id))) as SavedMix | undefined;
    if (mix) store.put({ ...mix, accountId });
    await done(tx);
  } finally {
    db.close();
  }
}

export async function deleteMix(id: string): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction([META, AUDIO], "readwrite");
    tx.objectStore(META).delete(id);
    tx.objectStore(AUDIO).delete(id);
    await done(tx);
  } finally {
    db.close();
  }
}

// A stable, negative player id for a saved mix, so it can never collide with a
// catalog number (catalog ids are positive) and never records a catalog play.
export function mixPlayerId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return -1 - (Math.abs(h) % 1_000_000_000);
}
