import { renderCertCard, CARD_SIZE } from "../cert-card-image";

// Downloadable share card — same image as the OG link-preview at
// /cert/[id]/opengraph-image, served as a route so the cert page can offer a
// `download` link to a real file URL. 1080×1920 9:16 PNG (TikTok / IG Stories
// native).

export const size = CARD_SIZE;
export const contentType = "image/png";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return renderCertCard(Number(id));
}
