import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Fonts for every next/og ImageResponse that can render user-supplied text
// (song / album / artist titles, contributor names, credits). Satori (next/og)
// has NO system fonts: it renders only the fonts handed to it, and it THROWS the
// moment it meets a glyph none of them cover. The bundled default is Latin-only,
// so an Arabic title ("Station Station عمر…", "كده كده song") used to 500 the
// whole renderer — and, for the share clip, kill the video ("Couldn't make the
// video").
//
// The fix: ship a Latin face (Geist, the AIRED brand font) AND an Arabic face
// (Tajawal) in the repo and hand BOTH to every ImageResponse. Satori resolves
// the font per-glyph: Latin runs render in Geist, and any glyph Geist lacks
// (Arabic, and beyond) falls back to Tajawal, so mixed Latin+Arabic titles —
// very common here — render without throwing.
//
// Why Tajawal specifically: next/og bundles an old opentype.js whose Arabic
// shaper throws "lookupType: 5 - substFormat: 3 is not yet supported" on the
// GSUB tables of several common Arabic faces (Noto Sans Arabic, Noto Naskh,
// Amiri, Scheherazade all crash it). Tajawal — a clean OFL geometric sans that
// pairs with Geist — shapes Arabic (cursive joining + diacritics) WITHOUT
// hitting that unsupported lookup. Verified by rendering the real failing titles
// (see the brief: "Station Station عمر…", "كده كده song", "Catharsis - وَالْمَّلَّاحَة").
//
// Why bundled, not fetched: a render must never depend on a network round-trip
// to a font CDN (CLAUDE.md reliability). The .ttf files live in the repo
// (src/assets/fonts) and are referenced via `new URL(..., import.meta.url)` so
// the bundler traces them into the serverless function. Static TTFs (not the
// variable font) so Satori honours the bold weights the cards lean on.

// The family the cards/clip ask for (fontFamily). Latin glyphs resolve here;
// Arabic glyphs fall back, per glyph, to the Arabic face (Tajawal) Satori also
// has loaded — no need to name Tajawal anywhere, Satori picks it by coverage.
export const OG_FONT_FAMILY = "Geist";

export type OgFontWeight = 400 | 700;
export type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight: OgFontWeight;
  style: "normal";
};

// Static string URLs (not a computed template) so webpack/Turbopack statically
// trace each asset into the function bundle.
const SOURCES: { url: URL; name: string; weight: OgFontWeight }[] = [
  {
    url: new URL("../../assets/fonts/Geist-Regular.ttf", import.meta.url),
    name: "Geist",
    weight: 400,
  },
  {
    url: new URL("../../assets/fonts/Geist-Bold.ttf", import.meta.url),
    name: "Geist",
    weight: 700,
  },
  {
    url: new URL("../../assets/fonts/Tajawal-Regular.ttf", import.meta.url),
    name: "Tajawal",
    weight: 400,
  },
  {
    url: new URL("../../assets/fonts/Tajawal-Bold.ttf", import.meta.url),
    name: "Tajawal",
    weight: 700,
  },
];

// Read once, reuse across renders in a warm function (the files never change).
let cache: OgFont[] | null = null;

export async function getOgFonts(): Promise<OgFont[]> {
  if (cache) return cache;
  const loaded = await Promise.all(
    SOURCES.map(async ({ url, name, weight }) => {
      const buf = await readFile(fileURLToPath(url));
      // A fresh ArrayBuffer slice (not the pooled Node Buffer's backing store).
      const data = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      ) as ArrayBuffer;
      return { name, data, weight, style: "normal" as const };
    }),
  );
  cache = loaded;
  return cache;
}
