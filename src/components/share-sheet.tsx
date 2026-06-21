"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// The share sheet — AIRED's viral lever (CLAUDE.md §3a: the growth mechanic is
// people searching and following NAMES, so every share carries the makers).
// Two paths in one modal, because the platforms split two ways:
//   • Link-preview platforms (FB / X / WhatsApp / LinkedIn / Reddit / Telegram)
//     read the OG card off the URL — so these are one-tap web-intent buttons,
//     plus Copy link, plus the native share sheet as a "More…" fallback.
//   • Image platforms (Instagram / TikTok) take no links — so we offer the
//     downloadable square (IG feed) and story (IG/Reels/TikTok) PNGs, which the
//     creator posts with the link in bio.
//
// All copy is built on the server and passed in, so this stays a pure UI shell.

type ShareKind = "song" | "album" | "artist";

type Props = {
  // Canonical https URL — what gets copied / shared / unfurled (always prod).
  url: string;
  // The fully-built share text (names the makers). Used by X / WhatsApp /
  // Telegram and the native share sheet.
  shareText: string;
  // A short title for Reddit's title field and the native share sheet.
  shareTitle: string;
  // Identify the subject for the downloadable-card route (/share/<kind>/<id>/…).
  downloadKind: ShareKind;
  downloadId: string;
  // Base name for a saved PNG, e.g. "AIRED-0001" → "AIRED-0001-story.png".
  filenameBase: string;
  // Trigger styling: compact is the round icon that overlays a card; otherwise a
  // labelled button for a page header.
  compact?: boolean;
  triggerClassName?: string;
  triggerLabel?: string;
};

const enc = encodeURIComponent;

export function ShareSheet({
  url,
  shareText,
  shareTitle,
  downloadKind,
  downloadId,
  filenameBase,
  compact = false,
  triggerClassName,
  triggerLabel = "Share",
}: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [busy, setBusy] = useState<null | "square" | "story">(null);
  const [downloadError, setDownloadError] = useState(false);
  const [videoBusy, setVideoBusy] = useState<null | "vertical" | "square">(null);
  const [videoError, setVideoError] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // While the sheet is open: lock body scroll, close on Escape, focus the close
  // button so a keyboard user lands inside the dialog.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function openSheet(e: React.MouseEvent) {
    // The trigger can sit over a card-level link; never let it navigate too.
    e.preventDefault();
    e.stopPropagation();
    // Detect the native share sheet at click time (client only) — drives the
    // "More…" fallback without a setState-in-effect on every mount.
    setCanNativeShare(
      typeof navigator !== "undefined" && typeof navigator.share === "function",
    );
    setOpen(true);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context / permissions) — fall back to the
      // native sheet if we can, else leave the buttons as the way to share.
      if (canNativeShare) void nativeShare();
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title: shareTitle, text: shareText, url });
    } catch {
      // User dismissed the share sheet — nothing to do.
    }
  }

  async function download(size: "square" | "story") {
    setBusy(size);
    setDownloadError(false);
    try {
      const res = await fetch(
        `/share/${downloadKind}/${enc(downloadId)}/${size}`,
      );
      if (!res.ok) throw new Error("render failed");
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${filenameBase}-${size}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch {
      setDownloadError(true);
    } finally {
      setBusy(null);
    }
  }

  // SHARE VIDEO — the only thing that makes a song PLAY in-feed on Reels / TikTok
  // / IG (links and images can't). The MP4 is rendered + cached on the worker, so
  // the first save shows "preparing…" while we poll, then it's instant. We prefer
  // the native share sheet WITH the file (hands it straight to TikTok / saves to
  // the gallery); otherwise we fall back to a plain download.
  async function fetchClip(orientation: "vertical" | "square"): Promise<File> {
    const endpoint = `/share/song/${enc(downloadId)}/video/${orientation}`;
    const filename = `${filenameBase}-${orientation}.mp4`;
    const deadline = Date.now() + 100_000; // generous budget for a first render
    while (Date.now() < deadline) {
      // The first request kicks the render; while "preparing" we poll.
      const res = await fetch(endpoint, { cache: "no-store" });
      if (res.status === 202) {
        await new Promise((r) => setTimeout(r, 2500));
        continue;
      }
      if (!res.ok) throw new Error("render failed");
      const blob = await res.blob();
      return new File([blob], filename, { type: "video/mp4" });
    }
    throw new Error("timed out");
  }

  async function saveVideo(orientation: "vertical" | "square") {
    if (videoBusy) return;
    setVideoBusy(orientation);
    setVideoError(false);
    try {
      const file = await fetchClip(orientation);
      const canShareFiles =
        typeof navigator !== "undefined" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] });
      if (canShareFiles) {
        try {
          await navigator.share({ files: [file], title: shareTitle, text: shareText });
        } catch {
          // User dismissed the share sheet — nothing to do.
        }
      } else {
        const href = URL.createObjectURL(file);
        const a = document.createElement("a");
        a.href = href;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(href);
      }
    } catch {
      setVideoError(true);
    } finally {
      setVideoBusy(null);
    }
  }

  const platforms: { name: string; href: string; color: string; icon: React.ReactNode }[] =
    [
      {
        name: "Facebook",
        href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`,
        color: "#1877F2",
        icon: <FacebookIcon />,
      },
      {
        name: "X",
        href: `https://twitter.com/intent/tweet?url=${enc(url)}&text=${enc(shareText)}`,
        color: "#ededed",
        icon: <XIcon />,
      },
      {
        name: "WhatsApp",
        href: `https://wa.me/?text=${enc(`${shareText} ${url}`)}`,
        color: "#25D366",
        icon: <WhatsAppIcon />,
      },
      {
        name: "LinkedIn",
        href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`,
        color: "#0A66C2",
        icon: <LinkedInIcon />,
      },
      {
        name: "Reddit",
        href: `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(shareTitle)}`,
        color: "#FF4500",
        icon: <RedditIcon />,
      },
      {
        name: "Telegram",
        href: `https://t.me/share/url?url=${enc(url)}&text=${enc(shareText)}`,
        color: "#229ED9",
        icon: <TelegramIcon />,
      },
    ];

  const trigger = compact ? (
    <button
      type="button"
      onClick={openSheet}
      aria-label={triggerLabel}
      title={triggerLabel}
      className={
        triggerClassName ??
        "inline-flex size-9 items-center justify-center rounded-full border border-white/15 bg-background/70 text-foreground backdrop-blur transition hover:border-white/30 hover:bg-background/85 active:scale-95"
      }
    >
      <ShareIcon />
    </button>
  ) : (
    <button
      type="button"
      onClick={openSheet}
      className={
        triggerClassName ??
        "inline-flex items-center gap-2 self-start rounded-lg border border-white/12 px-4 py-2.5 text-sm font-medium text-foreground transition hover:border-white/25 hover:bg-white/[0.04] active:scale-[0.98]"
      }
    >
      <ShareIcon />
      <span>{triggerLabel}</span>
    </button>
  );

  return (
    <>
      {trigger}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Share ${shareTitle}`}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="flex w-full max-w-md flex-col gap-5 rounded-t-2xl border border-white/10 bg-[#0d0d0d] p-5 shadow-2xl sm:rounded-2xl"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <h2 className="text-base font-semibold text-foreground">
                      Share
                    </h2>
                    <p className="max-w-[16rem] truncate text-xs text-muted">
                      {shareTitle}
                    </p>
                  </div>
                  <button
                    ref={closeRef}
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                    className="inline-flex size-8 items-center justify-center rounded-full border border-white/10 text-muted transition hover:border-white/25 hover:text-foreground"
                  >
                    <CloseIcon />
                  </button>
                </div>

                {/* Copy link */}
                <button
                  type="button"
                  onClick={copyLink}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-left transition hover:border-white/25 hover:bg-white/[0.04]"
                >
                  <span className="min-w-0 truncate font-mono text-xs text-muted">
                    {url.replace(/^https?:\/\//, "")}
                  </span>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-medium ${copied ? "text-emerald-300" : "text-cert-red"}`}
                  >
                    {copied ? <CheckIcon /> : <CopyIcon />}
                    {copied ? "Copied" : "Copy"}
                  </span>
                </button>

                {/* One-tap platform buttons */}
                <div className="grid grid-cols-3 gap-2">
                  {platforms.map((p) => (
                    <a
                      key={p.name}
                      href={p.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-col items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.02] px-2 py-3 text-[11px] text-muted transition hover:border-white/25 hover:bg-white/[0.05] hover:text-foreground"
                    >
                      <span style={{ color: p.color }} className="flex">
                        {p.icon}
                      </span>
                      {p.name}
                    </a>
                  ))}
                </div>

                {/* Native share — the "More…" fallback, mobile only. */}
                {canNativeShare ? (
                  <button
                    type="button"
                    onClick={nativeShare}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm text-muted transition hover:border-white/25 hover:text-foreground"
                  >
                    <ShareIcon />
                    More…
                  </button>
                ) : null}

                {/* Downloadable images — the Instagram / TikTok path. */}
                <div className="flex flex-col gap-2 border-t border-white/8 pt-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted/70">
                    Download image
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => download("square")}
                      disabled={busy !== null}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3 text-sm text-foreground transition hover:border-white/25 hover:bg-white/[0.05] disabled:opacity-50"
                    >
                      {busy === "square" ? <Spinner /> : <DownloadIcon />}
                      Save square
                    </button>
                    <button
                      type="button"
                      onClick={() => download("story")}
                      disabled={busy !== null}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3 text-sm text-foreground transition hover:border-white/25 hover:bg-white/[0.05] disabled:opacity-50"
                    >
                      {busy === "story" ? <Spinner /> : <DownloadIcon />}
                      Save story
                    </button>
                  </div>
                  {downloadError ? (
                    <p className="text-xs text-cert-red">
                      Couldn&apos;t make the image. Try again.
                    </p>
                  ) : (
                    <p className="text-xs text-muted/70">
                      Square (1080) for the IG feed · Story (1080×1920) for
                      Reels &amp; TikTok. Post it with the link in bio.
                    </p>
                  )}
                </div>

                {/* Save video — the only way a song PLAYS in-feed on Reels /
                    TikTok / IG (links + images can't carry sound). Songs only. */}
                {downloadKind === "song" ? (
                  <div className="flex flex-col gap-2 border-t border-white/8 pt-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-muted/70">
                      Save video — plays with sound
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => saveVideo("vertical")}
                        disabled={videoBusy !== null}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-cert-red/30 bg-cert-red/[0.06] px-3 py-3 text-sm text-foreground transition hover:border-cert-red/50 hover:bg-cert-red/10 disabled:opacity-50"
                      >
                        {videoBusy === "vertical" ? <Spinner /> : <VideoIcon />}
                        {videoBusy === "vertical" ? "Preparing…" : "Reels / TikTok"}
                      </button>
                      <button
                        type="button"
                        onClick={() => saveVideo("square")}
                        disabled={videoBusy !== null}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3 text-sm text-foreground transition hover:border-white/25 hover:bg-white/[0.05] disabled:opacity-50"
                      >
                        {videoBusy === "square" ? <Spinner /> : <VideoIcon />}
                        {videoBusy === "square" ? "Preparing…" : "Square (feed)"}
                      </button>
                    </div>
                    {videoError ? (
                      <p className="text-xs text-cert-red">
                        Couldn&apos;t make the video. Try again.
                      </p>
                    ) : videoBusy ? (
                      <p className="text-xs text-muted/70">
                        Preparing your video… the first one takes a few seconds.
                      </p>
                    ) : (
                      <p className="text-xs text-muted/70">
                        Save the video, then post to Reels / TikTok — it plays
                        in‑feed with sound. Link in bio.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────
// Action glyphs are stroked (currentColor); the platform marks are filled
// single-path brand logos so each button is recognizable at a glance.

function ShareIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="5" width="14" height="14" rx="3" />
      <path d="m16 9 6-3.5v13L16 15" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.247-.694.247-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function RedditIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.061 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.241-1.865-.44-.752-.244-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}
