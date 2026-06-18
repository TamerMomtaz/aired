// Fire the worker's storage purge for a discarded work (EDIT & TIDY — Discard).
// Mirrors triggerTranscode: the worker is the only component that holds R2
// credentials (CLAUDE.md §1.6/§1.7 keep audio + its keys on the R2/worker tier),
// so deleting a work's stored objects belongs there, reached over the same
// Bearer-secret HTTP contract.
//
// The DB row + its ON DELETE CASCADE dependents are removed synchronously by the
// discard action (the authoritative "ghost is gone"). This call is best-effort
// cleanup of the heavy, work-unique blobs:
//   • R2 aired-masters/work/{id}/…   (the master copy)
//   • R2 aired-hls/work/{id}/…       (playlist + segments)
//   • Supabase masters/{master_storage_path}  (the private transcode source)
// R2 keys are derived from work_id alone, so purge needs no DB row to run — we
// still pass master_storage_path so the private source is swept too. If the
// worker is unreachable, the row is already gone; the blobs are reclaimable
// later and never served, so we log and move on rather than failing the discard.

const ABORT_TIMEOUT_MS = 8_000;

export async function triggerPurge(
  workId: number,
  opts: { masterStoragePath?: string | null } = {},
): Promise<void> {
  const workerUrl = process.env.AIRED_WORKER_URL?.replace(/\/+$/, "");
  const secret = process.env.TRANSCODE_SHARED_SECRET;

  if (!workerUrl || !secret) {
    console.warn(
      `[purge-trigger] work=${workId} skipped — AIRED_WORKER_URL or TRANSCODE_SHARED_SECRET not set; the work row is deleted, R2/master blobs remain for manual cleanup.`,
    );
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ABORT_TIMEOUT_MS);

  try {
    const res = await fetch(`${workerUrl}/purge`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        work_id: workId,
        master_storage_path: opts.masterStoragePath ?? null,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[purge-trigger] work=${workId} → HTTP ${res.status} ${detail}`,
      );
    } else {
      console.log(`[purge-trigger] work=${workId} → HTTP ${res.status}`);
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.log(
        `[purge-trigger] work=${workId} dispatched — response wait aborted after ${ABORT_TIMEOUT_MS}ms (worker still deleting).`,
      );
      return;
    }
    console.error(`[purge-trigger] work=${workId} failed`, err);
  } finally {
    clearTimeout(timer);
  }
}
