import { ImageResponse } from "next/og";

// Root share-link preview. Whenever the bare ai-red.io link (or any non-cert
// page) is pasted into WhatsApp / iMessage / Slack / X, this is the card the
// unfurler renders. The /cert/[id] route has its own opengraph-image that
// overrides this one for cert URLs (Phase 4 #2 part 5). 1200×630 is the
// universal OG size — Twitter, OpenGraph, LinkedIn all crop happily from it.

export const alt = "AIRED — AI-ed and proud";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#0a0a0a";
const FG = "#ededed";
const MUTED = "#8a8a8a";
const RED = "#ff2d2d";

export default function Image() {
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
          padding: 80,
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 10,
            background: RED,
            boxShadow: `0 0 28px 4px ${RED}`,
            display: "flex",
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            marginTop: 16,
          }}
        >
          <div
            style={{
              fontSize: 44,
              fontWeight: 700,
              letterSpacing: 12,
              color: FG,
              display: "flex",
            }}
          >
            AIRED
          </div>
          <div
            style={{
              fontSize: 20,
              letterSpacing: 6,
              textTransform: "uppercase",
              color: RED,
              display: "flex",
            }}
          >
            ai-red.io
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 28,
            marginTop: "auto",
            marginBottom: 40,
            maxWidth: 980,
          }}
        >
          <div
            style={{
              fontSize: 96,
              fontWeight: 800,
              lineHeight: 1.02,
              letterSpacing: -2,
              color: FG,
              display: "flex",
            }}
          >
            AI-ed and proud.
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 24,
            }}
          >
            <div
              style={{
                width: 220,
                height: 8,
                background: RED,
                borderRadius: 9999,
                boxShadow: `0 0 24px 3px ${RED}`,
                display: "flex",
              }}
            />
            <div
              style={{
                fontSize: 36,
                color: MUTED,
                display: "flex",
              }}
            >
              Music credited to human and AI, by name.
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
