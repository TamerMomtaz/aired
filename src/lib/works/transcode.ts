// Fire-and-forget trigger for the Phase 3 transcode worker. Called from
// createWork() right after the work row lands, via `next/server`'s `after()`
// so it runs outside the response path — the user redirects without waiting.
//
// The worker (worker/src/index.js) processes /transcode synchronously and
// only responds when ffmpeg + R2 uploads are done — that can be many seconds
// (minutes for a long master). We don't wait for that: we POST the request
// (so the worker reads the body, authenticates, and starts transcoding) and
// abort the response wait after a short timeout. Closing the TCP connection
// on our side does not cancel the worker's job: `transcodeWork` doesn't read
// from `req` or write to `res` once it's running, so the in-flight transcode
// completes and `updateWorkKeys` still lands on the work row. Status is
// untouched — Go Live stays a deliberate, manual click (CLAUDE.md §5 Phase 4).
//
// Auth contract MUST mirror what the deployed worker checks (extractSecret +
// secretOk in worker/src/index.js): `Authorization: Bearer <secret>` header +
// JSON body `{ work_id }`. Same shape as the README's curl example and what
// was verified by hand against the live Railway worker — anything else 401s.

// Long enough for Railway to wake the service, read the body, and start the
// job; short enough that the Vercel function doesn't sit waiting for the full
// transcode to finish. An AbortError after this just means "dispatched", not
// "failed" — the worker keeps going.
const ABORT_TIMEOUT_MS = 5_000;

export async function triggerTranscode(workId: number): Promise<void> {
  const workerUrl = process.env.AIRED_WORKER_URL?.replace(/\/+$/, "");
  const secret = process.env.TRANSCODE_SHARED_SECRET;

  if (!workerUrl || !secret) {
    console.warn(
      `[transcode-trigger] work=${workId} skipped — AIRED_WORKER_URL or TRANSCODE_SHARED_SECRET not set (manual curl still works).`,
    );
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ABORT_TIMEOUT_MS);

  try {
    const res = await fetch(`${workerUrl}/transcode`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ work_id: workId }),
      signal: controller.signal,
    });
    // 200 = transcoded synchronously (a very short master finishing inside
    // the window); 409 = already in flight from a prior call (harmless,
    // worker dedups by work_id). 4xx/5xx → log the body so a misconfigured
    // secret or missing master shows up in Vercel runtime logs.
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[transcode-trigger] work=${workId} → HTTP ${res.status} ${detail}`,
      );
    } else {
      console.log(`[transcode-trigger] work=${workId} → HTTP ${res.status}`);
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      // Expected for any real-length master: the worker is mid-transcode.
      console.log(
        `[transcode-trigger] work=${workId} dispatched — response wait aborted after ${ABORT_TIMEOUT_MS}ms (worker still processing).`,
      );
      return;
    }
    console.error(`[transcode-trigger] work=${workId} failed`, err);
  } finally {
    clearTimeout(timer);
  }
}
