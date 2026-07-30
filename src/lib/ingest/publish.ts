// The delegated door — landing a finished work as a DRAFT on a human's
// delegated authority (the honest wheelbarrow).
//
// This is a new DOOR, not a new pipeline and not a new ledger. Everything it
// touches is the same machinery the web UI uses:
//   • the master lands in the private `masters` bucket, artwork in the public
//     `artwork` bucket — the same buckets, the same owner-folder key convention;
//   • the catalog number is minted by the same bigint identity column;
//   • the Volley Ledger is written by writeVolley() — the same sanitize → hash →
//     seal → atomic paired-write the editor calls;
//   • the contributor rows come from resolveContributor() — the same
//     find-or-create, so a name never fractures into two discographies;
//   • ffmpeg → HLS is kicked by the same triggerTranscode() the UI path uses.
//
// What it adds is the second honest fact: `published_via = 'delegated_api'` plus
// the human authority that authorized it. It NEVER publishes: the work lands at
// status 'draft' and a human still promotes it (Go Live). The
// enforce_publish_honesty trigger refuses any row that says otherwise.
//
// SERVER ONLY. Runs on the service client — RLS is bypassed there, so every
// ownership question is answered HERE, before a write, and the DB triggers
// remain the structural backstop.

import { formatCatalogId } from "@/lib/catalog";
import { findExistingAgent, resolveContributor } from "@/lib/agents/resolve";
import { sanitizeDescriptorList } from "@/lib/ledger/sanitizeReference";
import type { Craft } from "@/lib/ledger/seal";
import {
  AGENT_TYPES,
  DELTA_TYPES,
  VOLLEY_ORIGINS,
  VOLLEY_ROLES,
  originConflictMessage,
  type AgentType,
  type DeltaType,
  type VolleyOrigin,
  type VolleyRole,
} from "@/lib/ledger/types";
import { writeVolley } from "@/lib/ledger/write";
import { SUPABASE_URL } from "@/lib/supabase/config";
import { createServiceClient } from "@/lib/supabase/service";
import type { DelegatedAuthority } from "./tokens";

// Same buckets as the human upload path (upload-form.tsx): the master is PRIVATE
// and never served (Rule 6 — audio reaches listeners only from R2 via the CDN,
// after the worker transcodes it); artwork is public-read.
const MASTERS_BUCKET = "masters";
const ARTWORK_BUCKET = "artwork";

const TITLE_MAX = 200;
const ALBUM_TITLE_MAX = 200;
const ALBUM_DESC_MAX = 2000;
/** A ledger has to fit in one request; this is a sanity bound, not a ceiling on craft. */
const VOLLEY_MAX = 64;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IngestAudio =
  | { kind: "path"; masterPath: string }
  | { kind: "file"; file: File };

export type IngestArtwork =
  | { kind: "path"; path: string }
  | { kind: "file"; file: File };

export type IngestPlacement =
  | { mode: "single" }
  | { mode: "album"; albumId: string }
  | { mode: "new_album"; title: string; description?: string | null };

export type IngestVolley = {
  seq: number;
  /** An existing agent id, or a contributor to resolve by name (find-or-create). */
  agentId?: string;
  contributor?: { name: string; type?: AgentType; version?: string };
  role: VolleyRole;
  origin: VolleyOrigin;
  deltaType: DeltaType;
  craft?: Partial<Craft>;
};

export type IngestWorkInput = {
  title: string;
  audio: IngestAudio;
  artwork?: IngestArtwork | null;
  placement?: IngestPlacement;
  /** Public, sanitized sonic descriptors (never a person's name — Rule 2). */
  descriptors?: string;
  durationSeconds?: number | null;
  volley?: IngestVolley[];
  idempotencyKey: string;
};

export type IngestedWork = {
  workId: number;
  catalog: string;
  title: string;
  status: "draft";
  publishedVia: "delegated_api";
  publishedByAuthority: string;
  ingestTokenLabel: string;
  albumId: string | null;
  volleyCount: number;
  /** True when this call resolved to a work an earlier identical call created. */
  replay: boolean;
  /** Descriptor tokens dropped by the reference-sanitizer (Rule 2). */
  droppedNames: string[];
};

export type IngestResult =
  | { ok: true; work: IngestedWork }
  | { ok: false; status: 400 | 409 | 500; error: string };

function bad(error: string): IngestResult {
  return { ok: false, status: 400, error };
}

function fileExt(name: string, fallback: string): string {
  const ext = name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext && ext.length <= 5 ? ext : fallback;
}

// A caller may only ever reference storage inside its OWN authority's folder.
// The service client bypasses Storage RLS, so this check — not the bucket policy
// — is what stops a delegated token from attaching another creator's private
// master or artwork to its work. Keys are `<authority-uuid>/<upload-uuid>/<file>`,
// exactly as the web upload writes them.
function ownedByAuthority(path: string, authorityUserId: string): boolean {
  return path.startsWith(`${authorityUserId}/`) && !path.includes("..");
}

type ServiceClient = ReturnType<typeof createServiceClient>;

// The already-landed work for this (authority, idempotency key), or null.
// Scoped by authority as well as key: two delegating humans must never resolve
// each other's works through a colliding uuid.
async function findReplay(
  supabase: ServiceClient,
  authorityUserId: string,
  idempotencyKey: string,
): Promise<{ id: number; title: string; album_id: string | null } | null> {
  const { data } = await supabase
    .from("work")
    .select("id, title, album_id")
    .eq("published_by_authority", authorityUserId)
    .eq("ingest_idempotency_key", idempotencyKey)
    .maybeSingle();
  return data ?? null;
}

async function countVolleys(
  supabase: ServiceClient,
  workId: number,
): Promise<number> {
  const { count } = await supabase
    .from("public_volley")
    .select("id", { count: "exact", head: true })
    .eq("work_id", workId);
  return count ?? 0;
}

export async function ingestWork(
  authority: DelegatedAuthority,
  input: IngestWorkInput,
): Promise<IngestResult> {
  const { authorityUserId, label } = authority;

  // ── Validate the envelope ─────────────────────────────────────────────────
  // Cheap, purely-local checks run FIRST, before a client exists — a malformed
  // request is answered without touching the database at all.
  const idempotencyKey = (input.idempotencyKey ?? "").trim();
  if (!UUID_RE.test(idempotencyKey)) {
    return bad("idempotency_key is required and must be a uuid.");
  }

  const title = (input.title ?? "").trim().slice(0, TITLE_MAX);
  if (!title) {
    return bad("Give the work a title.");
  }

  const volleys = input.volley ?? [];
  if (volleys.length > VOLLEY_MAX) {
    return bad(`Declare at most ${VOLLEY_MAX} volleys per request.`);
  }

  // The ledger's SHAPE is checkable without a database — vocabulary, sequence,
  // and whether each volley credits anyone at all. Reject a malformed trail here,
  // before a connection is opened, so a bad payload costs nothing.
  for (const [i, v] of volleys.entries()) {
    const at = `volley[${i}]`;
    if (!Number.isFinite(typeof v.seq === "number" ? v.seq : Number(v.seq))) {
      return bad(`${at}: seq must be a number (e.g. 0, 1, 1.5).`);
    }
    if (!(VOLLEY_ROLES as readonly string[]).includes(v.role)) {
      return bad(`${at}: unknown role "${v.role}".`);
    }
    if (!(VOLLEY_ORIGINS as readonly string[]).includes(v.origin)) {
      return bad(`${at}: unknown origin "${v.origin}".`);
    }
    if (!(DELTA_TYPES as readonly string[]).includes(v.deltaType)) {
      return bad(`${at}: unknown delta_type "${v.deltaType}".`);
    }
    if (v.agentId && !UUID_RE.test(v.agentId)) {
      return bad(`${at}: agent_id must be a uuid.`);
    }
    if (!v.agentId && !v.contributor?.name?.trim()) {
      return bad(`${at}: credit a contributor (agent_id or contributor.name).`);
    }
    if (
      v.contributor?.type &&
      !(AGENT_TYPES as readonly string[]).includes(v.contributor.type)
    ) {
      return bad(
        `${at}: unknown contributor.type "${v.contributor.type}" — use human, ai_model, ai_voice, or tool.`,
      );
    }
  }

  const supabase = createServiceClient();

  // ── Idempotency: a retry returns the draft it already made ────────────────
  const existing = await findReplay(supabase, authorityUserId, idempotencyKey);
  if (existing) {
    return {
      ok: true,
      work: {
        workId: Number(existing.id),
        catalog: formatCatalogId(Number(existing.id)),
        title: existing.title,
        status: "draft",
        publishedVia: "delegated_api",
        publishedByAuthority: authorityUserId,
        ingestTokenLabel: label,
        albumId: existing.album_id,
        volleyCount: await countVolleys(supabase, Number(existing.id)),
        replay: true,
        droppedNames: [],
      },
    };
  }

  // ── Resolve the ledger's contributors BEFORE anything is written ──────────
  // A bad volley must never leave a work behind, so every contributor is
  // resolved and every origin checked up front. Resolving a contributor is
  // idempotent find-or-create, so it is safe to do before the work exists.
  type PreparedVolley = {
    seq: number;
    agentId: string;
    role: VolleyRole;
    origin: VolleyOrigin;
    deltaType: DeltaType;
    craft: Craft;
  };
  const prepared: PreparedVolley[] = [];

  for (const [i, v] of volleys.entries()) {
    const at = `volley[${i}]`;
    const seq = typeof v.seq === "number" ? v.seq : Number(v.seq);

    // WHO MADE IT — always by name, always public (Rule 3a). Either an existing
    // agent id, or a name we resolve through the same find-or-create the editor
    // uses so one maker keeps one page and one discography.
    let agentId: string;
    let agentType: AgentType | null = null;
    if (v.agentId) {
      const { data: agentRow } = await supabase
        .from("agent")
        .select("id, type")
        .eq("id", v.agentId)
        .maybeSingle();
      if (!agentRow) {
        return bad(`${at}: no contributor with that agent_id.`);
      }
      agentId = agentRow.id as string;
      agentType = agentRow.type as AgentType;
    } else if (v.contributor?.name) {
      // An existing contributor keeps their own type — their identity is theirs,
      // not something a caller redefines per volley. A contributor we have never
      // seen needs `type` stated: we will NOT guess whether a new public name is
      // a person, a model, a voice, or a tool, because that row becomes their
      // page (Rule 3a).
      const known = await findExistingAgent(supabase, v.contributor.name);
      if (known) {
        agentId = known.id;
        agentType = known.type;
      } else {
        if (!v.contributor.type) {
          return bad(
            `${at}: "${v.contributor.name}" is a new contributor — state contributor.type (human, ai_model, ai_voice, or tool) so their page is right.`,
          );
        }
        const resolved = await resolveContributor(supabase, {
          name: v.contributor.name,
          type: v.contributor.type,
          version: v.contributor.version,
        });
        if (!resolved.ok) {
          return bad(`${at}: ${resolved.error}`);
        }
        agentId = resolved.agent.id;
        agentType = resolved.agent.type;
      }
    } else {
      // Unreachable — the shape pass above already required one of the two. Kept
      // so `agentId` is provably assigned.
      return bad(`${at}: credit a contributor (agent_id or contributor.name).`);
    }

    // Origin must never contradict the contributor's type — the same rule the
    // editor guides and the enforce_volley_origin trigger enforces. Caught here
    // so the caller gets a clear message instead of a raw DB exception, and so
    // no work row is left behind by a rejected ledger.
    if (agentType) {
      const conflict = originConflictMessage(agentType, v.origin);
      if (conflict) {
        return bad(`${at}: ${conflict}`);
      }
    }

    prepared.push({
      seq,
      agentId,
      role: v.role,
      origin: v.origin,
      deltaType: v.deltaType,
      craft: {
        prompt: v.craft?.prompt ?? "",
        style_reference_raw: v.craft?.style_reference_raw ?? "",
        rejected_branches: v.craft?.rejected_branches ?? "",
        rationale: v.craft?.rationale ?? "",
      },
    });
  }

  // ── Placement (single / existing album / new album) ────────────────────────
  const placement: IngestPlacement = input.placement ?? { mode: "single" };
  let albumId: string | null = null;
  let createdAlbumId: string | null = null;
  if (placement.mode === "album") {
    if (!UUID_RE.test(placement.albumId ?? "")) {
      return bad("placement.album_id must be a uuid.");
    }
    // The service client bypasses RLS, so verify ownership here. The
    // enforce_album_ownership trigger is the structural backstop on the insert.
    const { data: album } = await supabase
      .from("album")
      .select("id, profile_id")
      .eq("id", placement.albumId)
      .maybeSingle();
    if (!album || album.profile_id !== authorityUserId) {
      return bad("That album doesn't belong to the authorizing artist.");
    }
    albumId = album.id as string;
  } else if (placement.mode === "new_album") {
    const albumTitle = (placement.title ?? "").trim().slice(0, ALBUM_TITLE_MAX);
    if (!albumTitle) {
      return bad("placement.new_album_title is required to start an album.");
    }
    const albumDesc =
      (placement.description ?? "").trim().slice(0, ALBUM_DESC_MAX) || null;
    const { data: created, error: albumError } = await supabase
      .from("album")
      .insert({
        title: albumTitle,
        description: albumDesc,
        profile_id: authorityUserId,
      })
      .select("id")
      .single();
    if (albumError || !created) {
      return {
        ok: false,
        status: 500,
        error: albumError?.message ?? "Couldn't create the album.",
      };
    }
    albumId = created.id as string;
    createdAlbumId = albumId;
  }

  // Roll back an album we created inline, if the work never lands.
  async function discardCreatedAlbum() {
    if (createdAlbumId) {
      await supabase.from("album").delete().eq("id", createdAlbumId);
    }
  }

  // ── Media ─────────────────────────────────────────────────────────────────
  // Either the master is already in the private bucket (the caller uploaded it
  // with its own Supabase-authenticated client, which is how a long track gets
  // there without passing through a serverless request body), or it rides along
  // inline and we put it there — the same bucket and key shape either way.
  const uploadId = crypto.randomUUID();
  let masterPath: string;
  if (input.audio.kind === "path") {
    const path = (input.audio.masterPath ?? "").trim().replace(/^\/+/, "");
    if (!path) {
      await discardCreatedAlbum();
      return bad("audio.master_path is required.");
    }
    if (!ownedByAuthority(path, authorityUserId)) {
      await discardCreatedAlbum();
      return bad(
        "audio.master_path must live in the authorizing artist's own folder.",
      );
    }
    // The object has to exist, or the work would land pointing at nothing and the
    // transcode would fail out of band. `search` is a substring filter, so match
    // the filename exactly rather than trusting a near-miss.
    const folder = path.split("/").slice(0, -1).join("/");
    const filename = path.split("/").pop() ?? "";
    const { data: found } = await supabase.storage
      .from(MASTERS_BUCKET)
      .list(folder, { search: filename, limit: 100 });
    if (!found?.some((o) => o.name === filename)) {
      await discardCreatedAlbum();
      return bad(`No master found at ${MASTERS_BUCKET}/${path}.`);
    }
    masterPath = path;
  } else {
    const file = input.audio.file;
    masterPath = `${authorityUserId}/${uploadId}/master.${fileExt(file.name, "bin")}`;
    const { error: upErr } = await supabase.storage
      .from(MASTERS_BUCKET)
      .upload(masterPath, file, {
        upsert: false,
        contentType: file.type || undefined,
        cacheControl: "3600",
      });
    if (upErr) {
      await discardCreatedAlbum();
      return { ok: false, status: 500, error: `Audio upload failed: ${upErr.message}` };
    }
  }

  // Artwork is optional, public-read, and must end up in OUR artwork bucket —
  // never a foreign URL (the app only renders images from it).
  let artworkUrl: string | null = null;
  if (input.artwork) {
    if (input.artwork.kind === "path") {
      const path = (input.artwork.path ?? "").trim().replace(/^\/+/, "");
      if (!ownedByAuthority(path, authorityUserId)) {
        await discardCreatedAlbum();
        return bad(
          "artwork.path must live in the authorizing artist's own folder.",
        );
      }
      artworkUrl = `${SUPABASE_URL}/storage/v1/object/public/${ARTWORK_BUCKET}/${path}`;
    } else {
      const file = input.artwork.file;
      const artPath = `${authorityUserId}/${uploadId}/cover.${fileExt(file.name, "png")}`;
      const { error: artErr } = await supabase.storage
        .from(ARTWORK_BUCKET)
        .upload(artPath, file, {
          upsert: false,
          contentType: file.type || undefined,
          cacheControl: "3600",
        });
      if (artErr) {
        await discardCreatedAlbum();
        return {
          ok: false,
          status: 500,
          error: `Artwork upload failed: ${artErr.message}`,
        };
      }
      artworkUrl = supabase.storage.from(ARTWORK_BUCKET).getPublicUrl(artPath)
        .data.publicUrl;
    }
  }

  // Reference-sanitizer at the boundary — the same guard the upload and editor
  // paths run, so no third-party name reaches the public, searchable descriptor
  // set (Rule 2), whichever door the work came through.
  const { descriptors, dropped } = sanitizeDescriptorList(
    input.descriptors ?? "",
  );

  const duration =
    input.durationSeconds != null && Number.isFinite(input.durationSeconds)
      ? Math.max(0, Math.round(input.durationSeconds))
      : null;

  // ── The work row ──────────────────────────────────────────────────────────
  // status 'draft' is hard-coded: this door cannot publish. creator_id is the
  // authorizing human — the delegated publish is filed under the artist whose
  // authority carried it, and published_by_authority states that plainly.
  const { data: workRow, error: workError } = await supabase
    .from("work")
    .insert({
      title,
      creator_id: authorityUserId,
      duration_seconds: duration,
      master_storage_path: masterPath,
      artwork_url: artworkUrl,
      album_id: albumId,
      descriptors,
      status: "draft",
      published_via: "delegated_api",
      published_by_authority: authorityUserId,
      ingest_token_label: label,
      ingest_idempotency_key: idempotencyKey,
    })
    .select("id")
    .single();

  if (workError || !workRow) {
    // 23505 = unique violation: a concurrent identical POST won the idempotency
    // index. Resolve to the work that call created rather than erroring.
    if (workError?.code === "23505") {
      const raced = await findReplay(supabase, authorityUserId, idempotencyKey);
      if (raced) {
        await discardCreatedAlbum();
        return {
          ok: true,
          work: {
            workId: Number(raced.id),
            catalog: formatCatalogId(Number(raced.id)),
            title: raced.title,
            status: "draft",
            publishedVia: "delegated_api",
            publishedByAuthority: authorityUserId,
            ingestTokenLabel: label,
            albumId: raced.album_id,
            volleyCount: await countVolleys(supabase, Number(raced.id)),
            replay: true,
            droppedNames: [],
          },
        };
      }
    }
    await discardCreatedAlbum();
    return {
      ok: false,
      status: 500,
      error: workError?.message ?? "Couldn't create the work.",
    };
  }

  const workId = Number(workRow.id);

  // ── The ledger ────────────────────────────────────────────────────────────
  // Each volley is its own atomic paired write (the declare_volley RPC). If any
  // one fails we do NOT leave a half-attested work standing: the work row is
  // deleted, its already-written volleys cascade away with it, and the caller can
  // retry the same idempotency key cleanly. Nothing half-made keeps an AIRED
  // number.
  for (const [i, v] of prepared.entries()) {
    const result = await writeVolley(supabase, {
      workId,
      seq: v.seq,
      agentId: v.agentId,
      role: v.role,
      origin: v.origin,
      deltaType: v.deltaType,
      craft: v.craft,
    });
    if (!result.ok) {
      const { error: cleanupError } = await supabase
        .from("work")
        .delete()
        .eq("id", workId);
      await discardCreatedAlbum();
      if (cleanupError) {
        // Cleanup failed — say so plainly rather than reporting a clean rollback
        // that did not happen. The draft is visible in Manage and can be
        // discarded there; a retry of this key would resolve to it.
        return {
          ok: false,
          status: 500,
          error: `volley[${i}] failed (${result.error}) and the partial draft ${formatCatalogId(workId)} could NOT be removed (${cleanupError.message}) — discard it in Manage before retrying.`,
        };
      }
      return {
        ok: false,
        status: 400,
        error: `volley[${i}] failed: ${result.error}. Nothing was kept — retry with the same idempotency_key.`,
      };
    }
  }

  return {
    ok: true,
    work: {
      workId,
      catalog: formatCatalogId(workId),
      title,
      status: "draft",
      publishedVia: "delegated_api",
      publishedByAuthority: authorityUserId,
      ingestTokenLabel: label,
      albumId,
      volleyCount: prepared.length,
      replay: false,
      droppedNames: dropped,
    },
  };
}
