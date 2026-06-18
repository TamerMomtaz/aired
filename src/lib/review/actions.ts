"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

// Write side of the Review Gate. Each action is a thin wrapper over a SECURITY
// DEFINER RPC that asserts the caller is an admin INSIDE the database — that
// assert (plus the execute-revoked-from-anon grant) is the real authorization,
// not these wrappers and not the UI. Server Actions are reachable by direct POST
// (Next.js docs: "verify authorization inside every Server Function"), so we
// also bail early for a signed-out caller to return a clean message rather than
// a raw RPC error; a signed-in non-admin is stopped by the RPC's own assert.

export type ReviewResult = { ok: true } | { ok: false; error: string };

// Approve a pending submission → it goes live (released_at stamped by the RPC).
export async function approveWork(workId: number): Promise<ReviewResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in as an admin to review." };

  const { error } = await supabase.rpc("review_approve", { p_work_id: workId });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/review");
  revalidatePath("/registry");
  revalidatePath(`/registry/${workId}`);
  revalidatePath("/"); // it now appears in the public feed
  return { ok: true };
}

// Decline a pending submission → back to 'draft' with a one-line reason the
// author sees, so they can revise and re-publish. The note is required here so
// the round-trip is never a silent rejection.
export async function declineWork(
  workId: number,
  note: string,
): Promise<ReviewResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in as an admin to review." };

  const trimmed = (note ?? "").trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "Add a short note so the artist knows what to change.",
    };
  }

  const { error } = await supabase.rpc("review_decline", {
    p_work_id: workId,
    p_note: trimmed,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/review");
  revalidatePath("/registry");
  revalidatePath(`/registry/${workId}`);
  return { ok: true };
}

// Trust a creator → their FUTURE publishes go live instantly. Forward-looking
// only: any items they already have in the queue still need an explicit Approve.
// The RPC never touches is_admin, and cooperates with the profile privilege
// guard (auth.uid() inside it is the admin, so the guard permits the change).
export async function trustArtist(profileId: string): Promise<ReviewResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in as an admin to review." };

  const { error } = await supabase.rpc("set_artist_trusted", {
    p_profile: profileId,
    p_value: true,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/review");
  return { ok: true };
}
