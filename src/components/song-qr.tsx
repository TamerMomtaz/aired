"use client";

import { useState } from "react";

import { formatCatalogId } from "@/lib/catalog";

// Per-song QR — the viral lever at track level (CLAUDE.md §1.3a: the platform's
// growth mechanic is people landing on, then following, NAMES). Sits in the song
// page's Share row; a scan lands on this exact track's registry page. The
// `qrcode` lib is dynamic-imported on first open so it never ships in the song
// page's initial JS. Same near-black-on-white, high-contrast code as the /qr
// poster, so it reads reliably off a phone screen or a printout.

type Props = {
  workId: number;
  title: string;
};

export function SongQr({ workId, title }: Props) {
  const [open, setOpen] = useState(false);
  const [dataUri, setDataUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const url = `https://ai-red.io/registry/${workId}`;
  const catalogId = formatCatalogId(workId);

  async function toggle() {
    const next = !open;
    setOpen(next);
    // Build the code once, the first time it's revealed.
    if (next && !dataUri && !failed) {
      try {
        const QRCode = (await import("qrcode")).default;
        const uri = await QRCode.toDataURL(url, {
          errorCorrectionLevel: "H",
          margin: 2,
          width: 512,
          color: { dark: "#000000", light: "#ffffff" },
        });
        setDataUri(uri);
      } catch {
        setFailed(true);
      }
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-lg border border-white/12 px-4 py-2.5 text-sm font-medium text-foreground transition hover:border-white/25 hover:bg-white/[0.04] active:scale-[0.98]"
      >
        <QrIcon />
        <span>QR</span>
      </button>

      {open ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-cert-red/30 bg-white/[0.02] p-4">
          {failed ? (
            <p className="max-w-[12rem] text-center text-sm text-muted">
              Couldn&apos;t make a QR. Use the share link instead.
            </p>
          ) : dataUri ? (
            <>
              <div className="rounded-xl border-2 border-cert-red/50 bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={dataUri}
                  alt={`QR code linking to ${catalogId}`}
                  width={176}
                  height={176}
                  className="size-44"
                />
              </div>
              <p className="max-w-[12rem] text-center text-xs text-muted">
                Scan to hear {catalogId} · &ldquo;{title}&rdquo;.
              </p>
              <a
                href={dataUri}
                download={`${catalogId}-qr.png`}
                className="font-mono text-xs uppercase tracking-[0.16em] text-cert-red transition hover:brightness-110"
              >
                Download QR
              </a>
            </>
          ) : (
            <p className="text-sm text-muted">Making QR…</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function QrIcon() {
  // Stylized QR glyph — three finder squares + a few data cells.
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
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <line x1="14" y1="14" x2="14" y2="17" />
      <line x1="17" y1="14" x2="21" y2="14" />
      <line x1="21" y1="17" x2="21" y2="21" />
      <line x1="14" y1="20" x2="17.5" y2="20" />
    </svg>
  );
}
