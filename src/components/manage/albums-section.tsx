"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { ManageAlbum } from "@/lib/albums/queries";
import {
  createAlbum,
  deleteAlbum,
  setAlbumCover,
  updateAlbum,
} from "@/lib/albums/actions";

// The Albums half of /manage: create an album, then per-album rename, set a
// cover from a member song's artwork, or delete (its songs become singles).
// Authorization is enforced server-side (RLS + the ownership trigger); these
// islands are just the control surface. After any write we refresh the route so
// counts and covers reflect the new state. Mirrors the ReviewActions pattern.
const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted/60 focus:border-cert-red/60 focus:bg-white/[0.07] focus:ring-1 focus:ring-cert-red/40";
const btnClass =
  "rounded-lg border border-white/12 px-3.5 py-2 text-sm text-foreground transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50";
const primaryBtnClass =
  "rounded-lg bg-cert-red px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";

export function AlbumsSection({ albums }: { albums: ManageAlbum[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  function create() {
    if (!title.trim()) return;
    setError(null);
    startTransition(async () => {
      const r = await createAlbum({ title, description });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setTitle("");
      setDescription("");
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xs uppercase tracking-[0.18em] text-muted/70">
        Albums
      </h2>

      <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <span className="text-sm font-medium text-foreground">
          New album
        </span>
        <input
          className={inputClass}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Album title"
          maxLength={200}
          disabled={pending}
          aria-label="New album title"
        />
        <input
          className={inputClass}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          maxLength={2000}
          disabled={pending}
          aria-label="New album description"
        />
        {error ? (
          <p role="alert" className="text-sm text-cert-red">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          onClick={create}
          disabled={pending || !title.trim()}
          className="self-start rounded-lg bg-cert-red px-4 py-2.5 text-sm font-medium text-white shadow-[0_0_18px_-6px_var(--cert-red)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create album"}
        </button>
      </div>

      {albums.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {albums.map((album) => (
            <li key={album.id}>
              <AlbumRow album={album} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-white/12 px-5 py-8 text-center text-sm text-muted">
          No albums yet. Create one above, then file your works into it below.
        </p>
      )}
    </section>
  );
}

type Mode = "view" | "edit" | "cover" | "delete";

function AlbumRow({ album }: { album: ManageAlbum }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>("view");
  const [title, setTitle] = useState(album.title);
  const [description, setDescription] = useState(album.description ?? "");
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const r = await action();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setMode("view");
      router.refresh();
    });
  }

  function startEdit() {
    setError(null);
    setTitle(album.title);
    setDescription(album.description ?? "");
    setMode("edit");
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex gap-4">
        <AlbumCover url={album.coverUrl} title={album.title} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-base font-medium text-foreground">
            {album.title}
          </span>
          <span className="text-xs text-muted">
            {album.workCount} {album.workCount === 1 ? "song" : "songs"}
            {album.hasCustomCover ? " · custom cover" : null}
          </span>
          {album.description ? (
            <p className="mt-1 line-clamp-2 text-sm text-muted/80">
              {album.description}
            </p>
          ) : null}
        </div>
      </div>

      {mode === "view" ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={startEdit} className={btnClass}>
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setMode("cover");
            }}
            className={btnClass}
          >
            Set cover
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setMode("delete");
            }}
            className={`${btnClass} text-cert-red`}
          >
            Delete
          </button>
        </div>
      ) : null}

      {mode === "edit" ? (
        <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            disabled={pending}
            aria-label="Album title"
          />
          <textarea
            className={`${inputClass} resize-y`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={2000}
            disabled={pending}
            placeholder="Description (optional)"
            aria-label="Album description"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setMode("view")}
              disabled={pending}
              className={btnClass}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => run(() => updateAlbum(album.id, { title, description }))}
              disabled={pending || !title.trim()}
              className={primaryBtnClass}
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : null}

      {mode === "cover" ? (
        <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
          {album.coverChoices.length > 0 ? (
            <>
              <span className="text-xs text-muted">
                Pick a cover from this album&apos;s songs:
              </span>
              <div className="flex flex-wrap gap-2">
                {album.coverChoices.map((c) => (
                  <button
                    key={c.workId}
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => setAlbumCover(album.id, c.artworkUrl))}
                    title={c.title}
                    className="relative size-16 overflow-hidden rounded-lg border border-white/12 transition hover:border-cert-red/60 disabled:opacity-50"
                  >
                    <Image
                      src={c.artworkUrl}
                      alt={`Artwork for ${c.title}`}
                      fill
                      sizes="64px"
                      className="object-cover"
                      unoptimized
                    />
                  </button>
                ))}
              </div>
            </>
          ) : (
            <span className="text-xs text-muted">
              Add a song with artwork to this album to set a cover.
            </span>
          )}
          <div className="flex items-center justify-end gap-2">
            {album.hasCustomCover ? (
              <button
                type="button"
                onClick={() => run(() => setAlbumCover(album.id, null))}
                disabled={pending}
                className={btnClass}
              >
                Use newest song
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setMode("view")}
              disabled={pending}
              className={btnClass}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}

      {mode === "delete" ? (
        <div className="flex flex-col gap-2 rounded-lg border border-cert-red/30 bg-cert-red/[0.05] p-3">
          <p className="text-sm text-foreground">
            Delete <span className="font-medium">{album.title}</span>? Its{" "}
            {album.workCount} {album.workCount === 1 ? "song" : "songs"} won&apos;t
            be deleted — they become singles.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setMode("view")}
              disabled={pending}
              className={btnClass}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => run(() => deleteAlbum(album.id))}
              disabled={pending}
              className="rounded-lg bg-cert-red px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Deleting…" : "Delete album"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-cert-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function AlbumCover({ url, title }: { url: string | null; title: string }) {
  if (url) {
    return (
      <Image
        src={url}
        alt={`Cover for ${title}`}
        width={64}
        height={64}
        className="size-16 shrink-0 rounded-lg border border-white/10 object-cover"
        unoptimized
      />
    );
  }
  return (
    <div className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-white/12 text-[9px] uppercase tracking-[0.16em] text-muted/50">
      no art
    </div>
  );
}
