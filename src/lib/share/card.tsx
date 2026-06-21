import { ImageResponse } from "next/og";
import QRCode from "qrcode";

// The publicity-grade share card — ONE design, exported at several sizes. It
// sells the single thing only AIRED does: carbon AND silicon credited by name
// (CLAUDE.md §3a). The same renderer feeds three surfaces:
//   • og     1200×630  — the link-preview unfurled by FB / X / WhatsApp / etc.
//   • square 1080×1080 — Instagram feed, downloaded and posted by hand.
//   • story  1080×1920 — IG / Reels / TikTok story cover, downloaded and posted.
// Link-preview platforms read the og card off the URL; image platforms take no
// links, so square/story are downloadable PNGs (link in bio). The QR rides on the
// downloadable formats so a screenshot still routes back to the work.
//
// Identity & authorship ONLY — never resemblance, never a style descriptor
// (CLAUDE.md §2, §3). The card names the makers; it never says "sounds like".
//
// Satori (next/og) renders a flexbox subset — every box carries an explicit
// `display`, and there is no grid. Mirrors the cert card + per-song OG patterns.

export type ShareVariant = "og" | "square" | "story";

export const SHARE_DIMENSIONS: Record<
  ShareVariant,
  { width: number; height: number }
> = {
  og: { width: 1200, height: 630 },
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
};

export type ShareCardData = {
  kind: "song" | "album" | "artist";
  // Small line above the title: a catalog id for a song, the kind otherwise.
  eyebrow: string;
  // The hero line — a song/album title, or an artist's name.
  title: string;
  // Wrap the title in “quotes” (a work has a title; an artist is a name).
  quote: boolean;
  // Cover art / album cover / artist avatar; null → a branded placeholder.
  coverUrl: string | null;
  // Artist avatars crop to a circle; song/album covers to a rounded square.
  round: boolean;
  // For the round placeholder when an artist has no avatar (their initial).
  initial?: string;
  // The named contributors / collaborators — front and centre. May be empty.
  names: string[];
  // The label above the names line.
  namesLabel: string;
  // A secondary identity line — "by {artist}" for an album, "@handle" for an
  // artist. null for a song (the credits line already carries the makers).
  byline: string | null;
  // The Red Line cert mark shows when true.
  certified: boolean;
  // Canonical https URL — the QR target and the printed address.
  url: string;
};

// Palette + font are shared with the SHARE VIDEO clip frame (src/lib/share/clip.tsx)
// so a downloaded MP4 carries the exact same publicity DNA as the image cards.
export const BG = "#0a0a0a";
export const FG = "#ededed";
export const MUTED = "#8a8a8a";
export const RED = "#ff2d2d";
export const FONT = "sans-serif";

// names → "Tee Momtaz  ·  Claude  ·  Suno" (soft cap, "+N" tail) so a long
// lineage still renders on one or two lines. The brief's exact example line.
export function formatNamesLine(names: string[], max = 6): string {
  const visible = names.slice(0, max);
  const extra = names.length - visible.length;
  const head = visible.join("  ·  ");
  return extra > 0 ? `${head}  +${extra}` : head;
}

// "https://ai-red.io/registry/1" → "ai-red.io/registry/1".
export function addressOf(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

// The Red Line — AIRED's signature bar, glowing across the top (CLAUDE.md §3).
function RedBar({ height }: { height: number }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height,
        background: RED,
        boxShadow: `0 0 ${height * 3}px ${Math.round(height / 2)}px ${RED}`,
        display: "flex",
      }}
    />
  );
}

export function Wordmark({ fontSize }: { fontSize: number }) {
  return (
    <div
      style={{
        fontSize,
        fontWeight: 700,
        letterSpacing: Math.round(fontSize * 0.28),
        color: FG,
        display: "flex",
      }}
    >
      AIRED
    </div>
  );
}

// Either the Red Line cert pill (certified) or the bare wordmark address (not),
// so the header's right edge always carries the brand. The full per-subject
// address is printed in the footer.
export function HeaderMark({
  certified,
  fontSize,
}: {
  certified: boolean;
  fontSize: number;
}) {
  if (certified) {
    return (
      <div
        style={{
          fontSize,
          letterSpacing: Math.round(fontSize * 0.28),
          textTransform: "uppercase",
          color: RED,
          border: `2px solid ${RED}`,
          borderRadius: 999,
          padding: `${Math.round(fontSize * 0.45)}px ${fontSize}px`,
          display: "flex",
        }}
      >
        ● Red Line
      </div>
    );
  }
  return (
    <div
      style={{
        fontSize,
        letterSpacing: Math.round(fontSize * 0.28),
        textTransform: "uppercase",
        color: MUTED,
        display: "flex",
      }}
    >
      ai-red.io
    </div>
  );
}

export function Cover({
  data,
  size,
}: {
  data: ShareCardData;
  size: number;
}) {
  const radius = data.round ? Math.round(size / 2) : Math.round(size * 0.07);
  if (data.coverUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={data.coverUrl}
        alt=""
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          objectFit: "cover",
          border: "2px solid rgba(255,255,255,0.08)",
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        border: "2px dashed rgba(255,255,255,0.18)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "rgba(255,255,255,0.55)",
        fontSize: Math.round(size * (data.round ? 0.42 : 0.16)),
        fontWeight: 800,
        letterSpacing: data.round ? 0 : Math.round(size * 0.03),
      }}
    >
      {data.round ? (data.initial ?? "·") : "AIRED"}
    </div>
  );
}

// The credits block — the platform's whole point, so it sits front and centre.
function Credits({
  label,
  line,
  labelSize,
  nameSize,
  center,
  maxWidth,
}: {
  label: string;
  line: string;
  labelSize: number;
  nameSize: number;
  center: boolean;
  maxWidth: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: Math.round(nameSize * 0.4),
        alignItems: center ? "center" : "flex-start",
        maxWidth,
      }}
    >
      <div
        style={{
          fontSize: labelSize,
          letterSpacing: Math.round(labelSize * 0.3),
          textTransform: "uppercase",
          color: RED,
          display: "flex",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: nameSize,
          lineHeight: 1.25,
          color: FG,
          fontWeight: 600,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: center ? "center" : "flex-start",
          textAlign: center ? "center" : "left",
          maxWidth,
        }}
      >
        {line}
      </div>
    </div>
  );
}

// The wordmark's promise, repeated where a screenshot will carry it (CLAUDE.md
// §7: credited, not thanked). Two lines so it reads as a signature.
function Tagline({
  fontSize,
  center,
}: {
  fontSize: number;
  center: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: center ? "center" : "flex-start",
        gap: Math.round(fontSize * 0.2),
      }}
    >
      <div
        style={{
          fontSize,
          fontWeight: 700,
          color: FG,
          display: "flex",
        }}
      >
        AI-ed and proud.
      </div>
      <div
        style={{
          fontSize: Math.round(fontSize * 0.82),
          color: MUTED,
          display: "flex",
        }}
      >
        Credited, not thanked.
      </div>
    </div>
  );
}

// A white quiet-zone QR tile inside a Red Line frame — highest-contrast modules
// (near-black on white) so a phone reads it off a posted screenshot, the brand
// living in the frame, not the code (same technique as the /qr poster).
export function QrTile({ dataUri, size }: { dataUri: string; size: number }) {
  return (
    <div
      style={{
        display: "flex",
        padding: Math.round(size * 0.06),
        borderRadius: Math.round(size * 0.12),
        background: "#ffffff",
        border: `3px solid ${RED}`,
        boxShadow: "0 0 28px 4px rgba(255,45,45,0.4)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={dataUri}
        alt=""
        width={size}
        height={size}
        style={{ display: "flex" }}
      />
    </div>
  );
}

// 1200×630 landscape — cover on the left, identity on the right. This is the
// link-preview every messaging app unfurls, so it carries no QR (the link is
// the call to action); the brand sits in the header + footer.
function LandscapeCard({ data }: { data: ShareCardData }) {
  const titleText = data.quote ? `“${data.title}”` : data.title;
  const namesLine = formatNamesLine(data.names);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: BG,
        backgroundImage:
          "linear-gradient(160deg, #0c0c0c 0%, #070707 70%, #050505 100%)",
        color: FG,
        display: "flex",
        flexDirection: "column",
        padding: 56,
        fontFamily: FONT,
        position: "relative",
      }}
    >
      <RedBar height={10} />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          marginTop: 8,
        }}
      >
        <Wordmark fontSize={36} />
        <HeaderMark certified={data.certified} fontSize={18} />
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 48,
          marginTop: 30,
          flex: 1,
        }}
      >
        <Cover data={data} size={300} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            flex: 1,
            minWidth: 0,
          }}
        >
          <div
            style={{
              fontSize: 26,
              letterSpacing: data.kind === "song" ? 8 : 6,
              color: RED,
              fontFamily: data.kind === "song" ? "monospace" : FONT,
              textTransform: data.kind === "song" ? "none" : "uppercase",
              display: "flex",
            }}
          >
            {data.eyebrow}
          </div>
          <div
            style={{
              fontSize: 58,
              fontWeight: 800,
              lineHeight: 1.04,
              color: FG,
              display: "flex",
              flexWrap: "wrap",
            }}
          >
            {titleText}
          </div>
          {namesLine ? (
            <Credits
              label={data.namesLabel}
              line={namesLine}
              labelSize={16}
              nameSize={28}
              center={false}
              maxWidth={720}
            />
          ) : null}
          {data.byline ? (
            <div style={{ fontSize: 26, color: MUTED, display: "flex" }}>
              {data.byline}
            </div>
          ) : null}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginTop: 24,
        }}
      >
        <Tagline fontSize={24} center={false} />
        <div
          style={{
            fontSize: 22,
            color: RED,
            fontFamily: "monospace",
            display: "flex",
          }}
        >
          {addressOf(data.url)}
        </div>
      </div>
    </div>
  );
}

type PortraitConfig = {
  pad: number;
  cover: number;
  word: number;
  redbar: number;
  headerMark: number;
  eyebrow: number;
  title: number;
  namesLabel: number;
  names: number;
  byline: number;
  tagline: number;
  qr: number;
  gap: number;
};

const PORTRAIT: Record<"square" | "story", PortraitConfig> = {
  square: {
    pad: 64,
    cover: 384,
    word: 40,
    redbar: 12,
    headerMark: 17,
    eyebrow: 24,
    title: 60,
    namesLabel: 17,
    names: 28,
    byline: 24,
    tagline: 24,
    qr: 132,
    gap: 18,
  },
  story: {
    pad: 88,
    cover: 560,
    word: 54,
    redbar: 14,
    headerMark: 22,
    eyebrow: 30,
    title: 84,
    namesLabel: 22,
    names: 34,
    byline: 30,
    tagline: 30,
    qr: 220,
    gap: 28,
  },
};

// 1080×1080 and 1080×1920 — a centred vertical stack: cover, identity, then a
// footer pinned to the floor with the promise + address + a scannable QR. Same
// design as the landscape card, re-flowed for a portrait, downloadable post.
function PortraitCard({
  data,
  variant,
  qrDataUri,
}: {
  data: ShareCardData;
  variant: "square" | "story";
  qrDataUri: string;
}) {
  const p = PORTRAIT[variant];
  const titleText = data.quote ? `“${data.title}”` : data.title;
  const namesLine = formatNamesLine(data.names);
  const contentWidth = SHARE_DIMENSIONS[variant].width - p.pad * 2;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: BG,
        backgroundImage:
          "linear-gradient(165deg, #0c0c0c 0%, #070707 70%, #050505 100%)",
        color: FG,
        display: "flex",
        flexDirection: "column",
        padding: p.pad,
        fontFamily: FONT,
        position: "relative",
      }}
    >
      <RedBar height={p.redbar} />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          marginTop: p.redbar,
        }}
      >
        <Wordmark fontSize={p.word} />
        <HeaderMark certified={data.certified} fontSize={p.headerMark} />
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: p.gap,
          flex: 1,
        }}
      >
        <Cover data={data} size={p.cover} />
        <div
          style={{
            fontSize: p.eyebrow,
            letterSpacing: data.kind === "song" ? 8 : 6,
            color: RED,
            fontFamily: data.kind === "song" ? "monospace" : FONT,
            textTransform: data.kind === "song" ? "none" : "uppercase",
            display: "flex",
            marginTop: p.gap,
          }}
        >
          {data.eyebrow}
        </div>
        <div
          style={{
            fontSize: p.title,
            fontWeight: 800,
            lineHeight: 1.05,
            color: FG,
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            textAlign: "center",
            maxWidth: contentWidth,
          }}
        >
          {titleText}
        </div>
        {namesLine ? (
          <Credits
            label={data.namesLabel}
            line={namesLine}
            labelSize={p.namesLabel}
            nameSize={p.names}
            center
            maxWidth={contentWidth}
          />
        ) : null}
        {data.byline ? (
          <div style={{ fontSize: p.byline, color: MUTED, display: "flex" }}>
            {data.byline}
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 32,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: Math.round(p.tagline * 0.6),
          }}
        >
          <Tagline fontSize={p.tagline} center={false} />
          <div
            style={{
              fontSize: Math.round(p.tagline * 0.8),
              color: RED,
              fontFamily: "monospace",
              display: "flex",
            }}
          >
            {addressOf(data.url)}
          </div>
        </div>
        <QrTile dataUri={qrDataUri} size={p.qr} />
      </div>
    </div>
  );
}

// The neutral AIRED card, served when a subject can't be resolved (a missing or
// non-live work / album / artist) so a share unfurl degrades gracefully rather
// than 500-ing. Mirrors the root /opengraph-image's voice.
function FallbackCard({ variant }: { variant: ShareVariant }) {
  const { width, height } = SHARE_DIMENSIONS[variant];
  const portrait = height > width;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: BG,
        backgroundImage:
          "linear-gradient(165deg, #0c0c0c 0%, #070707 70%, #050505 100%)",
        color: FG,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: portrait ? 36 : 24,
        fontFamily: FONT,
        position: "relative",
        padding: 64,
      }}
    >
      <RedBar height={portrait ? 14 : 10} />
      <div
        style={{
          fontSize: portrait ? 88 : 64,
          fontWeight: 800,
          letterSpacing: portrait ? 22 : 16,
          color: FG,
          display: "flex",
        }}
      >
        AIRED
      </div>
      <div
        style={{
          width: portrait ? 220 : 180,
          height: 7,
          background: RED,
          borderRadius: 9999,
          boxShadow: `0 0 24px 3px ${RED}`,
          display: "flex",
        }}
      />
      <div
        style={{
          fontSize: portrait ? 38 : 30,
          color: MUTED,
          textAlign: "center",
          display: "flex",
        }}
      >
        AI-ed and proud — credited, not thanked.
      </div>
    </div>
  );
}

// Render the publicity card for a resolved subject at a given size. The
// downloadable formats (square/story) carry a QR back to the work; the og
// link-preview does not. `headers` lets the download route force an attachment.
export async function renderShareCard(
  data: ShareCardData,
  variant: ShareVariant,
  options: { headers?: Record<string, string> } = {},
): Promise<ImageResponse> {
  const dims = SHARE_DIMENSIONS[variant];
  if (variant === "og") {
    return new ImageResponse(<LandscapeCard data={data} />, {
      ...dims,
      headers: options.headers,
    });
  }
  const qrDataUri = await QRCode.toDataURL(data.url, {
    errorCorrectionLevel: "H",
    margin: 2,
    width: 512,
    color: { dark: "#0a0a0a", light: "#ffffff" },
  });
  return new ImageResponse(
    <PortraitCard data={data} variant={variant} qrDataUri={qrDataUri} />,
    { ...dims, headers: options.headers },
  );
}

// Render the neutral fallback at a given size (same options surface).
export function renderShareFallback(
  variant: ShareVariant,
  options: { headers?: Record<string, string> } = {},
): ImageResponse {
  return new ImageResponse(<FallbackCard variant={variant} />, {
    ...SHARE_DIMENSIONS[variant],
    headers: options.headers,
  });
}
