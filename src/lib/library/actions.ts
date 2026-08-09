"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

// Write side of the listener's library — the Adorned shelf and the Moods Feed.
//
// Every action runs on the session-bound anon client (NEVER the service role),
// so RLS is the real authorization: adornment_{ins,del}_own pin every heart to
// profile_id = auth.uid(), and the mood / mood_item policies pin every list and
// every song in it to its owner. Server Actions are reachable by direct POST, so
// none of this leans on the UI having hidden a button. We still bail early for a
// signed-out caller to return a clean sentence rather than a raw RLS error.
//
// A note on what this data is NOT: an adornment is not attribution. It records
// that a listener kept a song, changes nothing about who made it, and never
// reaches a public surface. The Volley Ledger is untouched by everything here.

export type LibraryResult = { ok: true } | { ok: false; error: string };
export type AdornResult =
  | { ok: true; adorned: boolean }
  | { ok: false; error: string };
export type CreateMoodResult =
  | { ok: true; moodId: string }
  | { ok: false; error: string };

const NAME_MAX = 80;
const DESC_MAX = 2000;

function cleanName(raw: string | null | undefined): string {
  return (raw ?? "").trim().slice(0, NAME_MAX);
}
function cleanDescription(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().slice(0, DESC_MAX);
  return v.length > 0 ? v : null;
}

// ── Adorned ────────────────────────────────────────────────────────────────

// Toggle the heart on one song, and report the state it ended in so the client
// can reconcile its optimistic paint against what the database actually did.
//
// The read-then-write is deliberately not a transaction: two taps racing can
// only ever end in "present" or "absent", the unique constraint refuses a
// double-insert, and a delete of an already-gone row is a no-op. There is no
// interleaving that corrupts anything — so a lock here would buy nothing.
export async function toggleAdornment(workId: number): Promise<AdornResult> {
  if (!Number.isInteger(workId) || workId <= 0) {
    return { ok: false, error: "That isn't a song." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to keep a song." };

  const { data: existing } = await supabase
    .from("adornment")
    .select("id")
    .eq("work_id", workId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("adornment")
      .delete()
      .eq("work_id", workId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/adorned");
    return { ok: true, adorned: false };
  }

  // profile_id comes from the verified session, never from the client — the
  // insert policy would refuse anything else anyway.
  const { error } = await supabase
    .from("adornment")
    .insert({ work_id: workId, profile_id: user.id });
  // Two taps that raced: the row is there, which is the state we wanted.
  if (error && error.code !== "23505") {
    return { ok: false, error: error.message };
  }
  revalidatePath("/adorned");
  return { ok: true, adorned: true };
}

// ── Moods ──────────────────────────────────────────────────────────────────

// What the "Add to a mood" sheet needs, fetched when it opens rather than
// server-rendered into every card on the feed: a listener with twelve moods
// shouldn't pay for twelve rows of markup behind every song they scroll past.
// `contains` is what turns "add it again" into a tick.
export type MoodChoice = { id: string; name: string; contains: boolean };

export async function listMoodsForWork(
  workId: number,
): Promise<{ ok: true; moods: MoodChoice[] } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to build a mood." };

  // Both reads are RLS-scoped to the caller, so neither needs an owner filter.
  const [{ data: moods, error }, { data: items }] = await Promise.all([
    supabase
      .from("mood")
      .select("id, name")
      .order("created_at", { ascending: false }),
    supabase.from("mood_item").select("mood_id").eq("work_id", workId),
  ]);
  if (error) return { ok: false, error: error.message };

  const holding = new Set(
    ((items ?? []) as { mood_id: string }[]).map((r) => r.mood_id),
  );
  return {
    ok: true,
    moods: ((moods ?? []) as { id: string; name: string }[]).map((m) => ({
      id: m.id,
      name: m.name,
      contains: holding.has(m.id),
    })),
  };
}

// Create an empty mood, optionally dropping a first song straight into it — the
// "New mood" path from a song's Add-to sheet, so naming and adding is one step.
export async function createMood(input: {
  name: string;
  workId?: number | null;
}): Promise<CreateMoodResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to build a mood." };

  const name = cleanName(input.name);
  if (!name) return { ok: false, error: "Give the mood a name." };

  const { data, error } = await supabase
    .from("mood")
    .insert({ name, profile_id: user.id })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Couldn't create the mood." };
  }
  const moodId = data.id as string;

  if (input.workId) {
    const { error: addError } = await supabase.rpc("mood_add_work", {
      p_mood_id: moodId,
      p_work_id: input.workId,
    });
    // The mood exists either way; a song that wouldn't go in is worth saying so
    // rather than silently handing back an empty list.
    if (addError) {
      revalidatePath("/moods");
      return { ok: false, error: addError.message };
    }
  }

  revalidatePath("/moods");
  return { ok: true, moodId };
}

export async function renameMood(
  moodId: string,
  input: { name: string; description?: string | null },
): Promise<LibraryResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to edit your mood." };

  const name = cleanName(input.name);
  if (!name) return { ok: false, error: "Give the mood a name." };

  const { error } = await supabase
    .from("mood")
    .update({ name, description: cleanDescription(input.description) })
    .eq("id", moodId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/moods");
  revalidatePath(`/moods/${moodId}`);
  return { ok: true };
}

// Delete a mood. Owner-only by RLS; its items go with it (ON DELETE CASCADE).
// The songs themselves are untouched — a mood is a way of holding the catalog,
// never the catalog itself.
export async function deleteMood(moodId: string): Promise<LibraryResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to delete your mood." };

  const { error } = await supabase.from("mood").delete().eq("id", moodId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/moods");
  return { ok: true };
}

// Add a song to a mood. The RPC owns the ownership check, the live-work check,
// and the atomic next position — see the mood_feed migration for why appending
// can't be done as a plain insert without two taps colliding on one number.
export async function addWorkToMood(
  moodId: string,
  workId: number,
): Promise<LibraryResult> {
  if (!Number.isInteger(workId) || workId <= 0) {
    return { ok: false, error: "That isn't a song." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to build a mood." };

  const { error } = await supabase.rpc("mood_add_work", {
    p_mood_id: moodId,
    p_work_id: workId,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/moods");
  revalidatePath(`/moods/${moodId}`);
  return { ok: true };
}

// Take a song out of a mood. Addressed by the mood_item row, not by work id, so
// removing is unambiguous. RLS's ownership join is what makes this safe.
export async function removeMoodItem(
  itemId: string,
  moodId: string,
): Promise<LibraryResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to edit your mood." };

  const { error } = await supabase.from("mood_item").delete().eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/moods");
  revalidatePath(`/moods/${moodId}`);
  return { ok: true };
}

// Move a song up or down inside its mood. The whole run is renumbered by the
// RPC in one statement, so the order can never drift into ties or gaps.
export async function moveMoodItem(
  itemId: string,
  direction: "up" | "down",
  moodId: string,
): Promise<LibraryResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to edit your mood." };

  const { error } = await supabase.rpc("mood_move_item", {
    p_item_id: itemId,
    p_direction: direction,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/moods/${moodId}`);
  return { ok: true };
}
