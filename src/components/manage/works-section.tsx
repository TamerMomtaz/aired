"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { WorkTitle } from "@/components/work-title";
import { DiscardButton } from "@/components/works/discard-button";
import { TeaserClipEditor } from "@/components/works/teaser-clip-editor";
import { WorkEditor } from "@/components/works/work-editor";
import { setWorkAlbum } from "@/lib/albums/actions";
import type { ManageWork, WorkStatus } from "@/lib/albums/queries";

// The Works half of /manage: every one of the creator's works (all statuses),
// each with a select to file it into one of their albums or set it loose as a
// single. The change runs through work_owner_upd (it's mine) + the
// enforce_album_ownership trigger (the target album is mine too), then refreshes
// so the album counts above update. The "Single" option writes album_id = NULL.
type AlbumOption = { id: string; title: string };
const SINGLE = "__single__";

export function WorksSection({
  works,
  albums,
}: {
  works: ManageWork[];
  albums: AlbumOption[];
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xs uppercase tracking-[0.18em] text-muted/70">Works</h2>

      {works.length > 0 ? (
        <ul className="flex flex-col divide-y divide-white/8 overflow-hidden rounded-xl border border-white/8">
          {works.map((work) => (
            <li key={work.id} className="flex flex-col gap-3 px-4 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <WorkTitle id={work.id} title={work.title} size="sm" />
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={work.status} />
                    {work.takenDown ? (
                      <span className="w-fit rounded-full border border-cert-red/40 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-cert-red">
                        Taken down
                      </span>
                    ) : null}
                  </div>
                </div>
                <WorkAlbumSelect work={work} albums={albums} />
              </div>
              {work.takenDown ? (
                <p className="rounded-lg border border-cert-red/30 bg-cert-red/[0.06] px-3 py-2 text-xs leading-relaxed text-foreground">
                  <span className="font-medium">
                    Taken down by AIRED
                    {work.takedownReason ? ` — ${work.takedownReason}` : ""}.
                  </span>{" "}
                  You can edit or appeal (contact@ai-red.io), but only AIRED can
                  put it back.
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <WorkEditor
                  workId={work.id}
                  initialTitle={work.title}
                  initialDescriptors={work.descriptors}
                  initialLyrics={work.lyrics}
                  initialArtworkUrl={work.artworkUrl}
                  initialAlbumId={work.albumId}
                  albums={albums}
                />
                <DiscardButton
                  workId={work.id}
                  status={work.status}
                  playCount={work.playCount}
                  certified={work.certified}
                />
              </div>
              {/* Per-song teaser window for the share video — shown once the work
                  has a known duration (i.e. transcoded), so we can display the
                  ceiling and keep the slice inside the song. */}
              {work.durationSeconds && work.durationSeconds > 0 ? (
                <TeaserClipEditor
                  workId={work.id}
                  durationSeconds={work.durationSeconds}
                  initialStartSeconds={work.clipStartSeconds}
                  initialLengthSeconds={work.clipLengthSeconds}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-white/12 px-5 py-8 text-center text-sm text-muted">
          No works yet. Upload one and it appears here, ready to file.
        </p>
      )}
    </section>
  );
}

function WorkAlbumSelect({
  work,
  albums,
}: {
  work: ManageWork;
  albums: AlbumOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onChange(value: string) {
    const albumId = value === SINGLE ? null : value;
    if (albumId === work.albumId) return;
    setError(null);
    startTransition(async () => {
      const r = await setWorkAlbum(work.id, albumId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
      <div className="flex items-center gap-2">
        <label
          htmlFor={`album-${work.id}`}
          className="text-[11px] uppercase tracking-[0.14em] text-muted/60"
        >
          Album
        </label>
        <select
          id={`album-${work.id}`}
          value={work.albumId ?? SINGLE}
          onChange={(e) => onChange(e.target.value)}
          disabled={pending}
          className="max-w-[12rem] rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground outline-none transition focus:border-cert-red/60 focus:ring-1 focus:ring-cert-red/40 disabled:opacity-50"
        >
          <option value={SINGLE}>Single (no album)</option>
          {albums.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-cert-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: WorkStatus }) {
  if (status === "live") {
    return (
      <span className="w-fit rounded-full border border-emerald-400/40 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-emerald-300">
        Live
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="w-fit rounded-full border border-amber-400/40 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-amber-300">
        In review
      </span>
    );
  }
  return (
    <span className="w-fit rounded-full border border-white/15 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-muted">
      Draft
    </span>
  );
}
