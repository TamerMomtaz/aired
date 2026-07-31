#!/usr/bin/env node
// AIRED · run-it-yourself publish — the signed-URL road, from your own machine.
//
// WHAT THIS IS. A zero-dependency runner for the delegated door already
// documented in ../README.md: it asks for a short-lived upload grant, PUTs the
// master straight to the private `masters` bucket, then POSTs the work. It is
// the same three curl calls from the README with the fiddly parts handled —
// the same route, the same token, the same `published_via = 'delegated_api'`
// stamp, the same honesty trigger, the same DRAFT state.
//
// WHAT THIS IS NOT. It is not a second code path, and it does not publish
// anything. A human holds the token, the work lands as a draft, and a human
// still promotes it from /manage with Go Live. Nothing here implies autonomy.
//
// THE SECRET NEVER APPEARS IN AN ARGUMENT. It is read from the environment, is
// never printed, never logged, and never written to a file. The signed upload
// URL is itself a credential, so it is redacted too.
//
//   AIRED_INGEST_SECRET=… node scripts/publish-work.mjs scripts/works/<work>.json \
//     --master /path/to/master.mp3
//
// Flags:
//   --master <file>        the local master to upload (or `master` in the manifest)
//   --master-path <path>   skip the upload; publish a master already in the bucket
//                          (use this to retry after a failed publish step)
//   --dry-run              validate + print the payload, touch no network
//   --show-craft           print craft values in --dry-run (default: redacted)
//   --api-base <url>       override AIRED_API_BASE (default https://ai-red.io)

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

// ── The ledger vocabulary, mirrored from src/lib/ledger/types.ts ─────────────
// Validated locally so a typo costs nothing. This matters more than it looks:
// if ANY volley is refused server-side the whole work row is deleted (README,
// "Nothing half-made keeps an AIRED number"), so a bad enum would burn an
// upload and a round trip before failing.
const ROLES = [
  "lyric_thrown", "lyric_caught", "structure", "genre_direction",
  "vocal_render", "production", "artwork", "edit", "audit",
];
const ORIGINS = ["HUMAN", "AI", "DIALOGUE"];
const DELTAS = ["added", "removed", "reframed"];
const AGENT_TYPES = ["human", "ai_model", "ai_voice", "tool"];

// Mirrors enforce_volley_origin() exactly (the DB trigger + originConflictMessage).
// DIALOGUE — the "neither alone" move — is legal for ANY contributor.
function originConflict(type, origin) {
  if (type === "ai_model" && origin === "HUMAN") {
    return "an AI contributor can't carry a HUMAN-origin move — use AI or DIALOGUE";
  }
  if (type === "human" && origin === "AI") {
    return "a human contributor can't carry an AI-origin move — use HUMAN or DIALOGUE";
  }
  return null;
}

const AUDIO_TYPES = {
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac",
  ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg",
  ".opus": "audio/opus", ".aiff": "audio/aiff", ".aif": "audio/aiff",
};

// Vercel's serverless request-body ceiling. Above this the inline road is not
// available at all — which is the whole reason the signed-URL road exists.
const INLINE_CAP_BYTES = 4.5 * 1024 * 1024;

const RESET = "[0m", DIM = "[2m", BOLD = "[1m";
const RED = "[31m", GREEN = "[32m", YELLOW = "[33m";
const say = (m = "") => console.log(m);
const step = (n, m) => say(`${BOLD}${n}${RESET} ${m}`);
const warn = (m) => console.log(`${YELLOW}!${RESET} ${m}`);
const fail = (m) => { console.error(`${RED}✗ ${m}${RESET}`); process.exit(1); };

// ── Arguments ────────────────────────────────────────────────────────────────
// Flags that consume the next argument, so a positional is never mistaken for
// a flag's value (and vice versa) whatever order they are written in.
const VALUE_FLAGS = new Set(["master", "master-path", "api-base"]);

const positionals = [];
const options = Object.create(null);
const bools = new Set();
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { positionals.push(a); continue; }
    const name = a.slice(2);
    if (VALUE_FLAGS.has(name)) {
      const value = argv[i + 1];
      if (value == null || value.startsWith("--")) {
        fail(`--${name} needs a value.`);
      }
      options[name] = value;
      i++;
    } else {
      bools.add(name);
    }
  }
}
const flag = (name) => bools.has(name);
const opt = (name) => options[name] ?? null;

const manifestPath = positionals[0] ?? null;
const dryRun = flag("dry-run");
const showCraft = flag("show-craft");
const apiBase = (opt("api-base") ?? process.env.AIRED_API_BASE ?? "https://ai-red.io").replace(/\/+$/, "");

if (!manifestPath) {
  fail("Usage: node scripts/publish-work.mjs <manifest.json> --master <file> [--dry-run]");
}

// ── Manifest ─────────────────────────────────────────────────────────────────
let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (e) {
  fail(`Couldn't read the manifest at ${manifestPath}: ${e.message}`);
}

const masterFile = opt("master") ?? manifest.master ?? null;
const masterPathFlag = opt("master-path");

// Validate before anything else — no network, no upload, no wasted grant.
const problems = [];
if (!manifest.title?.trim()) problems.push("title is required.");
if (!manifest.idempotency_key?.trim()) {
  problems.push("idempotency_key is required (a uuid you mint once per work and keep).");
}
// A dry run validates the manifest and needs no bytes — that is the point of it.
if (!dryRun && !masterFile && !masterPathFlag) {
  problems.push("No master: pass --master <file>, --master-path <bucket path>, or set `master` in the manifest.");
}
if (manifest.duration_seconds != null && !Number.isFinite(Number(manifest.duration_seconds))) {
  problems.push("duration_seconds must be a number when present.");
}

const volleys = Array.isArray(manifest.volley) ? manifest.volley : [];
for (const [i, v] of volleys.entries()) {
  const where = `volley[${i}]`;
  const name = v.contributor?.name?.trim();
  const type = v.contributor?.type ?? null;
  if (!name) problems.push(`${where}: contributor.name is required — a maker is always credited by name (Rule 3a).`);
  if (type && !AGENT_TYPES.includes(type)) {
    problems.push(`${where}: contributor.type "${type}" is not one of ${AGENT_TYPES.join(", ")}.`);
  }
  if (!ROLES.includes(v.role)) problems.push(`${where}: role "${v.role}" is not one of ${ROLES.join(", ")}.`);
  if (!ORIGINS.includes(v.origin)) problems.push(`${where}: origin "${v.origin}" is not one of ${ORIGINS.join(", ")}.`);
  if (v.delta_type != null && !DELTAS.includes(v.delta_type)) {
    problems.push(`${where}: delta_type "${v.delta_type}" is not one of ${DELTAS.join(", ")}.`);
  }
  const conflict = type ? originConflict(type, v.origin) : null;
  if (conflict) problems.push(`${where}: ${conflict}. The DB trigger would refuse this and the whole work would roll back.`);
}

if (problems.length) {
  console.error(`${RED}✗ The manifest has ${problems.length} problem(s):${RESET}`);
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}

// ── The payload ──────────────────────────────────────────────────────────────
function buildPayload(masterPath) {
  const payload = {
    title: manifest.title.trim(),
    audio: { master_path: masterPath },
    placement: manifest.placement ?? { mode: "single" },
    volley: volleys,
    idempotency_key: manifest.idempotency_key.trim(),
  };
  // Only send what is actually set — an empty descriptors string is not a claim
  // about what the track sounds like, and duration is genuinely optional.
  if (manifest.descriptors?.trim()) payload.descriptors = manifest.descriptors.trim();
  if (manifest.duration_seconds != null) payload.duration_seconds = Number(manifest.duration_seconds);
  if (manifest.artwork?.path) payload.artwork = { path: manifest.artwork.path };
  return payload;
}

// Craft is the sealed half of the ledger — verbatim prompts live only in the
// encrypted private_volley (Rule 1). Redact it when echoing a payload so it does
// not end up in a terminal scrollback or a CI log by accident.
function redactCraft(payload) {
  return {
    ...payload,
    volley: payload.volley.map((v) => {
      if (!v.craft || showCraft) return v;
      const sealed = Object.fromEntries(
        Object.entries(v.craft).map(([k, val]) => [
          k, typeof val === "string" && val ? `<sealed · ${val.length} chars>` : val,
        ]),
      );
      return { ...v, craft: sealed };
    }),
  };
}

say();
say(`${BOLD}AIRED · publish${RESET} ${DIM}${apiBase}${RESET}`);
say(`  title      ${manifest.title}`);
if (manifest.duration_seconds != null) {
  const d = Number(manifest.duration_seconds);
  say(`  duration   ${d}s ${DIM}(${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, "0")})${RESET}`);
}
say(`  volleys    ${volleys.length} declared ${DIM}+ 1 auto (the hands, role audit / origin HUMAN)${RESET}`);
for (const v of volleys) {
  say(`             ${DIM}·${RESET} ${v.contributor.name} — ${v.role} — ${v.origin}`);
}
if (!manifest.descriptors?.trim()) {
  warn("No `descriptors` — the work lands with nothing describing what it SOUNDS like, so it won't surface in sonic search. Add them in the manifest or on /registry later.");
}
say();

if (dryRun) {
  step("dry-run", "validated. This is the exact payload that would be POSTed:");
  say();
  say(JSON.stringify(redactCraft(buildPayload(masterPathFlag ?? "<assigned by the upload grant>")), null, 2));
  say();
  say(`${GREEN}✓${RESET} Manifest is valid. No network calls were made.`);
  process.exit(0);
}

// ── The token ────────────────────────────────────────────────────────────────
const secret = process.env.AIRED_INGEST_SECRET;
if (!secret?.trim()) {
  fail(
    "AIRED_INGEST_SECRET is not set.\n" +
    "  Run it as:  AIRED_INGEST_SECRET='…' node scripts/publish-work.mjs " + manifestPath + " --master <file>\n" +
    "  (Or export it first. It is never accepted as a command-line argument — that would put it in your shell history.)",
  );
}
const auth = { authorization: `Bearer ${secret.trim()}` };

// Shared response reading: a deployment older than a route does not 404 — Next
// serves its not-found PAGE as HTML with status 200 — so JSON-ness is checked,
// not just the status. (Same reasoning as mcp/src/index.js.)
async function readJson(res, what) {
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    fail(`${what}: AIRED answered ${res.status} with ${type || "no content-type"}, not JSON. Is ${apiBase} the right deployment?`);
  }
  try {
    return await res.json();
  } catch {
    return fail(`${what}: AIRED returned a malformed JSON body (HTTP ${res.status}).`);
  }
}

function explainStatus(res, body, what) {
  if (res.status === 401) {
    fail(`${what}: AIRED refused the token (401). Check AIRED_INGEST_SECRET, and that it is registered with a human authority in AIRED_INGEST_TOKENS.`);
  }
  if (res.status === 429) {
    const retry = res.headers.get("retry-after") ?? "?";
    fail(`${what}: rate limited (429). ${body?.error ?? ""} Retry in ${retry}s. A master you already uploaded is unaffected — re-run with --master-path to skip straight to publishing.`);
  }
  if (res.status === 503) {
    fail(`${what}: the delegated door is not configured on this deployment (503). It needs SUPABASE_SERVICE_ROLE_KEY and an ingest token.`);
  }
  if (!res.ok) fail(`${what}: HTTP ${res.status} — ${body?.error ?? "no detail"}`);
}

// ── 1 · The grant ────────────────────────────────────────────────────────────
let masterPath = masterPathFlag;

if (!masterPath) {
  let bytes;
  try {
    bytes = await readFile(masterFile);
  } catch (e) {
    fail(`Couldn't read the master at ${masterFile}: ${e.message}`);
  }
  const mb = (bytes.length / 1024 / 1024).toFixed(2);
  step("1/3", `master ${basename(masterFile)} — ${mb} MB${bytes.length > INLINE_CAP_BYTES ? `, over the ${(INLINE_CAP_BYTES / 1024 / 1024).toFixed(1)} MB inline cap, so the signed-URL road is the only one that carries it` : ""}`);

  let grantRes;
  try {
    grantRes = await fetch(`${apiBase}/api/works/upload-url`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ filename: basename(masterFile) }),
    });
  } catch (e) {
    fail(`Couldn't reach AIRED at ${apiBase}: ${e.message}`);
  }
  const grantBody = await readJson(grantRes, "upload grant");
  explainStatus(grantRes, grantBody, "upload grant");

  const upload = grantBody.upload;
  if (!upload?.url || !upload?.path) fail("AIRED returned an upload grant with no url or path.");
  // The URL is a bearer credential in itself — report the path, never the URL.
  say(`      ${DIM}grant ok · destination ${upload.path} · expires in ${upload.expires_in_seconds}s${RESET}`);

  // ── 2 · The bytes ──────────────────────────────────────────────────────────
  // Straight to storage. This request never touches a serverless function, so
  // there is no size ceiling on it — a 12-minute master is no different.
  step("2/3", "uploading the master straight to the private bucket…");
  let putRes;
  try {
    putRes = await fetch(upload.url, {
      method: "PUT",
      headers: {
        "content-type": AUDIO_TYPES[extname(masterFile).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "max-age=3600",
      },
      body: bytes,
    });
  } catch (e) {
    fail(`The master upload failed: ${e.message}`);
  }
  if (!putRes.ok) {
    fail(`The master upload failed (HTTP ${putRes.status}): ${(await putRes.text()).slice(0, 200)}`);
  }
  masterPath = upload.path;
  say(`      ${GREEN}uploaded${RESET} ${DIM}${mb} MB${RESET}`);
} else {
  step("1-2/3", `skipping the upload — publishing the master already at ${masterPath}`);
}

// ── 3 · The publish ──────────────────────────────────────────────────────────
step("3/3", "publishing…");
const payload = buildPayload(masterPath);

let res;
try {
  res = await fetch(`${apiBase}/api/works/ingest`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
} catch (e) {
  fail(
    `Couldn't reach AIRED at ${apiBase}: ${e.message}\n` +
    `  The master IS uploaded. Retry just the publish with:\n` +
    `    --master-path ${masterPath}`,
  );
}
const body = await readJson(res, "publish");

if (!res.ok) {
  console.error(`${RED}✗ publish failed (HTTP ${res.status}): ${body?.error ?? "no detail"}${RESET}`);
  console.error(`  The master IS uploaded, and the same idempotency_key is safe to retry.`);
  console.error(`  Retry just the publish with:  --master-path ${masterPath}`);
  process.exit(1);
}

// ── What actually happened ───────────────────────────────────────────────────
const work = body.work ?? {};
say();
say(`${GREEN}${BOLD}✓ ${work.catalog} · "${work.title}"${RESET}`);
say(`  status            ${work.status}   ${DIM}— a human still promotes it with Go Live${RESET}`);
say(`  performer         ${work.performer}   ${DIM}(whose rail it filed under)${RESET}`);
say(`  arrived as        ${work.published_via} · token "${work.ingest_token_label}"`);
say(`  volleys written   ${work.volleys}`);
say(`  work id           ${work.id}`);

if (body.replay) {
  warn("replay: this idempotency_key had already published. The EXISTING draft came back — no second AIRED number was minted.");
}

// Rule 2: names the reference-sanitizer kept out of public data. Silence here is
// the normal case; a name showing up is worth seeing, not burying.
if (Array.isArray(body.dropped_names) && body.dropped_names.length) {
  warn(`the reference-sanitizer dropped ${body.dropped_names.length} name(s) before any public write: ${body.dropped_names.join(", ")}`);
}

// A manifest may state what it expects, so a token pointing somewhere unexpected
// is caught here rather than discovered on the wrong artist page.
if (manifest.expect?.performer && work.performer !== manifest.expect.performer) {
  warn(`expected this to file under "${manifest.expect.performer}" but it landed on "${work.performer}". The token names the performer — check which token you used.`);
}

say();
say(`  ${DIM}next:${RESET} ${apiBase}/manage ${DIM}— review it, add artwork, then Go Live.${RESET}`);
say();
