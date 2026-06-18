// HTTP entry point. One protected endpoint that transcodes a single work_id on
// demand (no polling loop — Phase 3 is manual/on-demand). A GET /health probe
// is unauthenticated so Railway can check liveness.

import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

import { config } from "./config.js";
import { log, logErr } from "./logger.js";
import { transcodeWork } from "./transcode.js";
import { purgeWork } from "./purge.js";

// Refuse to expose the endpoint without a secret to guard it.
if (!config.sharedSecret) {
  logErr("TRANSCODE_SHARED_SECRET is not set — refusing to start the HTTP server");
  process.exit(1);
}

// One transcode per work_id at a time (guards against a double-trigger).
const inFlight = new Set();

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
