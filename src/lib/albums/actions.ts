"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

// Write side of ORGANIZE — a creator filing and shaping their OWN albums. Every
// action runs on the session-bound anon client (NEVER the service role), so RLS
// is the real authorization: album_owner_{ins,upd,del} pin writes to
// profile_id = auth.uid(), and work_owner_upd pins work edits to the creator.
// The enforce_album_ownership trigger is the integrity backstop — a work may be
// filed only into an album its own creator owns — so cross-owner filing is
// impossible even by direct POST (Server Actions are reachable that way). We
// still bail early for a signed-out caller to return a clean message rather than
// a raw RLS/trigger error.

export type AlbumActionResult = { ok: true } | { ok: false; error: string };
export type CreateAlbumResult =
  | { ok: true; albumId: string }
  | { ok: false; error: string };

const TITLE_MAX = 200;
const DESC_MAX = 2000;

function cleanTitle(raw: string | null | undefined): string {
  return (raw ?? "").trim().slice(0, TITLE_MAX);
}
function cleanDescription(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().slice(0, DESC_MAX);
  return v.length > 0 ? v : null;
}

// Create an album owned by the caller. Used by /manage and (inline) by upload.
export async function createAlbum(input: {
  title: string;
  description?: string | null;
}): Promise<CreateAlbumResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to create an album." };

  const title = cleanTitle(input.title);
  if (!title) return { ok: false, error: "Give the album a title." };

  // album_owner_ins requires profile_id = auth.uid(); we set it from the verified
  // session so ownership can't be forged.
  const { data, error } = await supabase
    .from("album")
    .insert({
      title,
      description: cleanDescription(input.description),
      profile_id: user.id,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Couldn't create the album." };
  }

  revalidatePath("/manage");
  revalidatePath("/upload");
  return { ok: true, albumId: data.id as string };
}

// Rename / re-describe an album. Owner-only by RLS (a non-owner update matches no
// rows); the /manage UI only ever offers the caller's own albums.
export async function updateAlbum(
  albumId: string,
  input: { title: string; description?: string | null },
): Promise<AlbumActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to edit your album." };

  const title = cleanTitle(input.title);
  if (!title) return { ok: false, error: "Give the album a title." };

  const { error } = await supabase
    .from("album")
    .update({ title, description: cleanDescription(input.description) })
    .eq("id", albumId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/manage");
  return { ok: true };
}

// Set (or clear) an album's cover. A non-null artworkUrl must belong to a work
// already filed in THIS album — so a cover can only ever be one of the album's
// own songs' artwork, never an arbitrary URL. Passing null reverts to the derived
// cover (newest member's artwork). Album ownership is enforced by RLS; the
// membership check both validates the choice and keeps the cover honest.
export async function setAlbumCover(
  albumId: string,
  artworkUrl: string | null,
): Promise<AlbumActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to edit your album." };

  if (artworkUrl) {
    const { data: member } = await supabase
      .from("work")
      .select("id")
      .eq("album_id", albumId)
      .eq("artwork_url", artworkUrl)
      .limit(1)
      .maybeSingle();
    if (!member) {
      return { ok: false, error: "Pick the cover from a song in this album." };
    }
  }

  const { error } = await supabase
    .from("album")
    .update({ cover_url: artworkUrl })
    .eq("id", albumId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/manage");
  return { ok: true };
}

// Delete an album. Owner-only by RLS. Its works are NOT deleted — work.album_id
// is ON DELETE SET NULL, so each member quietly becomes a single.
export async function deleteAlbum(albumId: string): Promise<AlbumActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to delete your album." };

  const { error } = await supabase.from("album").delete().eq("id", albumId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/manage");
  revalidatePath("/upload");
  return { ok: true };
}

// Assign / move a work between albums, or set it to a single (albumId = null).
// work_owner_upd ensures the work is the caller's; enforce_album_ownership
// ensures the target album is the caller's too — so a tampered cross-owner POST
// is rejected by the trigger with a clean message.
export async function setWorkAlbum(
  workId: number,
  albumId: string | null,
): Promise<AlbumActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to organize your works." };

  const { error } = await supabase
    .from("work")
    .update({ album_id: albumId })
    .eq("id", workId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/manage");
  revalidatePath(`/registry/${workId}`);
  return { ok: true };
}
