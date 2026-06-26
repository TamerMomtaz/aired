import { ImageResponse } from "next/og";
import QRCode from "qrcode";

import {
  addressOf,
  BG,
  Cover,
  FG,
  FONT,
  formatNamesLine,
  HeaderMark,
  MUTED,
  QrTile,
  RED,
  type ShareCardData,
  Wordmark,
} from "./card";
import { getOgFonts } from "./fonts";

// The SHARE VIDEO still frame — the burned-in background of the downloadable
// MP4 (the Reels / TikTok clip). Instagram & TikTok accept no links and only
// VIDEO carries audio, so to share a song *with sound* we render a real video:
// this frame, looped, with an audio-reactive waveform painted into the reserved
// band and the song's audio muxed underneath (the worker does that with ffmpeg,
// worker/src/clip.js). Everything that does NOT move lives here:
//   • the AIRED wordmark + the Red Line bar (the brand)
//   • the cover art, centered on the AIRED dark field
//   • AIRED-#### · the title
//   • the NAMED credits — carbon AND silicon, by name (CLAUDE.md §3a), built by
//     the SAME buildSongCard() the image cards use, so the burned-in names match
//     the share cards exactly
//   • the tagline, ai-red.io, and a scannable QR back to the work
//
// Identity & authorship ONLY — never resemblance, never a style descriptor
// (CLAUDE.md §2, §3). Same Satori (next/og) flexbox subset as card.tsx, but laid
// out with ABSOLUTE coordinates so the waveform band is a known rectangle: the
// worker reads that rectangle from the response headers and paints the waveform
// exactly into it (no shared magic numbers across the two services).

export type ClipOrientation = "vertical" | "square";

export type ClipBand = { x: number; y: number; w: number; h: number };

type ClipGeo = {
  width: number;
  height: number;
  pad: number;
  redbar: number;
  word: number;
  mark: number;
  headerY: number;
  cover: number;
  coverY: number;
  band: ClipBand;
  eyebrow: number;
  eyebrowY: number;
  title: number;
  titleY: number;
  titleH: number;
  namesLabel: number;
  names: number;
  creditsY: number;
  creditsH: number;
  tagline: number;
  footerY: number;
  qr: number;
  qrY: number;
};

// One geometry per format. Vertical (9:16) is the Reels / TikTok / Stories clip;
// square (1:1) is the IG feed clip. The `band` rect is the contract with the
// worker — it is emitted on the frame response (X-Clip-Band) and never hard-coded
// in two places.
export const CLIP_GEO: Record<ClipOrientation, ClipGeo> = {
  vertical: {
    width: 1080,
    height: 1920,
    pad: 80,
    redbar: 16,
    word: 50,
    mark: 21,
    headerY: 74,
    cover: 620,
    coverY: 184,
    band: { x: 90, y: 866, w: 900, h: 248 },
    eyebrow: 30,
    eyebrowY: 1158,
    title: 74,
    titleY: 1212,
    titleH: 176,
    namesLabel: 22,
    names: 34,
    creditsY: 1412,
    creditsH: 168,
    tagline: 31,
    footerY: 1712,
    qr: 208,
    qrY: 1700,
  },
  square: {
    width: 1080,
    height: 1080,
    pad: 64,
    redbar: 13,
    word: 40,
    mark: 17,
    headerY: 52,
    cover: 326,
    coverY: 120,
    band: { x: 72, y: 474, w: 936, h: 132 },
    eyebrow: 23,
    eyebrowY: 634,
    title: 50,
    titleY: 678,
    titleH: 118,
    namesLabel: 16,
    names: 25,
    creditsY: 812,
    creditsH: 104,
    tagline: 22,
    footerY: 936,
    qr: 132,
    qrY: 916,
  },
};

export const CLIP_DIMENSIONS: Record<
  ClipOrientation,
  { width: number; height: number }
> = {
  vertical: { width: CLIP_GEO.vertical.width, height: CLIP_GEO.vertical.height },
  square: { width: CLIP_GEO.square.width, height: CLIP_GEO.square.height },
};

// Serialize the band rect for the X-Clip-Band response header → "x,y,w,h".
export function bandHeader(o: ClipOrientation): string {
  const b = CLIP_GEO[o].band;
  return `${b.x},${b.y},${b.w},${b.h}`;
}

// A glowing Red Line bar across the very top — AIRED's signature (CLAUDE.md §3).
function TopBar({ height }: { height: number }) {
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

// The reserved waveform band — a subtly darker "now-playing" panel with a faint
// red baseline, so even the still frame reads as a player. The worker paints the
// animated, audio-reactive waveform on top of exactly this rectangle.
function WaveformPanel({ band }: { band: ClipBand }) {
  return (
    <div
      style={{
        position: "absolute",
        left: band.x,
        top: band.y,
        width: band.w,
        height: band.h,
        background: "#0f0f0f",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.05)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: "92%",
          height: 2,
          background: "rgba(255,45,45,0.35)",
          display: "flex",
        }}
      />
    </div>
  );
}

function ClipFrame({
  data,
  geo,
  qrDataUri,
}: {
  data: ShareCardData;
  geo: ClipGeo;
  qrDataUri: string;
}) {
  const titleText = data.quote ? `“${data.title}”` : data.title;
  const namesLine = formatNamesLine(data.names);
  const contentWidth = geo.width - geo.pad * 2;
  const coverX = Math.round((geo.width - geo.cover) / 2);

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
        fontFamily: FONT,
        position: "relative",
      }}
    >
      <TopBar height={geo.redbar} />

      {/* Header — wordmark left, Red Line pill / address right. */}
      <div
        style={{
          position: "absolute",
          left: geo.pad,
          right: geo.pad,
          top: geo.headerY,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Wordmark fontSize={geo.word} />
        <HeaderMark certified={data.certified} fontSize={geo.mark} />
      </div>

      {/* Cover, centered. */}
      <div
        style={{
          position: "absolute",
          left: coverX,
          top: geo.coverY,
          display: "flex",
        }}
      >
        <Cover data={data} size={geo.cover} />
      </div>

      <WaveformPanel band={geo.band} />

      {/* AIRED-#### eyebrow. */}
      <div
        style={{
          position: "absolute",
          left: geo.pad,
          width: contentWidth,
          top: geo.eyebrowY,
          fontSize: geo.eyebrow,
          letterSpacing: 8,
          color: RED,
          fontFamily: "monospace",
          display: "flex",
          justifyContent: "center",
        }}
      >
        {data.eyebrow}
      </div>

      {/* Title — up to two lines, clamped so it never collides with the band. */}
      <div
        style={{
          position: "absolute",
          left: geo.pad,
          width: contentWidth,
          top: geo.titleY,
          height: geo.titleH,
          fontSize: geo.title,
          fontWeight: 800,
          lineHeight: 1.05,
          color: FG,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "flex-start",
          textAlign: "center",
          overflow: "hidden",
        }}
      >
        {titleText}
      </div>

      {/* Credits — the platform's whole point, carbon AND silicon by name. */}
      {namesLine ? (
        <div
          style={{
            position: "absolute",
            left: geo.pad,
            width: contentWidth,
            top: geo.creditsY,
            height: geo.creditsH,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: Math.round(geo.names * 0.4),
            overflow: "hidden",
          }}
        >
          <div
            style={{
              fontSize: geo.namesLabel,
              letterSpacing: Math.round(geo.namesLabel * 0.3),
              textTransform: "uppercase",
              color: RED,
              display: "flex",
            }}
          >
            {data.namesLabel}
          </div>
          <div
            style={{
              fontSize: geo.names,
              lineHeight: 1.25,
              color: FG,
              fontWeight: 600,
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              textAlign: "center",
              maxWidth: contentWidth,
            }}
          >
            {namesLine}
          </div>
        </div>
      ) : null}

      {/* Footer — the promise + address (left), a scannable QR (right). */}
      <div
        style={{
          position: "absolute",
          left: geo.pad,
          top: geo.footerY,
          display: "flex",
          flexDirection: "column",
          gap: Math.round(geo.tagline * 0.32),
        }}
      >
        <div
          style={{ fontSize: geo.tagline, fontWeight: 700, color: FG, display: "flex" }}
        >
          AI-ed and proud.
        </div>
        <div
          style={{
            fontSize: Math.round(geo.tagline * 0.82),
            color: MUTED,
            display: "flex",
          }}
        >
          Credited, not thanked.
        </div>
        <div
          style={{
            fontSize: Math.round(geo.tagline * 0.82),
            color: RED,
            fontFamily: "monospace",
            display: "flex",
          }}
        >
          {addressOf(data.url)}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          right: geo.pad,
          top: geo.qrY,
          display: "flex",
        }}
      >
        <QrTile dataUri={qrDataUri} size={geo.qr} />
      </div>
    </div>
  );
}

// Build the still-frame ImageResponse for a song at a given orientation. Both
// the brand (Geist) and Arabic (Tajawal) faces are handed to Satori so a mixed
// Latin+Arabic title renders per-glyph instead of throwing on the first glyph
// the Latin face can't cover (the old 500 that killed the video).
async function buildClipFrame(
  data: ShareCardData,
  geo: ClipGeo,
): Promise<ImageResponse> {
  const qrDataUri = await QRCode.toDataURL(data.url, {
    errorCorrectionLevel: "H",
    margin: 2,
    width: 512,
    color: { dark: "#0a0a0a", light: "#ffffff" },
  });
  return new ImageResponse(
    <ClipFrame data={data} geo={geo} qrDataUri={qrDataUri} />,
    { width: geo.width, height: geo.height, fonts: await getOgFonts() },
  );
}

// Force Satori to actually paint (a font/glyph error surfaces while the body is
// consumed, NOT at construction) and re-wrap the bytes as a PNG carrying the
// worker's headers. Buffering is what lets us catch a render error here instead
// of streaming a silent 5xx.
async function pngResponse(
  image: ImageResponse,
  headers?: Record<string, string>,
): Promise<Response> {
  const body = await image.arrayBuffer();
  return new Response(body, {
    headers: { "Content-Type": "image/png", ...headers },
  });
}

// Render the still frame for a resolved song at a given orientation. The route
// sets the X-Clip-Band / X-Clip-Size headers (it knows the orientation) so the
// worker can paint the waveform without any shared coordinate constant.
//
// HARDENED: the full render is buffered so a Satori failure is caught here and
// logged with the REAL error (id, title, orientation) instead of a silent 5xx.
// If it ever fails anyway, we DEGRADE — render the same-sized, same-band branded
// frame without the title/credits text (text being the only thing that can trip
// a glyph/font error) so the worker still gets a valid frame and the video is
// still made, rather than 500-ing the route and killing the clip.
export async function renderClipFrame(
  data: ShareCardData,
  orientation: ClipOrientation,
  options: { headers?: Record<string, string> } = {},
): Promise<Response> {
  const geo = CLIP_GEO[orientation];
  try {
    return await pngResponse(await buildClipFrame(data, geo), options.headers);
  } catch (err) {
    console.error(
      `[clip-frame] render failed for work url=${data.url} orientation=${orientation} title=${JSON.stringify(
        data.title,
      )}:`,
      err,
    );
    try {
      // Drop the user-supplied text (title + credits) — everything else is
      // brand chrome that cannot trip a glyph error. Same dimensions, same band.
      const safe: ShareCardData = { ...data, title: "", quote: false, names: [] };
      return await pngResponse(await buildClipFrame(safe, geo), options.headers);
    } catch (degradedErr) {
      console.error(
        `[clip-frame] degraded render ALSO failed orientation=${orientation}:`,
        degradedErr,
      );
      return new Response("clip frame render failed", { status: 500 });
    }
  }
}
