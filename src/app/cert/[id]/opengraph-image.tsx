import { renderCertCard, CARD_SIZE } from "./cert-card-image";

// The social link-preview for /cert/[id]. The image IS the share card (see the
// sibling /cert/[id]/card route), so sharing the cert URL anywhere — Slack,
// iMessage, X — drops the same 9:16 image people can also download and post to
// vertical surfaces. Phase 4 #2 part 5.

export const alt = "AIRED Red Line Certificate";
export const size = CARD_SIZE;
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return renderCertCard(Number(id));
}
