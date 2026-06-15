import { renderAiredMark } from "@/lib/branding/aired-mark";

// Stable PNG icons referenced by app/manifest.ts. The Next-managed icon and
// apple-icon files use auto-hashed URLs that the manifest can't safely name, so
// these three stable routes serve the AIRED mark at the sizes the manifest
// declares. One renderer (lib/branding/aired-mark) backs every variant — the
// favicon, apple-touch, and these three — so the visual identity stays in sync.

type IconSpec = { size: number; maskable: boolean };

const ICONS: Record<string, IconSpec> = {
  "icon-192.png": { size: 192, maskable: false },
  "icon-512.png": { size: 512, maskable: false },
  "icon-512-maskable.png": { size: 512, maskable: true },
};

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(ICONS).map((name) => ({ name }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const spec = ICONS[name];
  if (!spec) {
    return new Response("Not found", { status: 404 });
  }
  return renderAiredMark(spec.size, { maskable: spec.maskable });
}
