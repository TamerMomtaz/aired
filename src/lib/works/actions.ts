"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { sanitizeDescriptorList } from "@/lib/ledger/sanitizeReference";
import { createClient } from "@/lib/supabase/server";
import { triggerPurge } from "./purge";
import { triggerTranscode } from "./transcode";

// Create a draft work AFTER its media has been uploaded directly to Supabase
// Storage from the browser (large audio never routes through the server — that
// would hit Vercel's request-body cap and there is no length limit on AIRED
// works). This action only writes the small metadata row.
//
// The catalog id is NOT set here: the bigint identity column assigns it. The
// master lives in the private `masters` bucket via `master_storage_path` (a
// Phase-2 holding column — Rule 6 keeps audio off Supabase serving; R2 + HLS is
// Phase 3). Artwork is a public URL.

// Where the new work is filed at creation. "existing" picks one of the creator's
// own albums; "new" creates one inline (its cover is derived from this work's
// artwork — no separate cover upload); "single" leaves album_id NULL on purpose.
export type CreateWorkAlbum =
  | { kind: "existing"; albumId: string }
  | { kind: "new"; title: string; description?: string | null }
  | { kind: "single" };

export type CreateWorkInput = {
  title: string;
  durationSeconds: number | null;
  masterPath: string;
  artworkUrl: string | null;
  // The album step. Defaults to a single if omitted.
  album?: CreateWorkAlbum;
};

export type CreateWorkResult =
  | { ok: true; workId: number }
  | { ok: false; error: string };

export async function createWork(
  input: CreateWorkInput,
): Promise<CreateWorkResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You need to be signed in to upload." };
  }

  const title = (input.title ?? "").trim();
  if (!title) {
    return { ok: false, error: "Give the work a title." };
  }
  if (!input.masterPath) {
    return { ok: false, error: "The audio master didn't upload — try again." };
  }

  const duration =
    input.durationSeconds != null && Number.isFinite(input.durationSeconds)
      ? Math.max(0, Math.round(input.durationSeconds))
      : null;

  // Resolve the album step into an album_id (or null for a single). A "new"
  // choice creates the album first as a normal owner insert (album_owner_ins);
  // its cover is left to derivation (this work's artwork). The
  // enforce_album_ownership trigger validates the link on the work insert below,
  // so an "existing" id that isn't the caller's own album is rejected there.
  const album = input.album ?? { kind: "single" };
  let albumId: string | null = null;
  if (album.kind === "existing") {
    albumId = album.albumId;
  } else if (album.kind === "new") {
    const albumTitle = (album.title ?? "").trim().slice(0, 200);
    if (!albumTitle) {
      return { ok: false, error: "Name the new album, or release as a single." };
    }
    const albumDesc = (album.description ?? "").trim().slice(0, 2000) || null;
    const { data: createdAlbum, error: albumError } = await supabase
      .from("album")
      .insert({ title: albumTitle, description: albumDesc, profile_id: user.id })
      .select("id")
      .single();
    if (albumError || !createdAlbum) {
      return {
        ok: false,
        error: albumError?.message ?? "Couldn't create the album.",
      };
    }
    albumId = createdAlbum.id as string;
  }

  // RLS (work_owner_ins) enforces creator_id = auth.uid(); we set it explicitly
  // from the verified server session.
  const { data, error } = await supabase
    .from("work")
    .insert({
      title,
      creator_id: user.id,
      duration_seconds: duration,
      master_storage_path: input.masterPath,
      artwork_url: input.artworkUrl,
      album_id: albumId,
      status: "draft",
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Couldn't create the work." };
  }

  const workId = Number(data.id);

  // Kick the Railway worker after the response is sent — the user redirects
  // to /registry/[id] immediately while ffmpeg + R2 upload run in the
  // background and fill audio_master_key / hls_playlist_key when done.
  // Status stays `draft`; Go Live is still a deliberate click.
  after(() => triggerTranscode(workId));

  revalidatePath("/registry");
  // The new work (and any inline-created album) shows up on the creator's
  // manage surface immediately.
  revalidatePath("/manage");
  return { ok: true, workId };
}

export type GoLiveResult =
  | { ok: true; status: "live" | "pending" }
  | { ok: false; error: string };

// Publish a draft work — the "Go Live" action, now gated by the Review Gate.
// We use the session-bound server client (NOT the service role), so RLS runs as
// the user: `work_owner_upd` (creator_id = auth.uid()) is what actually enforces
// ownership. The `status = 'draft'` guard scopes the flip and makes a re-click a
// harmless no-op once the work has left draft (live or pending).
//
// The gate: the creator's own `profile.trusted` decides the destination —
//   trusted   → 'live' instantly, released_at stamped (unchanged behavior);
//   untrusted → 'pending' (the Review queue) — hidden from the public until an
//               admin approves; released_at stays NULL until then.
// Either way go-live records the Community Covenant acceptance: the modal in
// GoLiveButton requires the owner to tick the checkbox before this runs, and we
// set `terms_accepted_at = now()` alongside the status flip — the covenant is
// accepted at submit, whichever side of the gate the work lands on.
export async function goLive(workId: number): Promise<GoLiveResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Sign in to publish a work." };
  }

  // Read the author's trust at publish time. profile_read_all lets the owner read
  // their own flag; a missing row reads as untrusted (the safe default).
  const { data: profile } = await supabase
    .from("profile")
    .select("trusted")
    .eq("id", user.id)
    .maybeSingle();
  const trusted = !!profile?.trusted;

  const now = new Date().toISOString();
  const patch = trusted
    ? { status: "live" as const, released_at: now, terms_accepted_at: now }
    : { status: "pending" as const, terms_accepted_at: now };

  const { error } = await supabase
    .from("work")
    .update(patch)
    .eq("id", workId)
    .eq("status", "draft");

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/registry/${workId}`);
  revalidatePath("/registry");
  // A trusted publish enters the public feed; an untrusted one enters the admin
  // Review queue — refresh both so neither shows stale.
  revalidatePath("/");
  revalidatePath("/review");
  return { ok: true, status: trusted ? "live" : "pending" };
}

export type IssueCertificateResult =
  | { ok: true; certId: string }
  | { ok: false; error: string };

// Mint the Red Line certificate for a work (Phase 4 #2 part 2). The Red Line
// certifies AUTHORSHIP & PROCESS only — never resemblance to any artist
// (CLAUDE.md §1.3). We session-bind the Supabase client so RLS runs as the user:
// `certification_owner_ins` (creator_id of the work matches auth.uid()) is what
// actually enforces ownership; the inferred-as-owner guard below just lets us
// return a clean error before talking to the DB. Once a cert exists for a work,
// re-calling is a no-op — `certification` is immutable by design (no UPDATE/
// DELETE policy).
export async function issueCertificate(
  workId: number,
): Promise<IssueCertificateResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Sign in to issue the certificate." };
  }

  const { data: work, error: workErr } = await supabase
    .from("work")
    .select("id, title, creator_id, status, descriptors")
    .eq("id", workId)
    .maybeSingle();
  if (workErr) {
    return { ok: false, error: workErr.message };
  }
  if (!work) {
    return { ok: false, error: "Couldn't find this work." };
  }
  if (work.creator_id !== user.id) {
    return { ok: false, error: "Only the work's owner can issue its Red Line." };
  }
  if (work.status !== "live") {
    return { ok: false, error: "Publish this work before certifying it." };
  }

  // Already certified? Treat as a no-op success so a double-click is harmless.
  const { data: existing } = await supabase
    .from("certification")
    .select("id")
    .eq("work_id", workId)
    .maybeSingle();
  if (existing) {
    return { ok: true, certId: existing.id };
  }

  // Assemble the ledger's contributor lineage. Volleys carry SHAPES only; we
  // surface each contributor exactly once (carbon and silicon, by name) in the
  // order they first appear in the trail.
  const { data: volleys, error: vErr } = await supabase
    .from("public_volley")
    .select("seq, agent:agent_id ( name, type )")
    .eq("work_id", workId)
    .order("seq", { ascending: true });
  if (vErr) {
    return { ok: false, error: vErr.message };
  }

  type VolleyRow = {
    seq: number | string;
    agent: { name: string; type: string } | null;
  };
  const rows = (volleys ?? []) as unknown as VolleyRow[];

  const contributors: Array<{ name: string; type: "human" | "ai" | "tool" }> = [];
  const seen = new Set<string>();
  for (const v of rows) {
    if (!v.agent || !v.agent.name) continue;
    if (seen.has(v.agent.name)) continue;
    seen.add(v.agent.name);
    // Collapse the agent_type enum into the cert's coarser carbon/silicon/tool
    // axis. AI models and AI voices both read as "ai" on the marquee.
    const t: "human" | "ai" | "tool" =
      v.agent.type === "human"
        ? "human"
        : v.agent.type === "tool"
          ? "tool"
          : "ai";
    contributors.push({ name: v.agent.name, type: t });
  }

  const checks = {
    human_origin: contributors.some((c) => c.type === "human"),
    authorship: "declared via volley ledger",
    volley_count: rows.length,
    contributors,
    process: "human-directed, AI-collaborated",
    resemblance_claim: null,
    note: "Certifies authorship and process. Makes no claim of similarity to any artist.",
  };

  const descriptors = Array.isArray(work.descriptors)
    ? (work.descriptors as string[])
    : [];

  const { data: inserted, error: insertErr } = await supabase
    .from("certification")
    .insert({
      work_id: workId,
      checks,
      descriptors,
      cert_url: `https://ai-red.io/cert/${workId}`,
    })
    .select("id")
    .single();
  if (insertErr || !inserted) {
    return {
      ok: false,
      error: insertErr?.message ?? "Couldn't issue the certificate.",
    };
  }

  // Bump the denormalized flag on the work itself so the registry list (and any
  // other surface that reads `red_line_certified` without joining the cert
  // table) shows the Red Line badge immediately. work_owner_upd permits this.
  await supabase
    .from("work")
    .update({ red_line_certified: true })
    .eq("id", workId);

  revalidatePath(`/registry/${workId}`);
  revalidatePath(`/cert/${workId}`);
  revalidatePath("/registry");
  return { ok: true, certId: inserted.id };
}

export type SaveLyricsResult = { ok: true } | { ok: false; error: string };

// Save a work's lyrics (Phase 4 — the "heard" half). The body is LRC: the single
// source of truth for both the words and their timing. Like goLive, this uses the
// session-bound server client (NOT the service role), so RLS runs as the user —
// `work_owner_upd` (creator_id = auth.uid()) is what enforces ownership; a
// non-owner's update simply matches no rows. An empty/whitespace body is stored
// as NULL so the "Add lyrics" affordance returns and the public renders nothing.
export async function saveLyrics(
  workId: number,
  lrc: string,
): Promise<SaveLyricsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Sign in to edit lyrics." };
  }

  const value = lrc && lrc.trim().length > 0 ? lrc : null;

  const { error } = await supabase
    .from("work")
    .update({ lyrics: value })
    .eq("id", workId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/registry/${workId}`);
  return { ok: true };
}

// Edit a work IN PLACE (EDIT & TIDY — the orphan-killer). Updates title, lyrics,
// artwork, descriptors, and album on the SAME row — NO new row, so the AIRED
// number (work.id, minted into certs / QR / share cards / registry URLs) never
// changes. Authorized by work_owner_upd (creator_id = auth.uid()); album_id is
// still vetted by the enforce_album_ownership trigger. status and creator_id are
// never touched, so a live work stays live (v1-simple: a creator's edits to a
// live work do not re-enter Review).
//
// Field semantics let the editor send only what changed:
//   • title / descriptors / album_id — always set (descriptors re-sanitized).
//   • artworkUrl / lyrics — `undefined` leaves the column as-is; a value sets it;
//     `null` clears it. So editing the title can never clobber a synced LRC.
export type UpdateWorkInput = {
  workId: number;
  title: string;
  // Free-text descriptor list (comma/newline separated), sanitized server-side.
  descriptors: string;
  // The chosen album, or null for a single.
  albumId: string | null;
  // undefined = leave; string = set; null = clear.
  artworkUrl?: string | null;
  lyrics?: string | null;
};

export type UpdateWorkResult =
  | { ok: true; droppedNames: string[] }
  | { ok: false; error: string };

export async function updateWork(
  input: UpdateWorkInput,
): Promise<UpdateWorkResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Sign in to edit your work." };
  }

  const title = (input.title ?? "").trim().slice(0, 200);
  if (!title) {
    return { ok: false, error: "Give the work a title." };
  }

  // Reference-sanitizer at the boundary — the SAME guard the upload path runs,
  // so no third-party name reaches the public, searchable descriptor set (Rule
  // 2). Names typed here are dropped and reported back to the editor.
  const { descriptors, dropped } = sanitizeDescriptorList(input.descriptors ?? "");

  const patch: Record<string, unknown> = {
    title,
    descriptors,
    album_id: input.albumId ?? null,
  };
  if (input.artworkUrl !== undefined) {
    patch.artwork_url = input.artworkUrl;
  }
  if (input.lyrics !== undefined) {
    patch.lyrics =
      input.lyrics && input.lyrics.trim().length > 0 ? input.lyrics : null;
  }

  const { error } = await supabase
    .from("work")
    .update(patch)
    .eq("id", input.workId);
  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/registry/${input.workId}`);
  revalidatePath("/registry");
  revalidatePath("/manage");
  // A live work's title/artwork show on the public feed too.
  revalidatePath("/");
  return { ok: true, droppedNames: dropped };
}

export type DiscardWorkResult =
  | { ok: true }
  | { ok: false; error: string; requiresForce?: boolean };

// Discard a work (EDIT & TIDY — your cleanup tool). Deletes the row through
// work_owner_del (creator_id = auth.uid()); the existing ON DELETE CASCADE on
// work's FKs removes its public_volley / private_volley / certification / play
// rows. Then (after the response) the worker sweeps the work's R2 objects +
// private master so nothing is stranded. Other works' AIRED numbers are
// untouched — gaps are fine and deliberate (CLAUDE.md §2).
//
// Safety gate: a plain draft deletes on the first confirm. A LIVE work — or one
// that already has plays or a minted Red Line — carries history the cascade will
// destroy (its certificate + play counts), so it requires an explicit second
// confirm (`force`). The same gate is re-checked here, not just in the UI, so a
// direct POST can't skip it.
export async function discardWork(
  workId: number,
  opts: { force?: boolean } = {},
): Promise<DiscardWorkResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Sign in to discard a work." };
  }

  // RLS returns this row to its owner (or an admin); we still assert ownership so
  // ONLY the creator can discard their own work — never an admin via this path,
  // and never someone else's stranded draft.
  const { data: work, error: readErr } = await supabase
    .from("work")
    .select(
      "id, creator_id, status, master_storage_path, play_count, red_line_certified",
    )
    .eq("id", workId)
    .maybeSingle();
  if (readErr) {
    return { ok: false, error: readErr.message };
  }
  if (!work) {
    return { ok: false, error: "Couldn't find this work." };
  }
  if (work.creator_id !== user.id) {
    return { ok: false, error: "Only the work's owner can discard it." };
  }

  const hasHistory =
    work.status === "live" ||
    (work.play_count ?? 0) > 0 ||
    !!work.red_line_certified;
  if (hasHistory && !opts.force) {
    return {
      ok: false,
      requiresForce: true,
      error:
        "This work is live and has history — confirm again to remove it for good.",
    };
  }

  const { error: delErr } = await supabase
    .from("work")
    .delete()
    .eq("id", workId);
  if (delErr) {
    return { ok: false, error: delErr.message };
  }

  // Sweep the work's stored blobs after the response — best-effort; the row (the
  // ghost) is already gone whether or not the worker is reachable.
  after(() =>
    triggerPurge(workId, { masterStoragePath: work.master_storage_path }),
  );

  revalidatePath("/manage");
  revalidatePath("/upload");
  revalidatePath("/registry");
  if (work.status === "live") {
    revalidatePath("/");
    revalidatePath(`/registry/${workId}`);
  }
  return { ok: true };
}
