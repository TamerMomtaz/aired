import { formatCatalogId } from "@/lib/catalog";

// Pure share helpers — no server imports, so both server pages and client
// components (e.g. the Browse work card) can build the share sheet's props. The
// Supabase-backed card builders live in ./data; the rendering lives in ./card.

// The canonical public origin. Shared links and QR targets always point at
// production (ai-red.io) regardless of which deployment renders them, so a card
// shared from a preview still routes a visitor to the real work.
export const SITE_ORIGIN = "https://ai-red.io";

// "Tee" · "Tee & Claude" · "Tee, Claude & Suno" — prose join for share copy and
// bylines. Soft-capped so a long lineage stays legible. Identity only, never a
// style descriptor (CLAUDE.md §2, §3a).
export function joinNamesProse(names: string[], max = 4): string {
  const visible = names.slice(0, max);
  const extra = names.length - visible.length;
  let head: string;
  if (visible.length === 0) head = "";
  else if (visible.length === 1) head = visible[0];
  else if (visible.length === 2) head = `${visible[0]} & ${visible[1]}`;
  else
    head = `${visible.slice(0, -1).join(", ")} & ${visible[visible.length - 1]}`;
  return extra > 0 ? `${head} +${extra}` : head;
}

// A filesystem-friendly slug for a downloaded PNG's name.
function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "share"
  );
}

// The base filename (no extension / size suffix) for a subject's downloads, so a
// saved card reads as "AIRED-0001-story.png" / "aired-artist-kahotia-square.png".
export function shareFilenameBase(
  kind: "song" | "album" | "artist",
  opts: { catalogId?: string; title?: string; handle?: string | null },
): string {
  if (kind === "song" && opts.catalogId) return opts.catalogId;
  if (kind === "album") return `aired-album-${slugify(opts.title ?? "")}`;
  return `aired-artist-${slugify(opts.handle || opts.title || "")}`;
}

// Everything the client <ShareSheet> needs, built once on the server.
export type ShareSheetProps = {
  url: string;
  shareText: string;
  shareTitle: string;
  downloadKind: "song" | "album" | "artist";
  downloadId: string;
  filenameBase: string;
};

// {text} = '"{title}" on AIRED — credited to {names}. AI-ed and proud.' (the
// brief's template), with a graceful clause when no makers are surfaced yet.
function creditedClause(names: string[], verb = "credited to"): string {
  return names.length
    ? `${verb} ${joinNamesProse(names)}`
    : "carbon and silicon, credited by name";
}

export function songShareProps(
  id: number,
  title: string,
  names: string[],
): ShareSheetProps {
  const catalogId = formatCatalogId(id);
  return {
    url: `${SITE_ORIGIN}/registry/${id}`,
    shareText: `"${title}" on AIRED — ${creditedClause(names)}. AI-ed and proud.`,
    shareTitle: `${catalogId} · "${title}"`,
    downloadKind: "song",
    downloadId: String(id),
    filenameBase: shareFilenameBase("song", { catalogId }),
  };
}

export function albumShareProps(
  id: string,
  title: string,
  artist: string,
  names: string[],
): ShareSheetProps {
  return {
    url: `${SITE_ORIGIN}/album/${id}`,
    shareText: `"${title}" by ${artist} on AIRED — ${creditedClause(names)}. AI-ed and proud.`,
    shareTitle: `${title} · ${artist}`,
    downloadKind: "album",
    downloadId: id,
    filenameBase: shareFilenameBase("album", { title }),
  };
}

export function artistShareProps(
  idOrHandle: string,
  displayName: string,
  handle: string | null,
  names: string[],
): ShareSheetProps {
  return {
    url: `${SITE_ORIGIN}/artist/${idOrHandle}`,
    shareText: `${displayName} on AIRED — ${creditedClause(names, "working with")}. AI-ed and proud.`,
    shareTitle: handle ? `${displayName} (@${handle})` : displayName,
    downloadKind: "artist",
    downloadId: idOrHandle,
    filenameBase: shareFilenameBase("artist", { handle: handle ?? displayName }),
  };
}
