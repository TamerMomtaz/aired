import { ImageResponse } from "next/og";
import QRCode from "qrcode";

import { formatCatalogId } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/server";

// Shared renderer for the Phase 4 #2 share card. The downloadable PNG at
// /cert/[id]/card and the social OG preview at /cert/[id]/opengraph-image are
// the same image — both call renderCertCard(workId). Pulled out so the design
// lives in one place. 1080×1920 (9:16), TikTok / IG Stories native.

export const CARD_SIZE = { width: 1080, height: 1920 } as const;

type CertChecks = {
  contributors?: { name: string; type: "human" | "ai" | "tool" }[];
};

type CertRow = {
  standard: string | null;
  checks: CertChecks | null;
};

type WorkRow = {
  id: number | string;
  title: string;
};

function fallback(message: string) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0a0a0a",
          color: "#ededed",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 48,
        }}
      >
        {message}
      </div>
    ),
    CARD_SIZE,
  );
}

export async function renderCertCard(workId: number): Promise<ImageResponse> {
  if (!Number.isInteger(workId) || workId <= 0) {
    return fallback("Not found");
  }

  const supabase = await createClient();

  const { data: cert } = (await supabase
    .from("certification")
    .select("standard, checks")
    .eq("work_id", workId)
    .maybeSingle()) as { data: CertRow | null };
  if (!cert) {
    return fallback("No certificate yet");
  }

  const { data: work } = (await supabase
    .from("work")
    .select("id, title")
    .eq("id", workId)
    .maybeSingle()) as { data: WorkRow | null };
  if (!work) {
    return fallback("Not found");
  }

  const contributors = cert.checks?.contributors ?? [];
  const standard = cert.standard ?? "&I v1";
  const catalogId = formatCatalogId(Number(work.id));
  const liveUrl = `https://ai-red.io/registry/${workId}`;

  // QR — high error correction, cert-red on near-black, embedded as a data URI
  // so Satori (used by next/og) can render it via <img>.
  const qrDataUri = await QRCode.toDataURL(liveUrl, {
    errorCorrectionLevel: "H",
    margin: 1,
    width: 360,
    color: { dark: "#ff2d2d", light: "#0a0a0a" },
  });

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0a0a0a",
          color: "#ededed",
          display: "flex",
          flexDirection: "column",
          padding: 80,
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* The Red Line motif — the cert's signature bar. */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 14,
            background: "#ff2d2d",
            boxShadow: "0 0 36px 6px #ff2d2d",
            display: "flex",
          }}
        />

        {/* Wordmark + standard line. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            marginTop: 32,
          }}
        >
          <div
            style={{
              fontSize: 56,
              fontWeight: 700,
              letterSpacing: 14,
              color: "#ededed",
              display: "flex",
            }}
          >
            AIRED
          </div>
          <div
            style={{
              fontSize: 22,
              letterSpacing: 6,
              textTransform: "uppercase",
              color: "#ff2d2d",
              display: "flex",
            }}
          >
            Red Line · {standard}
          </div>
        </div>

        {/* Catalog id + title — the anchor and the song. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            marginTop: 220,
          }}
        >
          <div
            style={{
              fontSize: 44,
              letterSpacing: 10,
              color: "#ff2d2d",
              fontFamily: "monospace",
              display: "flex",
            }}
          >
            {catalogId}
          </div>
          <div
            style={{
              fontSize: 96,
              fontWeight: 700,
              lineHeight: 1.05,
              color: "#ededed",
              display: "flex",
              flexWrap: "wrap",
            }}
          >
            “{work.title}”
          </div>
        </div>

        {/* Carbon & silicon, by name — the platform's whole point. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            marginTop: 80,
          }}
        >
          <div
            style={{
              fontSize: 22,
              letterSpacing: 6,
              textTransform: "uppercase",
              color: "#8a8a8a",
              display: "flex",
            }}
          >
            Carbon &amp; silicon — credited, by name
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 14,
              maxWidth: 920,
            }}
          >
            {contributors.length === 0 ? (
              <div
                style={{
                  fontSize: 28,
                  color: "#8a8a8a",
                  display: "flex",
                }}
              >
                The ledger names every hand.
              </div>
            ) : (
              contributors.slice(0, 8).map((c) => (
                <div
                  key={c.name}
                  style={{
                    fontSize: 32,
                    padding: "10px 22px",
                    borderRadius: 999,
                    border:
                      c.type === "human"
                        ? "2px solid rgba(255,255,255,0.3)"
                        : c.type === "tool"
                          ? "2px solid rgba(255,255,255,0.18)"
                          : "2px solid rgba(255,45,45,0.55)",
                    background:
                      c.type === "human"
                        ? "rgba(255,255,255,0.06)"
                        : c.type === "tool"
                          ? "rgba(255,255,255,0.03)"
                          : "rgba(255,45,45,0.12)",
                    color:
                      c.type === "human"
                        ? "#ededed"
                        : c.type === "tool"
                          ? "#8a8a8a"
                          : "#ff2d2d",
                    display: "flex",
                  }}
                >
                  {c.name}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Bottom: claim + QR. Auto-margin holds the row at the page floor. */}
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 40,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              maxWidth: 560,
            }}
          >
            <div
              style={{
                fontSize: 22,
                letterSpacing: 6,
                textTransform: "uppercase",
                color: "#8a8a8a",
                display: "flex",
              }}
            >
              Certifies authorship &amp; process
            </div>
            <div
              style={{
                fontSize: 28,
                color: "#ededed",
                lineHeight: 1.3,
                display: "flex",
              }}
            >
              Never resemblance. AIRED makes no claim of similarity to any
              artist.
            </div>
            <div
              style={{
                marginTop: 24,
                fontSize: 24,
                color: "#ff2d2d",
                fontFamily: "monospace",
                display: "flex",
              }}
            >
              ai-red.io/registry/{workId}
            </div>
          </div>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUri}
            alt=""
            width={360}
            height={360}
            style={{
              borderRadius: 16,
              border: "2px solid rgba(255,45,45,0.4)",
            }}
          />
        </div>
      </div>
    ),
    CARD_SIZE,
  );
}
