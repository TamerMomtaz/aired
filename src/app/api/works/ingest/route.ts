import { revalidatePath } from "next/cache";
import { after } from "next/server";

import {
  ingestWork,
  type IngestArtwork,
  type IngestAudio,
  type IngestPlacement,
  type IngestVolley,
  type IngestWorkInput,
} from "@/lib/ingest/publish";
import {
  ingestConfigured,
  parseBearer,
  resolveIngestToken,
} from "@/lib/ingest/tokens";
import type { AgentType, DeltaType, VolleyOrigin, VolleyRole } from "@/lib/ledger/types";
import { triggerTranscode } from "@/lib/works/transcode";

// POST /api/works/ingest — the delegated door (the honest wheelbarrow).
//
// A finished, human-authorized work is landed as a DRAFT without anyone clicking
// through the web UI, and the ledger records that it arrived by DELEGATED
// AUTHORITY: `published_via = 'delegated_api'` plus the human whose token
// authorized it. This does not, and cannot, mean a machine published on its own —
// a human holds the token, the program posts on that human's authority, and the
// work still waits for a human to promote it (Go Live). The
// enforce_publish_honesty trigger makes a contradictory record impossible.
//
// The work files under the PERFORMER the token speaks for, so an AI performer
// gets their own rail and catalog, with the authorizing human named as the hands
// in that work's ledger. Two artists, each in the other's trail.
//
// Auth: `Authorization: Bearer <token>`, resolved in constant time
// (src/lib/ingest/tokens.ts) to a grant naming the human authority and the
// performer. A missing, blank, malformed, or unknown token gets the same generic
// 401 — no detail leaks, and the presented token is never echoed or logged.
//
// Request bodies are never logged: the volley craft carries verbatim prompts,
// which live only in the encrypted private ledger (CLAUDE.md Rule 1).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Enough headroom to stream an inline master into the private bucket.
export const maxDuration = 60;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function unauthorized(): Response {
  return new Response(
    JSON.stringify({ error: "Unauthorized." }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        // Tell a well-behaved client HOW to authenticate without hinting at
        // which tokens exist.
        "www-authenticate": 'Bearer realm="aired-ingest"',
      },
    },
  );
}

type RawBody = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// Normalize the placement block. Accepts the brief's shape:
//   { "mode": "single" | "album" | "new_album",
//     "album_id": "…", "new_album_title": "…", "new_album_description": "…" }
function readPlacement(raw: unknown): IngestPlacement | { error: string } {
  const p = asRecord(raw);
  if (!p) return { mode: "single" };
  const mode = asString(p.mode) ?? "single";
  if (mode === "single") return { mode: "single" };
  if (mode === "album") {
    const albumId = asString(p.album_id)?.trim();
    if (!albumId) {
      return { error: "placement.album_id is required when mode is 'album'." };
    }
    return { mode: "album", albumId };
  }
  if (mode === "new_album") {
    const title = asString(p.new_album_title)?.trim();
    if (!title) {
      return {
        error: "placement.new_album_title is required when mode is 'new_album'.",
      };
    }
    return {
      mode: "new_album",
      title,
      description: asString(p.new_album_description),
    };
  }
  return { error: `placement.mode must be single, album, or new_album.` };
}

// Normalize the ledger array. Field names mirror the DB / public ledger vocabulary
// (role, origin, delta_type) so the payload reads like the trail it becomes.
function readVolleys(raw: unknown): IngestVolley[] | { error: string } {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return { error: "volley must be an array." };

  const out: IngestVolley[] = [];
  for (const [i, item] of raw.entries()) {
    const v = asRecord(item);
    if (!v) return { error: `volley[${i}] must be an object.` };

    const contributorRaw = asRecord(v.contributor);
    const contributorName =
      asString(v.contributor)?.trim() || asString(contributorRaw?.name)?.trim();

    out.push({
      // Default the sequence to the array order — the natural reading of a trail
      // sent in order — while an explicit seq (0, 1, 1.5…) always wins.
      seq: v.seq == null ? i : Number(v.seq),
      agentId: asString(v.agent_id)?.trim() || undefined,
      contributor: contributorName
        ? {
            name: contributorName,
            type: (asString(contributorRaw?.type) as AgentType) ?? undefined,
            version: asString(contributorRaw?.version) ?? undefined,
          }
        : undefined,
      role: asString(v.role) as VolleyRole,
      origin: asString(v.origin) as VolleyOrigin,
      deltaType: (asString(v.delta_type) ?? "added") as DeltaType,
      craft: {
        prompt: asString(asRecord(v.craft)?.prompt) ?? "",
        style_reference_raw:
          asString(asRecord(v.craft)?.style_reference_raw) ?? "",
        rejected_branches:
          asString(asRecord(v.craft)?.rejected_branches) ?? "",
        rationale: asString(asRecord(v.craft)?.rationale) ?? "",
      },
    });
  }
  return out;
}

// Build the ingest input from a parsed body plus any inline files.
//
// Audio: either `audio.master_path` — an object the caller already uploaded to
// the private `masters` bucket, which is how a long track gets there without
// passing through a serverless request body — or an inline `audio` file part.
// (The brief calls this an `r2_key`; on this platform the master lands in the
// private Supabase `masters` bucket and the Railway worker is what puts a copy
// and the HLS rendition in R2, so the honest name for the field is the path it
// actually is.)
function readInput(
  body: RawBody,
  files: { audio?: File; artwork?: File },
): IngestWorkInput | { error: string } {
  const placement = readPlacement(body.placement);
  if ("error" in placement) return { error: placement.error };

  const volley = readVolleys(body.volley);
  if ("error" in volley) return { error: volley.error };

  const audioRaw = asRecord(body.audio);
  const masterPath =
    asString(audioRaw?.master_path)?.trim() ||
    asString(audioRaw?.path)?.trim() ||
    asString(body.master_path)?.trim();

  let audio: IngestAudio;
  if (files.audio && files.audio.size > 0) {
    audio = { kind: "file", file: files.audio };
  } else if (masterPath) {
    audio = { kind: "path", masterPath };
  } else {
    return {
      error:
        "Provide the audio master: audio.master_path (already in the private masters bucket) or an inline `audio` file part.",
    };
  }

  const artworkRaw = asRecord(body.artwork);
  const artworkPath =
    asString(artworkRaw?.path)?.trim() || asString(body.artwork_path)?.trim();
  let artwork: IngestArtwork | null = null;
  if (files.artwork && files.artwork.size > 0) {
    artwork = { kind: "file", file: files.artwork };
  } else if (artworkPath) {
    artwork = { kind: "path", path: artworkPath };
  }

  const duration = body.duration_seconds;

  return {
    title: asString(body.title) ?? "",
    audio,
    artwork,
    placement,
    descriptors: asString(body.descriptors) ?? "",
    durationSeconds:
      duration == null || duration === "" ? null : Number(duration),
    volley,
    idempotencyKey: asString(body.idempotency_key) ?? "",
  };
}

export async function POST(request: Request): Promise<Response> {
  // 1 · Delegated authority. Everything else depends on this resolving to a
  //     named human, so it runs before the body is even read.
  const token = parseBearer(request.headers.get("authorization"));
  if (!token) {
    return unauthorized();
  }
  // The grant names BOTH profiles: the human who authorizes, and the performer
  // the work is filed under. Same token, two facts, neither optional downstream.
  const grant = resolveIngestToken(token);
  if (!grant) {
    if (!ingestConfigured()) {
      // Server-side only — the caller still sees a plain 401.
      console.error(
        "[ingest] no delegated tokens are configured — set AIRED_INGEST_TOKENS (or AIRED_INGEST_SECRET + AIRED_INGEST_AUTHORITY).",
      );
    }
    return unauthorized();
  }

  // 2 · Body: JSON, or multipart when audio/artwork ride along inline.
  let body: RawBody = {};
  const files: { audio?: File; artwork?: File } = {};
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      // The metadata travels as one JSON `payload` field so the contract is
      // identical to the JSON body; the file parts sit beside it.
      const payload = form.get("payload");
      if (typeof payload === "string" && payload.trim()) {
        body = JSON.parse(payload) as RawBody;
      }
      const audio = form.get("audio");
      if (audio instanceof File) files.audio = audio;
      const artwork = form.get("artwork");
      if (artwork instanceof File) files.artwork = artwork;
    } else {
      body = (await request.json()) as RawBody;
    }
  } catch {
    return json({ error: "Body must be valid JSON." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Body must be a JSON object." }, 400);
  }

  const input = readInput(body, files);
  if ("error" in input) {
    return json({ error: input.error }, 400);
  }

  // 3 · Land the draft. Never publishes: status 'draft' is fixed in ingestWork
  //     and the honesty trigger refuses anything else through this door.
  let result: Awaited<ReturnType<typeof ingestWork>>;
  try {
    result = await ingestWork(grant, input);
  } catch (e) {
    // A missing service-role key (or any other unexpected throw) must not leak a
    // stack trace or a config detail to the caller. Log server-side, answer
    // plainly. 503 = the door exists but this deployment can't open it.
    const detail = e instanceof Error ? e.message : String(e);
    const misconfigured = detail.includes("SUPABASE_SERVICE_ROLE_KEY");
    console.error(`[ingest] failed: ${detail}`);
    return json(
      {
        error: misconfigured
          ? "The delegated ingest door is not configured on this deployment."
          : "Ingest failed.",
      },
      misconfigured ? 503 : 500,
    );
  }
  if (!result.ok) {
    return json({ error: result.error }, result.status);
  }

  const { work } = result;

  if (!work.replay) {
    // Same background kick the web upload uses: ffmpeg → HLS → R2 fills
    // audio_master_key / hls_playlist_key. Status stays 'draft'.
    after(() => triggerTranscode(work.workId));
    revalidatePath("/manage");
    revalidatePath("/registry");
  }

  return json(
    {
      work: {
        id: work.workId,
        catalog: work.catalog,
        title: work.title,
        status: work.status,
        published_via: work.publishedVia,
        published_by_authority: work.publishedByAuthority,
        // Whose rail it landed on — the credited performer (work.creator_id).
        performer_profile_id: work.performerProfileId,
        performer: work.performerName,
        ingest_token_label: work.ingestTokenLabel,
        album_id: work.albumId,
        volleys: work.volleyCount,
      },
      // A machine's retry is a normal event, not an error — say which it was.
      replay: work.replay,
      // Names the reference-sanitizer kept out of public data (Rule 2).
      dropped_names: work.droppedNames,
      note: "Landed as a draft on the performer's catalog. A human still promotes it to live.",
    },
    work.replay ? 200 : 201,
  );
}
