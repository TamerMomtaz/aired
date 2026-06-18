"use client";

import { createClient } from "@/lib/supabase/client";

// Shared browser-side artwork upload (EDIT & TIDY). One path to the PUBLIC
// `artwork` bucket, owner-folder scoped (the signed-in uid is segment 1 — the
// same shape the upload form writes), reused by:
//   • the in-place work editor — replace a work's artwork_url, and
//   • "Upload a cover" in Manage — set an album's cover_url from a device image.
// Returns both the storage path and the public URL; callers persist the URL
// through their owner-scoped server action. Large audio never routes through the
// server; small images go straight to Storage from the browser, same as upload.

function fileExt(name: string, fallback: string): string {
  const ext = name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext && ext.length <= 5 ? ext : fallback;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export type UploadedArtwork = { path: string; publicUrl: string };

export async function uploadArtworkImage(file: File): Promise<UploadedArtwork> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Your session expired — log in again.");

  const path = `${user.id}/${newId()}/cover.${fileExt(file.name, "png")}`;
  const upload = await supabase.storage.from("artwork").upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
    cacheControl: "3600",
  });
  if (upload.error) {
    throw new Error(`Artwork upload failed: ${upload.error.message}`);
  }

  const publicUrl = supabase.storage.from("artwork").getPublicUrl(path).data
    .publicUrl;
  return { path, publicUrl };
}
