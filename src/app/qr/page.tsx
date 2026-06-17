import type { Metadata } from "next";
import QRCode from "qrcode";

// The /qr door — a scannable AIRED code for spreading the platform IRL. Renders
// a large, high-contrast code on the dark theme inside a Red Line frame, the
// "scan to enter" line, and a Download QR button that pulls the branded poster
// PNG (/qr/card) so it can go on a poster, a sticker, a card — anything.
//
// Same code technique as the cert card and the downloadable poster: near-black
// modules on a white quiet-zone tile, the most reliable pairing a phone camera
// can read; the brand red lives in the frame, not the modules.

const ENTER_URL = "https://ai-red.io";
const CAPTION = "Scan to enter AIRED — AI-ed and proud.";

export const metadata: Metadata = {
  title: "Scan to enter AIRED — AI-ed and proud",
  description:
    "A scannable AIRED code for posters, stickers, and cards. Scan to enter AIRED — music credited to human and AI, by name.",
  alternates: { canonical: "/qr" },
};

export default async function QrPage() {
  const qrDataUri = await QRCode.toDataURL(ENTER_URL, {
    errorCorrectionLevel: "H",
    margin: 2,
    width: 720,
    color: { dark: "#000000", light: "#ffffff" },
  });

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center gap-8 px-5 py-12 text-center">
      <div className="flex flex-col items-center gap-2">
        <span className="text-2xl font-semibold tracking-[0.3em] text-foreground">
          AIRED
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-cert-red">
          AI-ed and proud
        </span>
      </div>

      {/* The code, on its white quiet-zone tile inside a Red Line frame. */}
      <div className="rounded-3xl border-2 border-cert-red/60 bg-white p-5 shadow-[0_0_48px_-8px_var(--cert-red)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrDataUri}
          alt="QR code linking to ai-red.io"
          width={300}
          height={300}
          className="size-[256px] sm:size-[300px]"
        />
      </div>

      <p className="text-lg font-medium text-foreground">{CAPTION}</p>

      <a
        href={ENTER_URL}
        className="font-mono text-sm uppercase tracking-[0.2em] text-cert-red transition hover:brightness-110"
      >
        ai-red.io
      </a>

      <a
        href="/qr/card"
        download="aired-qr.png"
        className="inline-flex items-center gap-2 rounded-lg bg-cert-red px-5 py-2.5 text-sm font-medium text-white shadow-[0_0_18px_-6px_var(--cert-red)] transition hover:brightness-110"
      >
        <DownloadIcon />
        <span>Download QR</span>
      </a>

      <p className="max-w-xs text-xs leading-relaxed text-muted">
        Put it on a poster, a sticker, a card. Anyone who scans it lands on
        AIRED.
      </p>
    </main>
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
