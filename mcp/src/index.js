#!/usr/bin/env node
// AIRED · MCP server — the delegated publish door, callable from an agent context.
//
// One tool: `aired_publish_work`. It is a thin wrapper over
// POST /api/works/ingest — the SAME route, the same token, the same
// `published_via = 'delegated_api'` stamp, the same honesty trigger, the same
// draft state. Convenience, not a second code path.
//
// What it does NOT do, and must never be described as doing: publish anything on
// its own. A HUMAN holds the token this server carries, and the work lands as a
// DRAFT for a human to promote. The ledger records that the work arrived through
// delegated authority and names the human who authorized it.
//
// The bearer token is read from this server's own environment and never appears
// as a tool argument, in a tool result, or in a log line.

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// stdout belongs to the JSON-RPC protocol. Every diagnostic goes to stderr.
const log = (...args) => console.error("[aired-mcp]", ...args);

const API_BASE = (process.env.AIRED_API_BASE ?? "https://ai-red.io").replace(
  /\/+$/,
  "",
);
const INGEST_SECRET = process.env.AIRED_INGEST_SECRET?.trim();

if (!INGEST_SECRET) {
  log(
    "AIRED_INGEST_SECRET is not set. This server carries a human's delegated authority and cannot start without it.",
  );
  process.exit(1);
}

// ── Tool schema — mirrors the route body ────────────────────────────────────

const AGENT_TYPES = ["human", "ai_model", "ai_voice", "tool"];
const VOLLEY_ROLES = [
  "lyric_thrown",
  "lyric_caught",
  "structure",
  "genre_direction",
  "vocal_render",
  "production",
  "artwork",
  "edit",
  "audit",
];
const VOLLEY_ORIGINS = ["HUMAN", "AI", "DIALOGUE"];
const DELTA_TYPES = ["added", "removed", "reframed"];

const craftSchema = z
  .object({
    prompt: z.string().optional(),
    style_reference_raw: z.string().optional(),
    rejected_branches: z.string().optional(),
    rationale: z.string().optional(),
  })
  .describe(
    "The sealed craft for this volley. Encrypted at rest, creator-owned, never served and never indexed. A third-party artist name here is sealed too, never published.",
  );

const volleySchema = z.object({
  seq: z
    .number()
    .optional()
    .describe("Position in the trail (0, 1, 1.5…). Defaults to array order."),
  agent_id: z
    .string()
    .uuid()
    .optional()
    .describe("An existing contributor's agent id. Use contributor instead to credit by name."),
  contributor: z
    .object({
      name: z
        .string()
        .describe(
          "The contributor's public, searchable name — the human or the silicon that actually made this move. Always shown, never anonymized. Resolved find-or-create, so the same name keeps one page and one discography.",
        ),
      type: z
        .enum(AGENT_TYPES)
        .optional()
        .describe(
          "Required the FIRST time a contributor appears on AIRED — their row becomes their public page, so it is never guessed. An already-known name keeps its own type.",
        ),
      version: z.string().optional(),
    })
    .optional(),
  role: z.enum(VOLLEY_ROLES),
  origin: z
    .enum(VOLLEY_ORIGINS)
    .describe(
      "Who carried this move: HUMAN, AI, or DIALOGUE. Must not contradict the contributor's type.",
    ),
  delta_type: z.enum(DELTA_TYPES).optional(),
  craft: craftSchema.optional(),
});

const inputSchema = {
  title: z.string().min(1).describe("The work's title. The catalog number (AIRED-####) is assigned by AIRED."),
  audio: z
    .object({
      master_path: z
        .string()
        .optional()
        .describe(
          "Path to a master already uploaded to the private `masters` bucket, inside the authorizing artist's own folder (<artist-uuid>/<upload-uuid>/master.mp3). Preferred for long tracks.",
        ),
      file_path: z
        .string()
        .optional()
        .describe(
          "Local file to send inline instead. Subject to the platform's request-body limit — use master_path for large masters.",
        ),
    })
    .describe("The audio master. Give master_path or file_path."),
  artwork: z
    .object({
      path: z
        .string()
        .optional()
        .describe("Path to an image already in the public `artwork` bucket, in the artist's own folder."),
      file_path: z.string().optional().describe("Local image to send inline."),
    })
    .optional(),
  placement: z
    .object({
      mode: z.enum(["single", "album", "new_album"]).optional(),
      album_id: z.string().uuid().optional(),
      new_album_title: z.string().optional(),
      new_album_description: z.string().optional(),
    })
    .optional()
    .describe("Where the work is filed. Defaults to a single."),
  descriptors: z
    .string()
    .optional()
    .describe(
      "Public, searchable sonic descriptors, comma-separated (what it SOUNDS LIKE). Never a person's name — names are dropped by the reference-sanitizer before any public write.",
    ),
  duration_seconds: z.number().optional(),
  volley: z
    .array(volleySchema)
    .optional()
    .describe("The Volley Ledger: the shape of each contribution, in order."),
  idempotency_key: z
    .string()
    .uuid()
    .describe(
      "A uuid you mint per work. Re-send the SAME key to retry safely: the existing draft is returned instead of a duplicate.",
    ),
};

const outputSchema = {
  id: z.number().describe("The work's catalog id (bigint)."),
  catalog: z.string().describe("Display form, e.g. AIRED-0031."),
  title: z.string(),
  status: z.string().describe("Always 'draft' — a human still promotes it to live."),
  published_via: z.string().describe("Always 'delegated_api' through this door."),
  published_by_authority: z
    .string()
    .describe("The human whose token authorized this publish."),
  ingest_token_label: z.string().nullable().optional(),
  album_id: z.string().nullable().optional(),
  volleys: z.number().describe("How many volleys were written."),
  replay: z
    .boolean()
    .describe("True when this call resolved to a draft an earlier identical call created."),
  dropped_names: z
    .array(z.string())
    .describe("Descriptor tokens withheld from public data because they read as a name."),
};

// ── The call ────────────────────────────────────────────────────────────────

async function loadFilePart(path) {
  const buf = await readFile(path);
  return new File([buf], basename(path));
}

// Build the request for POST /api/works/ingest. Inline files (file_path) go as
// multipart with the metadata in a `payload` field; otherwise it is plain JSON.
// Identical contract either way — the route normalizes both into one input.
async function buildRequest(args) {
  const payload = {
    title: args.title,
    audio: args.audio?.master_path ? { master_path: args.audio.master_path } : undefined,
    artwork: args.artwork?.path ? { path: args.artwork.path } : undefined,
    placement: args.placement,
    descriptors: args.descriptors,
    duration_seconds: args.duration_seconds,
    volley: args.volley,
    idempotency_key: args.idempotency_key,
  };

  const audioFilePath = args.audio?.file_path;
  const artworkFilePath = args.artwork?.file_path;

  if (!audioFilePath && !artworkFilePath) {
    return {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    };
  }

  const form = new FormData();
  form.set("payload", JSON.stringify(payload));
  if (audioFilePath) form.set("audio", await loadFilePart(audioFilePath));
  if (artworkFilePath) form.set("artwork", await loadFilePart(artworkFilePath));
  // fetch sets the multipart content-type (with its boundary) itself.
  return { body: form, headers: {} };
}

function toolError(message) {
  return { isError: true, content: [{ type: "text", text: message }] };
}

async function publishWork(args) {
  if (!args.audio?.master_path && !args.audio?.file_path) {
    return toolError(
      "Give the audio master: audio.master_path (already in the private masters bucket) or audio.file_path (a local file to send inline).",
    );
  }

  let request;
  try {
    request = await buildRequest(args);
  } catch (e) {
    return toolError(`Couldn't read a local file: ${e.message}`);
  }

  let res;
  try {
    res = await fetch(`${API_BASE}/api/works/ingest`, {
      method: "POST",
      headers: {
        // The delegated authority. Read from this server's own config — never a
        // tool argument, never echoed back.
        authorization: `Bearer ${INGEST_SECRET}`,
        ...request.headers,
      },
      body: request.body,
    });
  } catch (e) {
    return toolError(`Couldn't reach AIRED at ${API_BASE}: ${e.message}`);
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return toolError(
      `AIRED answered HTTP ${res.status} with a non-JSON body (${text.slice(0, 200)}).`,
    );
  }

  if (!res.ok) {
    // The route's messages are safe to relay: they never include the token.
    return toolError(
      res.status === 401
        ? "AIRED refused the delegated token (401). Check AIRED_INGEST_SECRET and that it is registered against a human authority."
        : `AIRED refused the publish (HTTP ${res.status}): ${data.error ?? text.slice(0, 200)}`,
    );
  }

  const work = data.work ?? {};
  const structuredContent = {
    id: work.id,
    catalog: work.catalog,
    title: work.title,
    status: work.status,
    published_via: work.published_via,
    published_by_authority: work.published_by_authority,
    ingest_token_label: work.ingest_token_label ?? null,
    album_id: work.album_id ?? null,
    volleys: work.volleys ?? 0,
    replay: !!data.replay,
    dropped_names: data.dropped_names ?? [],
  };

  const lines = [
    `${work.catalog} · "${work.title}" landed as a ${work.status}.`,
    `Recorded as published_via=${work.published_via}, authorized by ${work.published_by_authority}${work.ingest_token_label ? ` (token: ${work.ingest_token_label})` : ""}.`,
    `${structuredContent.volleys} volley${structuredContent.volleys === 1 ? "" : "s"} written to the ledger.`,
    data.replay
      ? "This was a replay of an earlier call with the same idempotency_key — no duplicate was created."
      : "A human still promotes it to live from Manage; nothing here goes live on its own.",
  ];
  if (structuredContent.dropped_names.length > 0) {
    lines.push(
      `Withheld from public data (they read as names): ${structuredContent.dropped_names.join(", ")}.`,
    );
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent,
  };
}

// ── Server ──────────────────────────────────────────────────────────────────

const server = new McpServer({ name: "aired", version: "0.1.0" });

server.registerTool(
  "aired_publish_work",
  {
    title: "Publish a work to AIRED (delegated)",
    description:
      "Publish a finished, human-authorized work to AIRED as a draft, via delegated API. Records that the work arrived through delegated authority (published_via=delegated_api) and which human authorized it. Does not auto-publish; the work lands as a draft for human review.",
    inputSchema,
    outputSchema,
    annotations: {
      readOnlyHint: false,
      // Re-sending the same idempotency_key returns the existing draft.
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  publishWork,
);

const transport = new StdioServerTransport();
await server.connect(transport);
log(`ready · delegated publish door → ${API_BASE}/api/works/ingest`);
