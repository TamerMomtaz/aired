"use client";

import { createClient } from "@/lib/supabase/client";

export type MixUpload = {
  title: string;
  seconds: number;
  bpm: number;
  energy: string;
  dj: string | null;
  story: string | null;
  plannedBy: "brain" | "rules";
  sourceWorkIds: number[];
};

// Keep a mix on the signed-in person's AIRED account: the file goes straight
// from the browser into their own folder in the private `masters` bucket, then
// /api/mixes records it and starts the stream. Returns the new mix id.
export async function uploadMixToAccount(
  audio: Blob,
  mix: MixUpload,
): Promise<{ id: string } | { error: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "signin" };

  const uploadId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const mp3 = audio.type === "audio/mpeg";
  const path = `${user.id}/mix-${uploadId}/master.${mp3 ? "mp3" : "wav"}`;
  const up = await supabase.storage
    .from("masters")
    .upload(path, audio, { upsert: false, contentType: mp3 ? "audio/mpeg" : "audio/wav", cacheControl: "3600" });
  if (up.error) return { error: `The upload didn't finish: ${up.error.message}` };

  const res = await fetch("/api/mixes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      master_path: path,
      title: mix.title,
      duration_seconds: mix.seconds,
      bpm: mix.bpm,
      energy: mix.energy,
      dj_name: mix.dj,
      story: mix.story,
      planned_by: mix.plannedBy,
      source_work_ids: mix.sourceWorkIds,
    }),
  }).catch(() => null);
  const data = res ? ((await res.json().catch(() => ({}))) as { id?: string; error?: string }) : {};
  if (!res?.ok || !data.id) {
    await supabase.storage.from("masters").remove([path]).catch(() => {});
    return { error: data.error ?? "Couldn't save the mix on AIRED." };
  }
  return { id: data.id };
}
