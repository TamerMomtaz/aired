import { ImageResponse } from "next/og";
import QRCode from "qrcode";

// Branded, scannable AIRED QR poster — the "scan to enter" artifact for posters,
// stickers, cards, and IRL. Reuses the cert card's QR technique
// (src/app/cert/[id]/cert-card-image.tsx): QRCode.toDataURL → an <img> inside an
// ImageResponse, so next/og's Satori renderer can paint it (Satori is flexbox
// only — every box below carries an explicit display).
//
// One renderer, two doors: the global entrance (/qr/card → https://ai-red.io)
// and any per-song poster (https://ai-red.io/registry/{id}). The code itself is
// the highest-contrast pairing a phone camera can read — near-black modules on a
// white quiet-zone tile — so it survives a printed poster in poor light. The Red
// Line carries the brand *around* the code (glow bar, red frame, red wordmark +
// address), never *in* the modules, where it would cost contrast.

export const POSTER_SIZE = { width: 1080, height: 1350 } as const;

const BG = "#0a0a0a";
const FG = "#ededed";
const RED = "#ff2d2d";

type PosterOptions = {
  // What the code encodes (and where a scan lands).
  url: string;
  // The big line under the code.
  caption: string;
  // Optional small line above the wordmark — e.g. a catalog id on a per-song poster.
  eyebrow?: string;
  // Human-readable address printed under the caption. Defaults to the url with
  // its scheme stripped (ai-red.io, ai-red.io/registry/1).
  label?: string;
};

export async function renderQrPoster({
  url,
  caption,
  eyebrow,
  label,
}: PosterOptions): Promise<ImageResponse> {
  // High error correction (~30% recoverable) + a real quiet zone (margin) so the
  // code reads off print and odd lighting. Pure black on white is the most
  // reliable pairing; the brand red lives in the frame, not the modules.
  const qrDataUri = await QRCode.toDataURL(url, {
    errorCorrectionLevel: "H",
    margin: 2,
    width: 760,
    color: { dark: "#000000", light: "#ffffff" },
  });

  const address = label ?? url.replace(/^https?:\/\//, "");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: BG,
          color: FG,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
          padding: 72,
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* The Red Line — AIRED's signature bar (CLAUDE.md §3). */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 12,
            background: RED,
            boxShadow: `0 0 32px 5px ${RED}`,
            display: "flex",
          }}
        />

        {/* Wordmark + optional eyebrow. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
          }}
        >
          {eyebrow ? (
            <div
              style={{
                fontSize: 28,
                letterSpacing: 8,
                color: RED,
                fontFamily: "monospace",
                display: "flex",
              }}
            >
              {eyebrow}
            </div>
          ) : null}
          <div
            style={{
              fontSize: 64,
              fontWeight: 800,
              letterSpacing: 18,
              color: FG,
              display: "flex",
            }}
          >
            AIRED
          </div>
        </div>

        {/* The code — near-black on a white quiet-zone tile, inside a Red Line frame. */}
        <div
          style={{
            display: "flex",
            padding: 28,
            borderRadius: 32,
            background: "#ffffff",
            border: `6px solid ${RED}`,
            boxShadow: "0 0 48px 6px rgba(255,45,45,0.45)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUri}
            alt=""
            width={760}
            height={760}
            style={{ display: "flex" }}
          />
        </div>

        {/* Caption + address. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 22,
            width: "100%",
          }}
        >
          <div
            style={{
              fontSize: 42,
              fontWeight: 700,
              lineHeight: 1.2,
              color: FG,
              textAlign: "center",
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              maxWidth: 880,
            }}
          >
            {caption}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 56,
                height: 5,
                background: RED,
                borderRadius: 9999,
                boxShadow: `0 0 16px 2px ${RED}`,
                display: "flex",
              }}
            />
            <div
              style={{
                fontSize: 30,
                letterSpacing: 4,
                color: RED,
                fontFamily: "monospace",
                display: "flex",
              }}
            >
              {address}
            </div>
            <div
              style={{
                width: 56,
                height: 5,
                background: RED,
                borderRadius: 9999,
                boxShadow: `0 0 16px 2px ${RED}`,
                display: "flex",
              }}
            />
          </div>
        </div>
      </div>
    ),
    POSTER_SIZE,
  );
}
