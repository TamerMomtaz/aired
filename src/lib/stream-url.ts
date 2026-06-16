// Audio is served only from R2 via CDN (CLAUDE.md Rule 6). The public base lives
// in an env var so the later cdn.ai-red.io swap needs no code change. NEXT_PUBLIC_
// is inlined at build time, so changing it in Vercel requires a redeploy to take
// effect. Shared by the global player engine and the Red Line view so the join
// logic lives in exactly one place.
export const R2_BASE = (process.env.NEXT_PUBLIC_R2_PUBLIC_BASE ?? "").replace(
  /\/+$/,
  "",
);

// Join the public base and the playlist key with exactly one slash.
export function buildStreamUrl(key: string | null | undefined): string | null {
  if (!key || !key.trim()) return null;
  if (!R2_BASE) return null;
  return `${R2_BASE}/${key.trim().replace(/^\/+/, "")}`;
}
