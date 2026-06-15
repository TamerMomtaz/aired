import { ImageResponse } from "next/og";

// The AIRED mark — the AIRED wordmark sitting above the Red Line, on near-black.
// Shared so the favicon, apple-touch icon, manifest PWA icons, and home-screen
// installs all render from one design. The cert card and OG share image live
// elsewhere because they carry copy and are 9:16 / 1.91:1; this is a square mark
// that scales from 180 to 512 cleanly.

const BG = "#0a0a0a";
const FG = "#ededed";
const RED = "#ff2d2d";

// Render the mark JSX at a target pixel size.
//   - maskable=true reserves a ~12% safe-zone border so Android mask shapes
//     (circle, squircle, rounded square) can crop the canvas without clipping.
//   - When maskable=false (apple-touch, favicon, the served 192/512 PWA icon)
//     the mark fills the canvas edge-to-edge.
function markJSX(size: number, maskable: boolean) {
  const safe = maskable ? Math.round(size * 0.12) : 0;
  const inner = size - safe * 2;
  const fontSize = Math.round(inner * 0.22);
  const letterSpacing = Math.round(fontSize * 0.18);
  const lineWidth = Math.round(inner * 0.66);
  const lineHeight = Math.max(3, Math.round(inner * 0.028));
  const gap = Math.round(inner * 0.07);
  const glow = Math.max(4, lineHeight * 2);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: BG,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: safe,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap,
        }}
      >
        <div
          style={{
            fontSize,
            fontWeight: 800,
            color: FG,
            letterSpacing,
            lineHeight: 1,
            display: "flex",
            fontFamily: "sans-serif",
          }}
        >
          AIRED
        </div>
        <div
          style={{
            width: lineWidth,
            height: lineHeight,
            background: RED,
            borderRadius: 9999,
            boxShadow: `0 0 ${glow}px ${Math.max(1, Math.round(lineHeight / 2))}px ${RED}`,
            display: "flex",
          }}
        />
      </div>
    </div>
  );
}

export function renderAiredMark(
  size: number,
  options: { maskable?: boolean } = {},
): ImageResponse {
  return new ImageResponse(markJSX(size, options.maskable ?? false), {
    width: size,
    height: size,
  });
}
