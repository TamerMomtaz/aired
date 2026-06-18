"use server";

import { revalidatePath } from "next/cache";

import { handleError, slugifyHandle } from "@/lib/identity/handle";
import { SUPABASE_URL } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

// The artist identity (THE JOURNEY). Every write here is the signed-in user
// editing their OWN profile row — authorized by profile_self_upd
// (auth.uid() = id), never an elevated power. The profile_privilege_guard
// trigger still protects trusted / is_admin; these fields (display_name, handle,
// mascot, bio, avatars, onboarded_at) are the user's to set. handle is unique
// (profile_handle_key), so the DB is the final arbiter — we pre-check for a
// friendly message and translate a race-lost unique violation into a retry.

export type IdentityResult = { ok: true } | { ok: false; error: string };

const NAME_MAX = 80;
const MASCOT_MAX = 80;
const BIO_MAX = 600;

// undefined = leave the column as-is; "" / null = clear it; a string = set it.
type Editable = string | null | undefined;

function cleanText(v: Editable, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = v.trim().slice(0, max);
  return t.length > 0 ? t : null;
}

// An avatar / mascot image must be one we hosted: the public `artwork` bucket,
// inside the caller's own folder (uid is segment 1) — never an arbitrary URL —
// mirroring setAlbumCoverUpload. undefined leaves it; null clears it.
function cleanOwnImageUrl(
  v: Editable,
  userId: string,
): { ok: true; value: string | null | undefined } | { ok: false } {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null || v.trim() === "") return { ok: true, value: null };
  const base = `${SUPABASE_URL}/storage/v1/object/public/artwork/`;
  const url = v.trim();
  if (!url.startsWith(base) || !url.slice(base.length).startsWith(`${userId}/`)) {
    return { ok: false };
  }
  return { ok: true, value: url };
}

// Resolve and validate a desired handle for `userId`. Returns the normalized
// handle or an error. Uniqueness is checked against every OTHER profile (the
// caller keeping their own handle is fine). profile_read_all lets us read it.
async function resolveHandle(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rawHandle: string,
  userId: string,
): Promise<{ ok: true; handle: string } | { ok: false; error: string }> {
  const handle = slugifyHandle(rawHandle);
  const err = handleError(handle);
  if (err) return { ok: false, error: err };

  const { data: clash } = await supabase
    .from("profile")
    .select("id")
    .eq("handle", handle)
    .maybeSingle();
  if (clash && clash.id !== userId) {
    return {
      ok: false,
      error: `"${handle}" is already taken — try another.`,
    };
  }
  return { ok: true, handle };
}

// Is a handle free for the signed-in user? Drives the wizard's live check so a
// collision is shown before submit (graceful retry). Format errors come back as
// available:false with the reason.
export type HandleCheck =
  | { ok: true; available: boolean; handle: string; reason?: string }
  | { ok: false; error: string };

export async function checkHandle(rawHandle: string): Promise<HandleCheck> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to choose a handle." };

  const handle = slugifyHandle(rawHandle);
  const fmt = handleError(handle);
  if (fmt) return { ok: true, available: false, handle, reason: fmt };

  const { data: clash } = await supabase
    .from("profile")
    .select("id")
    .eq("handle", handle)
    .maybeSingle();
  const available = !clash || clash.id === user.id;
  return {
    ok: true,
    available,
    handle,
    reason: available ? undefined : `"${handle}" is already taken.`,
  };
}

// Translate a unique-violation on profile.handle into a friendly retry message;
// pass other errors through.
function describeWriteError(error: { code?: string; message: string }): string {
  if (error.code === "23505" || /profile_handle_key|duplicate key/i.test(error.message)) {
    return "That handle was just taken — pick another.";
  }
  return error.message;
}

// Step 1 of the walk: name your artist. display_name + handle are REQUIRED; bio
// and avatar are optional. avatarUrl undefined leaves it (the wizard only sends
// one when an image was uploaded).
export async function saveArtistIdentity(input: {
  displayName: string;
  handle: string;
  bio?: Editable;
  avatarUrl?: Editable;
}): Promise<IdentityResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to name your artist." };

  const displayName = (input.displayName ?? "").trim().slice(0, NAME_MAX);
  if (!displayName) return { ok: false, error: "Give your artist a name." };

  const resolved = await resolveHandle(supabase, input.handle ?? "", user.id);
  if (!resolved.ok) return resolved;

  const avatar = cleanOwnImageUrl(input.avatarUrl, user.id);
  if (!avatar.ok) {
    return { ok: false, error: "Upload an image to use as your avatar." };
  }

  const patch: Record<string, unknown> = {
    display_name: displayName,
    handle: resolved.handle,
  };
  const bio = cleanText(input.bio, BIO_MAX);
  if (bio !== undefined) patch.bio = bio;
  if (avatar.value !== undefined) patch.avatar_url = avatar.value;

  const { error } = await supabase.from("profile").update(patch).eq("id", user.id);
  if (error) return { ok: false, error: describeWriteError(error) };

  revalidatePath("/", "layout");
  revalidatePath(`/artist/${resolved.handle}`);
  revalidatePath(`/artist/${user.id}`);
  return { ok: true };
}

// Step 2 of the walk: your mascot — the emblem of their voices (like the
// founder's "Kahotia"). Both fields optional; Skip leaves them untouched.
export async function saveMascot(input: {
  mascotName?: Editable;
  mascotAvatarUrl?: Editable;
}): Promise<IdentityResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to set your mascot." };

  const mascotImg = cleanOwnImageUrl(input.mascotAvatarUrl, user.id);
  if (!mascotImg.ok) {
    return { ok: false, error: "Upload an image to use for your mascot." };
  }

  const patch: Record<string, unknown> = {};
  const name = cleanText(input.mascotName, MASCOT_MAX);
  if (name !== undefined) patch.mascot_name = name;
  if (mascotImg.value !== undefined) patch.mascot_avatar_url = mascotImg.value;

  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase.from("profile").update(patch).eq("id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

// Step 4: the walk is done — stamp onboarded_at so it never runs again. Set from
// the verified session; idempotent (a re-run just rewrites the timestamp).
export async function completeOnboarding(): Promise<IdentityResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to finish setting up." };

  const { error } = await supabase
    .from("profile")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

// The always-available identity editor (/settings). Edits any subset of the
// profile's identity fields with the same owner RLS. display_name + handle stay
// required (they anchor the artist page); the rest clear on empty.
export async function updateIdentity(input: {
  displayName: string;
  handle: string;
  bio?: Editable;
  avatarUrl?: Editable;
  mascotName?: Editable;
  mascotAvatarUrl?: Editable;
}): Promise<IdentityResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to edit your identity." };

  const displayName = (input.displayName ?? "").trim().slice(0, NAME_MAX);
  if (!displayName) return { ok: false, error: "Give your artist a name." };

  const resolved = await resolveHandle(supabase, input.handle ?? "", user.id);
  if (!resolved.ok) return resolved;

  const avatar = cleanOwnImageUrl(input.avatarUrl, user.id);
  if (!avatar.ok) {
    return { ok: false, error: "Upload an image to use as your avatar." };
  }
  const mascotImg = cleanOwnImageUrl(input.mascotAvatarUrl, user.id);
  if (!mascotImg.ok) {
    return { ok: false, error: "Upload an image to use for your mascot." };
  }

  const patch: Record<string, unknown> = {
    display_name: displayName,
    handle: resolved.handle,
  };
  const bio = cleanText(input.bio, BIO_MAX);
  if (bio !== undefined) patch.bio = bio;
  const mascotName = cleanText(input.mascotName, MASCOT_MAX);
  if (mascotName !== undefined) patch.mascot_name = mascotName;
  if (avatar.value !== undefined) patch.avatar_url = avatar.value;
  if (mascotImg.value !== undefined) patch.mascot_avatar_url = mascotImg.value;

  const { error } = await supabase.from("profile").update(patch).eq("id", user.id);
  if (error) return { ok: false, error: describeWriteError(error) };

  revalidatePath("/", "layout");
  revalidatePath("/settings");
  revalidatePath(`/artist/${resolved.handle}`);
  revalidatePath(`/artist/${user.id}`);
  return { ok: true };
}
