"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { createWork } from "@/lib/works/actions";
import { createClient } from "@/lib/supabase/client";
import { formatDuration } from "@/lib/format";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-base text-foreground outline-none transition placeholder:text-muted/60 focus:border-cert-red/60 focus:bg-white/[0.07] focus:ring-1 focus:ring-cert-red/40";

const fileClass =
  "w-full rounded-lg border border-dashed border-white/15 bg-white/[0.03] px-3.5 py-3 text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-white/15";

function fileExt(name: string, fallback: string): string {
  const ext = name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext && ext.length <= 5 ? ext : fallback;
}

// Read duration client-side from the audio file's metadata (brief part 1 — no
// cap). Resolves null if the browser can't read it; the work still uploads.
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    audio.onloadedmetadata = () =>
      done(Number.isFinite(audio.duration) ? audio.duration : null);
    audio.onerror = () => done(null);
    audio.src = url;
  });
}

type Phase = "idle" | "reading" | "uploading" | "saving";

export function UploadForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [audio, setAudio] = useState<File | null>(null);
  const [artwork, setArtwork] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const busy = phase !== "idle";

  async function onAudioChange(file: File | null) {
    setAudio(file);
    setDuration(null);
    if (!file) return;
    setPhase("reading");
    setDuration(await readDuration(file));
    setPhase("idle");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) return setError("Give the work a title.");
    if (!audio) return setError("Choose an audio master to upload.");

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return setError("Your session expired — log in again.");

    const uploadId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      setPhase("uploading");

      // Audio master → PRIVATE bucket, owner-folder scoped (uid is segment 1).
      const masterPath = `${user.id}/${uploadId}/master.${fileExt(audio.name, "bin")}`;
      const masterUpload = await supabase.storage
        .from("masters")
        .upload(masterPath, audio, {
          upsert: false,
          contentType: audio.type || undefined,
          cacheControl: "3600",
        });
      if (masterUpload.error) {
        throw new Error(`Audio upload failed: ${masterUpload.error.message}`);
      }

      // Artwork → PUBLIC bucket (optional).
      let artworkUrl: string | null = null;
      if (artwork) {
        const artPath = `${user.id}/${uploadId}/cover.${fileExt(artwork.name, "png")}`;
        const artUpload = await supabase.storage
          .from("artwork")
          .upload(artPath, artwork, {
            upsert: false,
            contentType: artwork.type || undefined,
            cacheControl: "3600",
          });
        if (artUpload.error) {
          throw new Error(`Artwork upload failed: ${artUpload.error.message}`);
        }
        artworkUrl = supabase.storage.from("artwork").getPublicUrl(artPath)
          .data.publicUrl;
      }

      setPhase("saving");
      const result = await createWork({
        title: title.trim(),
        durationSeconds: duration,
        masterPath,
        artworkUrl,
      });
      if (!result.ok) throw new Error(result.error);

      // Land on the draft work page to declare the Volley Ledger.
      router.push(`/registry/${result.workId}`);
    } catch (err) {
      setPhase("idle");
      setError(err instanceof Error ? err.message : "Upload failed — try again.");
    }
  }

  const cta =
    phase === "uploading"
      ? "Uploading…"
      : phase === "saving"
        ? "Creating work…"
        : "Upload & start the ledger";

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">Title</span>
        <input
          className={inputClass}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder='e.g. ALL (Σ I)'
          maxLength={200}
          disabled={busy}
          required
        />
        <span className="text-[11px] text-muted/60">
          The catalog number (AIRED-####) is assigned automatically.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">Audio master</span>
        <input
          className={fileClass}
          type="file"
          accept="audio/*"
          onChange={(e) => onAudioChange(e.target.files?.[0] ?? null)}
          disabled={busy}
          required
        />
        <span className="text-[11px] text-muted/60">
          Stored privately — never streamed from here (R2 + the player land in
          Phase 3). No length cap.
          {audio && duration != null ? (
            <> Detected length: {formatDuration(duration)}.</>
          ) : phase === "reading" ? (
            <> Reading length…</>
          ) : null}
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">Artwork (optional)</span>
        <input
          className={fileClass}
          type="file"
          accept="image/*"
          onChange={(e) => setArtwork(e.target.files?.[0] ?? null)}
          disabled={busy}
        />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-cert-red">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-cert-red px-4 py-2.5 text-sm font-medium text-white shadow-[0_0_18px_-6px_var(--cert-red)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {cta}
      </button>
    </form>
  );
}
