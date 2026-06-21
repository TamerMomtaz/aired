// Parse an HLS playlist (.m3u8) into the absolute URLs it references.
//
// AIRED's worker emits a single VOD media playlist with bare segment filenames
// ("segment_00000.ts") and no master/variant layer — see worker/src/ffmpeg.js —
// so the common path is simply "resolve each non-comment line against the
// playlist URL". One level of master → variant nesting is handled defensively in
// case the packaging ever changes.

export type ParsedPlaylist = { variants: string[]; segments: string[] };

export function parsePlaylist(text: string, baseUrl: string): ParsedPlaylist {
  const variants: string[] = [];
  const segments: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue; // tags + blank lines
    let abs: string;
    try {
      abs = new URL(line, baseUrl).toString();
    } catch {
      continue; // an unparseable URI line — skip it
    }
    if (/\.m3u8($|\?)/i.test(line)) variants.push(abs);
    else segments.push(abs);
  }
  return { variants, segments };
}

export type FetchText = (url: string) => Promise<string>;

// Resolve a playlist URL to the manifest(s) + ordered segment URLs to cache. For
// a master playlist (no direct segments) we follow the first variant — AIRED is
// single-rendition, so there is only ever one.
export async function enumerateSegments(
  manifestUrl: string,
  fetchText: FetchText,
): Promise<{ manifests: string[]; segments: string[] }> {
  const root = parsePlaylist(await fetchText(manifestUrl), manifestUrl);
  if (root.segments.length > 0 || root.variants.length === 0) {
    return { manifests: [manifestUrl], segments: root.segments };
  }
  const variantUrl = root.variants[0];
  const variant = parsePlaylist(await fetchText(variantUrl), variantUrl);
  return { manifests: [manifestUrl, variantUrl], segments: variant.segments };
}
