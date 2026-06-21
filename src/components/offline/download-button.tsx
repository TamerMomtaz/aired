"use client";

import Link from "next/link";

import { capabilityNote } from "@/lib/offline/capability";
import {
  cancelDownload,
  deleteDownload,
  startDownload,
  useCapability,
  useDownloadEntry,
  type DownloadInput,
} from "@/lib/offline/store";

// The per-song offline control: Download → Downloading… (progress + tap-to-cancel)
// → Downloaded ✓. Public HLS is cached as-is (no encryption in v1 — the segments
// are already openly fetchable; the seam to add it later lives in the cache layer).
//
// Capability is a client-only fact, so it's computed AFTER mount (server + first
// paint render the same neutral, disabled state — no hydration mismatch). On a
// device that can't reliably play cached HLS offline — notably older iPhones,
// where Safari forces native HLS the service worker can't feed — the control is
// shown disabled with an honest note (full) or hidden entirely (compact), rather
// than promising what the device can't deliver.

export function DownloadButton({
  input,
  variant = "full",
  className,
}: {
  input: DownloadInput;
  variant?: "full" | "compact";
  className?: string;
}) {
  const entry = useDownloadEntry(input.id);
  const cap = useCapability();

  if (variant === "compact") {
    // Hidden on devices that can't reliably do offline (and on the SSR snapshot).
    if (!cap.ok) return null;
    const iconBtn = `flex size-9 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cert-red/50 ${
      className ?? ""
    }`;

    if (entry.status === "downloading") {
      return (
        <button
          type="button"
          onClick={() => cancelDownload(input.id)}
          aria-label="Cancel download"
          title="Cancel download"
          className={`${iconBtn} text-cert-red hover:brightness-110`}
        >
          <Spinner />
        </button>
      );
    }
    if (entry.status === "downloaded") {
      return (
        <Link
          href="/downloads"
          aria-label="Downloaded — open Downloads"
          title="Downloaded · open Downloads"
          className={`${iconBtn} text-emerald-300 hover:text-emerald-200`}
        >
          <CheckIcon />
        </Link>
      );
    }
    if (entry.status === "error") {
      return (
        <button
          type="button"
          onClick={() => void startDownload(input)}
          aria-label="Retry download"
          title={entry.error ?? "Retry download"}
          className={`${iconBtn} text-cert-red hover:brightness-110`}
        >
          <AlertIcon />
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => void startDownload(input)}
        aria-label="Download for offline"
        title="Download for offline"
        className={`${iconBtn} text-muted hover:text-foreground`}
      >
        <DownloadIcon />
      </button>
    );
  }

  // ---- full variant (matches the Share / QR action buttons) ---------------
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition active:scale-[0.98] disabled:active:scale-100";

  if (!cap.ok) {
    return (
      <button
        type="button"
        disabled
        aria-label="Download for offline"
        title={capabilityNote(cap)}
        className={`${base} cursor-not-allowed border-white/10 text-muted/50 ${
          className ?? ""
        }`}
      >
        <DownloadIcon />
        <span>Download</span>
      </button>
    );
  }

  if (entry.status === "downloading") {
    const pct =
      entry.total > 0 ? Math.round((entry.received / entry.total) * 100) : 0;
    return (
      <button
        type="button"
        onClick={() => cancelDownload(input.id)}
        title="Cancel download"
        className={`${base} border-cert-red/40 text-cert-red hover:bg-cert-red/10 ${
          className ?? ""
        }`}
      >
        <Spinner />
        <span>Downloading… {pct}%</span>
      </button>
    );
  }

  if (entry.status === "downloaded") {
    return (
      <span className={`inline-flex items-center gap-1 ${className ?? ""}`}>
        <span
          className={`${base} border-emerald-400/40 text-emerald-300`}
          aria-label="Downloaded for offline"
        >
          <CheckIcon />
          <span>Downloaded</span>
        </span>
        <button
          type="button"
          onClick={() => void deleteDownload(input.id)}
          className="rounded-lg px-2.5 py-2 text-xs text-muted transition hover:text-foreground"
          title="Remove this download"
        >
          Remove
        </button>
      </span>
    );
  }

  if (entry.status === "error") {
    return (
      <button
        type="button"
        onClick={() => void startDownload(input)}
        title={entry.error}
        className={`${base} border-cert-red/40 text-cert-red hover:bg-cert-red/10 ${
          className ?? ""
        }`}
      >
        <AlertIcon />
        <span>Retry download</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void startDownload(input)}
      className={`${base} border-white/12 text-foreground hover:border-white/25 hover:bg-white/[0.04] ${
        className ?? ""
      }`}
    >
      <DownloadIcon />
      <span>Download</span>
    </button>
  );
}

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 motion-safe:animate-spin"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    >
      <path d="M21 12a9 9 0 1 1-6.2-8.6" opacity="0.9" />
    </svg>
  );
}
