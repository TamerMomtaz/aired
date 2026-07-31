"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { AlbumOption } from "@/lib/albums/queries";
import { createWork, type CreateWorkAlbum } from "@/lib/works/actions";
import type { CarriedPerformer } from "@/lib/works/performers";
import { createClient } from "@/lib/supabase/client";
import { formatDuration } from "@/lib/format";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-base text-foreground outline-none transition placeholder:text-muted/60 focus:border-cert-red/60 focus:bg-white/[0.07] focus:ring-1 focus:ring-cert-red/40";

const fileClass =
  "w-full rounded-lg border border-dashed border-white/15 bg-white/[0.03] px-3.5 py-3 text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-white/15";

// One selectable album choice (radio + its inline fields), styled as a card.
const albumOptionClass =
  "flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3.5 py-3 transition has-[:checked]:border-cert-red/50 has-[:checked]:bg-cert-red/[0.04]";
const albumRadioClass = "mt-0.5 size-4 shrink-0 accent-cert-red";

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

// The album step. "existing" files into one of the creator's albums; "new"
// creates one inline; "single" leaves the work album-less on purpose.
type AlbumMode = "existing" | "new" | "single";

export function UploadForm({
  albums,
  // The artists this signed-in human is authorized to carry. Empty for almost
  // everyone, and then this form is exactly what it has always been: no selector
  // renders, nothing about the upload changes. The list only shapes the control —
  // the authority is re-checked server-side on submit and again by RLS.
  performers = [],
  // Each carriable performer's own albums, keyed by profile id. An album belongs
  // to the ARTIST, so filing under a performer offers THEIR shelf, never mine.
  performerAlbums = {},
  // How to name "me" in the selector, so the default reads as a person rather
  // than as an absence.
  selfName = "Myself",
}: {
  albums: AlbumOption[];
  performers?: CarriedPerformer[];
  performerAlbums?: Record<string, AlbumOption[]>;
  selfName?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [audio, setAudio] = useState<File | null>(null);
  const [artwork, setArtwork] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // "" = myself, the default and the unchanged path. A profile id here means the
  // work files on that artist's rail with me recorded as the authorizing hands.
  const [performerId, setPerformerId] = useState<string>("");
  const performer = performers.find((p) => p.profileId === performerId) ?? null;

  // Whose shelf the album step is offering: mine, or the selected performer's.
  const activeAlbums = performer
    ? (performerAlbums[performer.profileId] ?? [])
    : albums;

  // Default: file into your newest album if you have one, else release as a
  // single. Either way the choice is explicit and visible — no more works that
  // fall album-less by accident.
  const [albumMode, setAlbumMode] = useState<AlbumMode>(
    albums.length > 0 ? "existing" : "single",
  );
  const [albumId, setAlbumId] = useState<string>(albums[0]?.id ?? "");
  const [newAlbumTitle, setNewAlbumTitle] = useState("");
  const [newAlbumDesc, setNewAlbumDesc] = useState("");

  // Switching artist switches shelves, so the album choice cannot carry over: a
  // work may only be filed into an album owned by the same artist
  // (enforce_album_ownership), and silently keeping a stale id would be a
  // guaranteed rejection at submit.
  function onPerformerChange(next: string) {
    setPerformerId(next);
    const nextAlbums = next ? (performerAlbums[next] ?? []) : albums;
    setAlbumMode(nextAlbums.length > 0 ? "existing" : "single");
    setAlbumId(nextAlbums[0]?.id ?? "");
    setError(null);
  }

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
    if (albumMode === "existing" && !albumId)
      return setError("Pick an album, or release as a single.");
    if (albumMode === "new" && !newAlbumTitle.trim())
      return setError("Name the new album, or release as a single.");

    const album: CreateWorkAlbum =
      albumMode === "existing"
        ? { kind: "existing", albumId }
        : albumMode === "new"
          ? {
              kind: "new",
              title: newAlbumTitle.trim(),
              description: newAlbumDesc.trim() || null,
            }
          : { kind: "single" };

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
        album,
        // Null unless an authorized carrier picked an artist. The server re-asks
        // whether this human may carry them and refuses (403) if not — this
        // field is a request, never a permission.
        performerId: performerId || null,
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
        : performer
          ? `Upload for ${performer.name} & start the ledger`
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

      {/*
        PUBLISH AS PERFORMER — only for a human the platform has authorized to
        carry an artist, and absent entirely for everyone else (their upload
        experience is byte-for-byte what it was). Quiet by design: a small
        labelled select, not a mode switch. What it says under it is the whole
        honesty of the feature — the artist owns the work, and the person filing
        it is named in the ledger as the hands, never as the author.
      */}
      {performers.length > 0 ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">
            Publish as performer
          </span>
          <select
            className={inputClass}
            value={performerId}
            onChange={(e) => onPerformerChange(e.target.value)}
            disabled={busy}
          >
            <option value="">{selfName}</option>
            {performers.map((p) => (
              <option key={p.profileId} value={p.profileId}>
                {p.name}
                {p.kindLabel ? ` · ${p.kindLabel}` : ""}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-muted/60">
            {performer ? (
              <>
                Files under {performer.name}&apos;s catalog; you are recorded as
                the authorizing hands in the ledger.
              </>
            ) : (
              <>
                Files under your own catalog. Choose an artist you carry to
                release on their rail instead.
              </>
            )}
          </span>
        </label>
      ) : null}

      <fieldset className="flex flex-col gap-2" disabled={busy}>
        <legend className="mb-1 text-xs font-medium text-muted">
          Album
          {performer ? (
            <span className="ml-1.5 font-normal normal-case text-muted/60">
              · on {performer.name}&apos;s rail
            </span>
          ) : null}
        </legend>

        {activeAlbums.length > 0 ? (
          <label className={albumOptionClass}>
            <input
              type="radio"
              name="album-step"
              className={albumRadioClass}
              checked={albumMode === "existing"}
              onChange={() => setAlbumMode("existing")}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="text-sm text-foreground">
                {performer
                  ? `Add to one of ${performer.name}'s albums`
                  : "Add to one of your albums"}
              </span>
              {albumMode === "existing" ? (
                <select
                  className={inputClass}
                  value={albumId}
                  onChange={(e) => setAlbumId(e.target.value)}
                  aria-label="Choose an album"
                >
                  {activeAlbums.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title}
                    </option>
                  ))}
                </select>
              ) : null}
            </span>
          </label>
        ) : null}

        <label className={albumOptionClass}>
          <input
            type="radio"
            name="album-step"
            className={albumRadioClass}
            checked={albumMode === "new"}
            onChange={() => setAlbumMode("new")}
          />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="text-sm text-foreground">
              {performer
                ? `Start a new album on ${performer.name}'s rail`
                : "Start a new album"}
            </span>
            {albumMode === "new" ? (
              <span className="flex flex-col gap-2">
                <input
                  className={inputClass}
                  value={newAlbumTitle}
                  onChange={(e) => setNewAlbumTitle(e.target.value)}
                  placeholder="Album title"
                  maxLength={200}
                  aria-label="New album title"
                />
                <input
                  className={inputClass}
                  value={newAlbumDesc}
                  onChange={(e) => setNewAlbumDesc(e.target.value)}
                  placeholder="Description (optional)"
                  maxLength={2000}
                  aria-label="New album description"
                />
                <span className="text-[11px] text-muted/60">
                  Its cover comes from this song&apos;s artwork — set a custom one
                  later in Manage.
                </span>
              </span>
            ) : null}
          </span>
        </label>

        <label className={albumOptionClass}>
          <input
            type="radio"
            name="album-step"
            className={albumRadioClass}
            checked={albumMode === "single"}
            onChange={() => setAlbumMode("single")}
          />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm text-foreground">Release as a single</span>
            <span className="text-[11px] text-muted/60">
              No album — an intentional single, easy to file later in Manage.
            </span>
          </span>
        </label>
      </fieldset>

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
