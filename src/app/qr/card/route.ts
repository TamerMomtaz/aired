import { renderQrPoster, POSTER_SIZE } from "../qr-poster-image";

// Downloadable AIRED entrance poster — the branded, scannable QR served as a
// real file URL so /qr can offer a `download` link (mirrors the cert card route
// at /cert/[id]/card). 1080×1350 (4:5) PNG: a poster/card that prints clean and
// posts native to feeds. The code encodes https://ai-red.io.

export const size = POSTER_SIZE;
export const contentType = "image/png";

export async function GET() {
  return renderQrPoster({
    url: "https://ai-red.io",
    caption: "Scan to enter AIRED — AI-ed and proud.",
  });
}
