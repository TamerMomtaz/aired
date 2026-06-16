import { ImageResponse } from "next/og";

import { formatCatalogId } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/server";
import { getWorkById } from "@/lib/works/queries";

// Per-song share preview: when a registry URL is dropped into WhatsApp / X /
// iMessage / Slack, this is the card the unfurler renders. The brief is the
// platform's whole pitch in one image — cover, AIRED-#### · title, and the
// makers' names, carbon and silicon together. Identity and authorship only —
// never a style descriptor (CLAUDE.md rules 2 + 3a). The root /opengraph-image
// is the fallback for any URL we don't override; this one overrides for songs.

export const alt = "AIRED — a song, credited to human and AI by name";
export const size = { width: 1200, height: 630 } as const;
export const contentType = "image/png";

const BG = "#0a0a0a";
const FG = "#ededed";
const MUTED = "#8a8a8a";
const RED = "#ff2d2d";

// "Tee" → "Tee"; "Tee, Claude" → "Tee & Claude"; "Tee, Claude, Suno" →
// "Tee, Claude & Suno". Soft cap to keep the OG line legible if a work
// somehow accrues a long lineage.
function joinNames(names: string[]): string {
  const visible = names.slice(0, 4);
  const extra = names.length - visible.length;
  let head: string;
  if (visible.length === 0) head = "";
  else if (visible.length === 1) head = visible[0];
  else if (visible.length === 2) head = `${visible[0]} & ${visible[1]}`;
  else
    head = `${visible.slice(0, -1).join(", ")} & ${visible[visible.length - 1]}`;
  if (extra > 0) return `${head} +${extra}`;
  return head;
}

function fallback() {
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
          padding: 64,
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
            fontSize: 44,
            fontWeight: 700,
            letterSpacing: 12,
            color: FG,
            display: "flex",
            marginTop: 12,
          }}
        >
          AIRED
        </div>
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          <div
            style={{
              fontSize: 64,
              fontWeight: 800,
              lineHeight: 1.05,
              color: FG,
              display: "flex",
            }}
          >
            AI-ed and proud.
          </div>
          <div style={{ fontSize: 28, color: MUTED, display: "flex" }}>
            Music credited to human and AI, by name.
          </div>
        </div>
      </div>
    ),
    size,
  );
}

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const workId = Number(id);
  if (!Number.isInteger(workId) || workId <= 0) return fallback();

  const supabase = await createClient();
  const work = await getWorkById(supabase, workId);
  if (!work) return fallback();

  const catalogId = formatCatalogId(work.id);
  const makers = joinNames(work.contributors.map((c) => c.name));

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
          padding: 56,
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* Red Line motif — the cert-red signature bar. */}
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

        {/* Header: wordmark + optional Red Line cert mark. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            marginTop: 8,
          }}
        >
          <div
            style={{
              fontSize: 36,
              fontWeight: 700,
              letterSpacing: 10,
              color: FG,
              display: "flex",
            }}
          >
            AIRED
          </div>
          {work.red_line_certified ? (
            <div
              style={{
                fontSize: 18,
                letterSpacing: 5,
                textTransform: "uppercase",
                color: RED,
                border: `2px solid ${RED}`,
                borderRadius: 999,
                padding: "8px 18px",
                display: "flex",
              }}
            >
              ● Red Line
            </div>
          ) : (
            <div
              style={{
                fontSize: 18,
                letterSpacing: 5,
                textTransform: "uppercase",
                color: MUTED,
                display: "flex",
              }}
            >
              ai-red.io
            </div>
          )}
        </div>

        {/* Body: cover art (or graceful fallback) + the song's identity. */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 48,
            marginTop: 44,
            flex: 1,
          }}
        >
          {work.artwork_url ? (
            <img
              src={work.artwork_url}
              alt=""
              width={360}
              height={360}
              style={{
                width: 360,
                height: 360,
                borderRadius: 24,
                objectFit: "cover",
                border: "2px solid rgba(255,255,255,0.08)",
              }}
            />
          ) : (
            <div
              style={{
                width: 360,
                height: 360,
                borderRadius: 24,
                border: "2px dashed rgba(255,255,255,0.18)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "rgba(255,255,255,0.4)",
                fontSize: 18,
                letterSpacing: 6,
                textTransform: "uppercase",
              }}
            >
              no art
            </div>
          )}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 20,
              flex: 1,
              minWidth: 0,
            }}
          >
            <div
              style={{
                fontSize: 32,
                letterSpacing: 8,
                color: RED,
                fontFamily: "monospace",
                display: "flex",
              }}
            >
              {catalogId}
            </div>
            <div
              style={{
                fontSize: 68,
                fontWeight: 800,
                lineHeight: 1.05,
                color: FG,
                display: "flex",
                flexWrap: "wrap",
              }}
            >
              “{work.title}”
            </div>
            <div
              style={{
                fontSize: 30,
                lineHeight: 1.25,
                color: MUTED,
                display: "flex",
                flexWrap: "wrap",
              }}
            >
              by {makers || "carbon and silicon, together"}
            </div>
          </div>
        </div>

        {/* Bottom claim — the platform's whole point, in one line. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            marginTop: 28,
          }}
        >
          <div
            style={{
              width: 120,
              height: 5,
              background: RED,
              borderRadius: 9999,
              boxShadow: `0 0 16px 2px ${RED}`,
              display: "flex",
            }}
          />
          <div style={{ fontSize: 22, color: MUTED, display: "flex" }}>
            Carbon and silicon — credited, by name.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
