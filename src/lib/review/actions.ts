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

// Take a work DOWN off every public surface — admin governance that works on ANY
// work, including a LIVE one already approved through Review. A thin wrapper over
// the SECURITY DEFINER admin_takedown_work RPC, which asserts is_admin inside the
// DB; the signed-out bail here is just for a clean message. A reason is required
// so the owner always learns why. The guard_work_takedown trigger means even a
// trusted creator can't undo this — only an admin's Restore can.
export async function takedownWork(
  workId: number,
  reason: string,
): Promise<ReviewResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in as an admin to take down a work." };

  const trimmed = (reason ?? "").trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "Add a short reason — the owner will see why it was taken down.",
    };
  }

  const { error } = await supabase.rpc("admin_takedown_work", {
    p_work_id: workId,
    p_reason: trimmed,
  });
  if (error) return { ok: false, error: error.message };

  // It must vanish from every public surface at once (the RLS change is the real
  // gate; these revalidations refresh the cached renders).
  revalidatePath("/");
  revalidatePath("/registry");
  revalidatePath(`/registry/${workId}`);
  revalidatePath("/review");
  revalidatePath("/review/taken-down");
  return { ok: true };
}

// Restore a taken-down work — admin-only, clears taken_down + reason via the
// admin_restore_work RPC. The work returns to whatever status it held (a live one
// reappears on the public shelf immediately).
export async function restoreWork(workId: number): Promise<ReviewResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in as an admin to restore a work." };

  const { error } = await supabase.rpc("admin_restore_work", {
    p_work_id: workId,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  revalidatePath("/registry");
  revalidatePath(`/registry/${workId}`);
  revalidatePath("/review");
  revalidatePath("/review/taken-down");
  return { ok: true };
}
