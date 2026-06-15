"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

// Create a draft work AFTER its media has been uploaded directly to Supabase
// Storage from the browser (large audio never routes through the server — that
// would hit Vercel's request-body cap and there is no length limit on AIRED
// works). This action only writes the small metadata row.
//
// The catalog id is NOT set here: the bigint identity column assigns it. The
// master lives in the private `masters` bucket via `master_storage_path` (a
// Phase-2 holding column — Rule 6 keeps audio off Supabase serving; R2 + HLS is
// Phase 3). Artwork is a public URL.

export type CreateWorkInput = {
  title: string;
  durationSeconds: number | null;
  masterPath: string;
  artworkUrl: string | null;
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
      status: "draft",
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Couldn't create the work." };
  }

  revalidatePath("/registry");
  return { ok: true, workId: Number(data.id) };
}

export type GoLiveResult = { ok: true } | { ok: false; error: string };

// Publish a draft work — the Phase 4 "Go Live" action. One-directional for now:
// draft → live, never back. We use the session-bound server client (NOT the
// service role), so RLS runs as the user: `work_owner_upd` (creator_id =
// auth.uid()) is what actually enforces ownership. The `status = 'draft'` guard
// scopes the flip and makes a re-click a harmless no-op once the work is live.
export async function goLive(workId: number): Promise<GoLiveResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Sign in to publish a work." };
  }

  const { error } = await supabase
    .from("work")
    .update({ status: "live" })
    .eq("id", workId)
    .eq("status", "draft");

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/registry/${workId}`);
  revalidatePath("/registry");
  return { ok: true };
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
