"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { AlbumOption } from "@/lib/albums/queries";
import { uploadArtworkImage } from "@/lib/artwork/upload-client";
import { sanitizeDescriptorList } from "@/lib/ledger/sanitizeReference";
import { parseLrc, toLrc } from "@/lib/lyrics/lrc";
import { formatCatalogId } from "@/lib/catalog";
import { updateWork } from "@/lib/works/actions";

// Edit a work IN PLACE (EDIT & TIDY — the orphan-killer). One modal for title,
// artwork, descriptors, album, and lyrics, reused on Manage → Works and on the
// owner's work page (the upload wizard's "Back to fix a field"). Saves through
// updateWork → work_owner_upd: NO new row, the AIRED number is unchanged.
//
// Two careful bits:
//  • Descriptors run the SAME reference-sanitizer as the upload path, previewed
//    live, so a typed name is shown as dropped before it's ever saved (Rule 2).
//  • Lyrics edit the WORDS without clobbering an existing sync: existing per-line
//    LRC timings are preserved by position and only re-sent when the text
//    actually changes — fix a typo and the beat survives. New lines come back
//    un-timed; re-open the tap-sync editor on the work page to time them.

const SINGLE = "__single__";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-base text-foreground outline-none transition placeholder:text-muted/60 focus:border-cert-red/60 focus:bg-white/[0.07] focus:ring-1 focus:ring-cert-red/40";
const fileClass =
  "w-full rounded-lg border border-dashed border-white/15 bg-white/[0.03] px-3.5 py-3 text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-white/15";
const labelText = "text-xs font-medium text-muted";
const ghostBtn =
  "rounded-lg border border-white/12 px-4 py-2.5 text-sm text-muted transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60";
const primaryBtn =
  "rounded-lg bg-cert-red px-4 py-2.5 text-sm font-medium text-white shadow-[0_0_18px_-6px_var(--cert-red)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";

type Phase = "idle" | "uploading" | "saving";

export function WorkEditor({
  workId,
  initialTitle,
  initialDescriptors,
  initialLyrics,
  initialArtworkUrl,
  initialAlbumId,
  albums,
  triggerLabel = "Edit",
  triggerClassName,
}: {
  workId: number;
  initialTitle: string;
  initialDescriptors: string[];
  initialLyrics: string | null;
  initialArtworkUrl: string | null;
  initialAlbumId: string | null;
  albums: AlbumOption[];
  triggerLabel?: string;
  triggerClassName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          triggerClassName ??
          "rounded-lg border border-white/12 px-3.5 py-2 text-sm text-foreground transition hover:bg-white/[0.06]"
        }
      >
        {triggerLabel}
      </button>
      {open ? (
        <EditorModal
          workId={workId}
          initialTitle={initialTitle}
          initialDescriptors={initialDescriptors}
          initialLyrics={initialLyrics}
          initialArtworkUrl={initialArtworkUrl}
          initialAlbumId={initialAlbumId}
          albums={albums}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function EditorModal({
  workId,
  initialTitle,
  initialDescriptors,
  initialLyrics,
  initialArtworkUrl,
  initialAlbumId,
  albums,
  onClose,
  onSaved,
}: {
  workId: number;
  initialTitle: string;
  initialDescriptors: string[];
  initialLyrics: string | null;
  initialArtworkUrl: string | null;
  initialAlbumId: string | null;
  albums: AlbumOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Lyrics: load the plain words for editing, hold the original LRC timings so an
  // unchanged-text save preserves the sync exactly.
  const parsed = useMemo(() => parseLrc(initialLyrics), [initialLyrics]);
  const originalLyricsText = useMemo(
    () => parsed.map((l) => l.text).join("\n"),
    [parsed],
  );
  const originalTimes = useMemo(() => parsed.map((l) => l.t), [parsed]);
  const hadSync = useMemo(() => parsed.some((l) => l.t !== null), [parsed]);

  const [title, setTitle] = useState(initialTitle);
  const [descriptorsText, setDescriptorsText] = useState(
    initialDescriptors.join(", "),
  );
  const [albumId, setAlbumId] = useState(initialAlbumId ?? SINGLE);
  const [lyricsText, setLyricsText] = useState(originalLyricsText);

  const [artworkFile, setArtworkFile] = useState<File | null>(null);
  const [clearArtwork, setClearArtwork] = useState(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const busy = phase !== "idle";

  // Live preview of the public descriptor set — the same sanitizer the save runs.
  const descriptorPreview = useMemo(
    () => sanitizeDescriptorList(descriptorsText),
    [descriptorsText],
  );

  // Object URL for a freshly chosen artwork file, derived in render and revoked
  // on change/unmount (the effect only cleans up — no setState in an effect).
  const filePreviewUrl = useMemo(
    () => (artworkFile ? URL.createObjectURL(artworkFile) : null),
    [artworkFile],
  );
  useEffect(() => {
    return () => {
      if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    };
  }, [filePreviewUrl]);

  const shownArtwork = artworkFile
    ? filePreviewUrl
    : clearArtwork
      ? null
      : initialArtworkUrl;

  async function save() {
    setError(null);
    if (!title.trim()) {
      setError("Give the work a title.");
      return;
    }

    try {
      // Artwork: undefined leaves it; a new file is uploaded; a clear sends null.
      let artworkUrl: string | null | undefined;
      if (artworkFile) {
        setPhase("uploading");
        const { publicUrl } = await uploadArtworkImage(artworkFile);
        artworkUrl = publicUrl;
      } else if (clearArtwork) {
        artworkUrl = null;
      } else {
        artworkUrl = undefined;
      }

      // Lyrics: only re-send if the words changed, re-attaching the original
      // per-line timings by position so an existing sync survives a text edit.
      let lyrics: string | null | undefined;
      if (lyricsText === originalLyricsText) {
        lyrics = undefined;
      } else {
        const lines = lyricsText.split(/\r?\n/);
        const composed = toLrc(
          lines.map((text, i) => ({ text, t: originalTimes[i] ?? null })),
        );
        lyrics = composed.trim().length > 0 ? composed : null;
      }

      setPhase("saving");
      const result = await updateWork({
        workId,
        title: title.trim(),
        descriptors: descriptorsText,
        albumId: albumId === SINGLE ? null : albumId,
        artworkUrl,
        lyrics,
      });
      if (!result.ok) {
        setPhase("idle");
        setError(result.error);
        return;
      }
      onSaved();
    } catch (err) {
      setPhase("idle");
      setError(err instanceof Error ? err.message : "Couldn't save — try again.");
    }
  }

  const cta =
    phase === "uploading"
      ? "Uploading artwork…"
      : phase === "saving"
        ? "Saving…"
        : "Save changes";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`edit-${workId}-heading`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
      onClick={() => !busy && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-2xl border border-white/10 bg-background p-5 shadow-2xl sm:p-6"
      >
        <div className="flex items-center justify-between">
          <h2
            id={`edit-${workId}-heading`}
            className="text-base font-semibold text-foreground"
          >
            Edit {formatCatalogId(workId)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-xs text-muted transition hover:text-foreground disabled:opacity-60"
          >
            Close
          </button>
        </div>
        <p className="-mt-1 text-xs text-muted/70">
          Edits save to this same work — the AIRED number never changes.
        </p>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Title</span>
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            disabled={busy}
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className={labelText}>Artwork</span>
          <div className="flex items-center gap-3">
            {shownArtwork ? (
              // A freshly-chosen file previews as a blob: URL, which next/image
              // rejects — a plain <img> renders both that and the stored https URL.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={shownArtwork}
                alt="Artwork preview"
                width={64}
                height={64}
                className="size-16 shrink-0 rounded-lg border border-white/10 object-cover"
              />
            ) : (
              <div className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-white/12 text-[9px] uppercase tracking-[0.16em] text-muted/50">
                no art
              </div>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <input
                className={fileClass}
                type="file"
                accept="image/*"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setArtworkFile(f);
                  if (f) setClearArtwork(false);
                }}
              />
              {initialArtworkUrl && !artworkFile ? (
                <button
                  type="button"
                  onClick={() => setClearArtwork((v) => !v)}
                  disabled={busy}
                  className="self-start text-[11px] text-muted underline-offset-4 hover:text-foreground hover:underline"
                >
                  {clearArtwork ? "Keep current artwork" : "Remove artwork"}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Descriptors</span>
          <textarea
            className={`${inputClass} min-h-16 resize-y`}
            value={descriptorsText}
            onChange={(e) => setDescriptorsText(e.target.value)}
            placeholder="e.g. 80s new wave, gated drums, brass stabs"
            disabled={busy}
          />
          <DescriptorPreview preview={descriptorPreview} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Album</span>
          <select
            className={`${inputClass} appearance-none`}
            value={albumId}
            onChange={(e) => setAlbumId(e.target.value)}
            disabled={busy}
          >
            <option value={SINGLE}>Single (no album)</option>
            {albums.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Lyrics</span>
          <textarea
            className={`${inputClass} min-h-32 resize-y font-mono`}
            value={lyricsText}
            onChange={(e) => setLyricsText(e.target.value)}
            placeholder={"One lyric line per line.\nLeave empty for no lyrics."}
            disabled={busy}
          />
          <span className="text-[11px] text-muted/70">
            {hadSync
              ? "This work has synced lyrics. Editing the words keeps each unchanged line's timing — re-sync new lines from the work page."
              : "Save plain words now; sync them to the Red Line later from the work page."}
          </span>
        </label>

        {error ? (
          <p role="alert" className="text-sm text-cert-red">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={ghostBtn}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || !title.trim()}
            className={primaryBtn}
          >
            {cta}
          </button>
        </div>
      </div>
    </div>
  );
}

function DescriptorPreview({
  preview,
}: {
  preview: ReturnType<typeof sanitizeDescriptorList>;
}) {
  const { descriptors, dropped } = preview;
  return (
    <span className="flex flex-col gap-1">
      {descriptors.length > 0 ? (
        <span className="flex flex-wrap gap-1.5">
          {descriptors.map((d) => (
            <span
              key={d}
              className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 text-[11px] text-muted"
            >
              {d}
            </span>
          ))}
        </span>
      ) : (
        <span className="text-[11px] text-muted/60">
          Comma-separated. Genres and sonic descriptors only — artist names never
          go public.
        </span>
      )}
      {dropped.length > 0 ? (
        <span className="text-[11px] text-cert-red">
          These read like names and won&apos;t be saved: {dropped.join(", ")}.
          Describe the sound instead.
        </span>
      ) : null}
    </span>
  );
}
