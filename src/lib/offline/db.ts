// IndexedDB store for offline download snapshots — a tiny promise wrapper over the
// raw IDB API (no dependency). One object store, keyed by the catalog number, each
// row an OfflineSnapshot. This is what the Downloads screen and the player read
// when the network (and therefore Supabase/RLS) is gone.

import type { OfflineSnapshot } from "./types";

const DB_NAME = "aired-offline";
const DB_VERSION = 1;
const STORE = "downloads";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Run one request inside a transaction and resolve with its result. The db handle
// is closed on completion so a later version upgrade is never blocked.
function run<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = op(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

export function getAllSnapshots(): Promise<OfflineSnapshot[]> {
  return run<OfflineSnapshot[]>("readonly", (s) => s.getAll()).then((all) =>
    [...all].sort((a, b) => b.downloadedAt - a.downloadedAt),
  );
}

export function getSnapshot(id: number): Promise<OfflineSnapshot | undefined> {
  return run<OfflineSnapshot | undefined>("readonly", (s) => s.get(id));
}

export function putSnapshot(snap: OfflineSnapshot): Promise<void> {
  return run<IDBValidKey>("readwrite", (s) => s.put(snap)).then(() => undefined);
}

export function deleteSnapshot(id: number): Promise<void> {
  return run<undefined>("readwrite", (s) => s.delete(id));
}

export function clearSnapshots(): Promise<void> {
  return run<undefined>("readwrite", (s) => s.clear());
}
