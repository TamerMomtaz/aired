// HTTP entry point. One protected endpoint that transcodes a single work_id on
// demand (no polling loop — Phase 3 is manual/on-demand). A GET /health probe
// is unauthenticated so Railway can check liveness.

import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

import { config } from "./config.js";
import { log, logErr } from "./logger.js";
import { transcodeWork } from "./transcode.js";
import { purgeWork } from "./purge.js";
import { CLIP_ORIENTATIONS, renderShareVideo } from "./clip.js";
import {
  REEL_HIGHLIGHTS,
  REEL_MODES,
  REEL_SHAPE_NAMES,
  ReelUnavailableError,
  requestReel,
} from "./reel.js";

// Refuse to expose the endpoint without a secret to guard it.
if (!config.sharedSecret) {
  logErr("TRANSCODE_SHARED_SECRET is not set — refusing to start the HTTP server");
  process.exit(1);
}

// One transcode per work_id at a time (guards against a double-trigger).
const inFlight = new Set();

// One SHARE VIDEO render per (work_id, orientation) at a time — the app may poll
// and re-dispatch while a render is in flight; this collapses that to one job.
const clipInFlight = new Set();

function secretOk(provided) {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(config.sharedSecret);
  if (a.length !== b.length) return false; // timingSafeEqual requires equal lengths
  return timingSafeEqual(a, b);
}

function extractSecret(req) {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  const header = req.headers["x-transcode-secret"];
  return typeof header === "string" ? header.trim() : null;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req, limitBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // Health / root — no auth.
    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
      return sendJson(res, 200, { ok: true, service: "aired-transcode-worker" });
    }

    if (req.method === "POST" && url.pathname === "/transcode") {
      if (!secretOk(extractSecret(req))) {
        return sendJson(res, 401, { ok: false, error: "unauthorized" });
      }

      // work_id from JSON body { "work_id": N } or ?work_id=N.
      let workId = Number(url.searchParams.get("work_id"));
      if (!workId) {
        const raw = await readBody(req);
        if (raw.trim()) {
          try {
            workId = Number(JSON.parse(raw).work_id);
          } catch {
            return sendJson(res, 400, { ok: false, error: "invalid JSON body" });
          }
        }
      }
      if (!Number.isInteger(workId) || workId <= 0) {
        return sendJson(res, 400, {
          ok: false,
          error: "work_id must be a positive integer",
        });
      }

      if (inFlight.has(workId)) {
        return sendJson(res, 409, {
          ok: false,
          error: `work ${workId} is already transcoding`,
        });
      }

      inFlight.add(workId);
      try {
        const result = await transcodeWork(workId);
        return sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        logErr(`work=${workId} transcode failed`, err);
        return sendJson(res, 500, {
          ok: false,
          workId,
          error: err?.message ?? "transcode failed",
        });
      } finally {
        inFlight.delete(workId);
      }
    }

    // Storage purge for a discarded work (EDIT & TIDY). Same Bearer-secret guard
    // as /transcode. The caller (the discard server action) has already deleted
    // the work row; this removes its R2 objects + the private master source.
    if (req.method === "POST" && url.pathname === "/purge") {
      if (!secretOk(extractSecret(req))) {
        return sendJson(res, 401, { ok: false, error: "unauthorized" });
      }

      let workId = Number(url.searchParams.get("work_id"));
      let masterStoragePath = null;
      const raw = await readBody(req);
      if (raw.trim()) {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return sendJson(res, 400, { ok: false, error: "invalid JSON body" });
        }
        if (!workId) workId = Number(parsed.work_id);
        if (typeof parsed.master_storage_path === "string") {
          masterStoragePath = parsed.master_storage_path;
        }
      }
      if (!Number.isInteger(workId) || workId <= 0) {
        return sendJson(res, 400, {
          ok: false,
          error: "work_id must be a positive integer",
        });
      }

      try {
        const result = await purgeWork(workId, { masterStoragePath });
        return sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        logErr(`work=${workId} purge failed`, err);
        return sendJson(res, 500, {
          ok: false,
          workId,
          error: err?.message ?? "purge failed",
        });
      }
    }

    // SHARE VIDEO — render (and cache in R2) a song's Reels / TikTok / IG clip.
    // Same Bearer-secret guard as /transcode. Body: { work_id, orientation,
    // force? }. The teaser WINDOW is read authoritatively from the work row
    // (clip_start_seconds / clip_length_seconds) and clamped in renderShareVideo —
    // the client never supplies it. Synchronous like /transcode — a short clip
    // renders in a few seconds; the app dispatches and polls.
    if (req.method === "POST" && url.pathname === "/share-video") {
      if (!secretOk(extractSecret(req))) {
        return sendJson(res, 401, { ok: false, error: "unauthorized" });
      }

      let workId = Number(url.searchParams.get("work_id"));
      let orientation = url.searchParams.get("orientation") ?? "vertical";
      let force = false;
      const raw = await readBody(req);
      if (raw.trim()) {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return sendJson(res, 400, { ok: false, error: "invalid JSON body" });
        }
        if (!workId) workId = Number(parsed.work_id);
        if (parsed.orientation) orientation = String(parsed.orientation);
        force = parsed.force === true;
      }

      if (!Number.isInteger(workId) || workId <= 0) {
        return sendJson(res, 400, {
          ok: false,
          error: "work_id must be a positive integer",
        });
      }
      if (!CLIP_ORIENTATIONS.has(orientation)) {
        return sendJson(res, 400, {
          ok: false,
          error: `orientation must be one of: ${[...CLIP_ORIENTATIONS].join(", ")}`,
        });
      }

      const flightKey = `${workId}:${orientation}`;
      if (clipInFlight.has(flightKey)) {
        return sendJson(res, 409, {
          ok: false,
          error: `clip ${flightKey} is already rendering`,
        });
      }

      clipInFlight.add(flightKey);
      try {
        const result = await renderShareVideo(workId, { orientation, force });
        return sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        logErr(`work=${workId} clip ${orientation} failed`, err);
        return sendJson(res, 500, {
          ok: false,
          workId,
          orientation,
          error: err?.message ?? "clip render failed",
        });
      } finally {
        clipInFlight.delete(flightKey);
      }
    }

    // REELS — the lyric-video generator (reel.js). Same Bearer-secret guard.
    // Body: { work_id, mode, shape, highlight, retry? }. NEVER renders inline:
    // answers at once with the variant's status — ready (cached in R2, with its
    // key + size) · queued (position) · rendering (progress 0–1) · failed — and
    // enqueues the render if it is neither cached nor in hand. The app polls
    // this until "ready". A song that can't have a public reel answers 404.
    if (req.method === "POST" && url.pathname === "/reel") {
      if (!secretOk(extractSecret(req))) {
        return sendJson(res, 401, { ok: false, error: "unauthorized" });
      }

      let parsed = {};
      const raw = await readBody(req);
      if (raw.trim()) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          return sendJson(res, 400, { ok: false, error: "invalid JSON body" });
        }
      }
      const workId = Number(parsed.work_id);
      const mode = String(parsed.mode ?? "snippet");
      const shape = String(parsed.shape ?? "vertical");
      const highlight = String(parsed.highlight ?? "karaoke");
      if (!Number.isInteger(workId) || workId <= 0) {
        return sendJson(res, 400, { ok: false, error: "work_id must be a positive integer" });
      }
      if (!REEL_MODES.has(mode) || !REEL_SHAPE_NAMES.has(shape) || !REEL_HIGHLIGHTS.has(highlight)) {
        return sendJson(res, 400, {
          ok: false,
          error:
            `mode ∈ {${[...REEL_MODES]}}, shape ∈ {${[...REEL_SHAPE_NAMES]}}, ` +
            `highlight ∈ {${[...REEL_HIGHLIGHTS]}}`,
        });
      }

      try {
        const status = await requestReel({
          workId,
          mode,
          shape,
          highlight,
          retry: parsed.retry === true,
        });
        return sendJson(res, 200, { ok: true, workId, mode, shape, highlight, ...status });
      } catch (err) {
        if (err instanceof ReelUnavailableError) {
          return sendJson(res, 404, { ok: false, workId, error: err.message });
        }
        logErr(`work=${workId} reel ${mode}/${shape} request failed`, err);
        return sendJson(res, 500, {
          ok: false,
          workId,
          error: err?.message ?? "reel request failed",
        });
      }
    }

    return sendJson(res, 404, { ok: false, error: "not found" });
  } catch (err) {
    logErr("request failed", err);
    if (!res.headersSent) {
      return sendJson(res, 500, { ok: false, error: err?.message ?? "internal error" });
    }
    res.end();
  }
});

server.listen(config.port, () => {
  log(`aired-transcode-worker listening on :${config.port}`);
});
