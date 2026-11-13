// MY MIXES — fire-and-forget calls to the transcode worker for saved mixes.
// Same contract as src/lib/works/transcode.ts: Bearer secret, JSON body, and a
// short wait that only means "dispatched" (the worker keeps going).
//
// SERVER ONLY.

const ABORT_TIMEOUT_MS = 5_000;

async function call(path: "/transcode-mix" | "/purge-mix", body: Record<string, unknown>): Promise<void> {
  const workerUrl = process.env.AIRED_WORKER_URL?.replace(/\/+$/, "");
  const secret = process.env.TRANSCODE_SHARED_SECRET;
  if (!workerUrl || !secret) {
    console.warn(`[mix-worker] ${path} skipped — AIRED_WORKER_URL or TRANSCODE_SHARED_SECRET not set.`);
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ABORT_TIMEOUT_MS);
  try {
    const res = await fetch(`${workerUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok && res.status !== 409) {
      console.error(`[mix-worker] ${path} mix=${body.mix_id} → HTTP ${res.status} ${await res.text().catch(() => "")}`);
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return; // dispatched
    console.error(`[mix-worker] ${path} mix=${body.mix_id} failed`, err);
  } finally {
    clearTimeout(timer);
  }
}

export function triggerMixTranscode(mixId: string): Promise<void> {
  return call("/transcode-mix", { mix_id: mixId });
}

export function purgeMixStorage(mixId: string, masterStoragePath: string | null): Promise<void> {
  return call("/purge-mix", { mix_id: mixId, master_storage_path: masterStoragePath });
}
