// Normalize a stored descriptor set into clean, individually-delimited tokens for
// display. Mirrors the `declare_volley` RPC merge (Phase 3 polish): split every
// element on commas, trim, drop blanks, and de-duplicate with first-seen order
// preserved. So a legacy run-on value that still carries commas renders as
// separate chips instead of one long string, and duplicate tokens never collide
// as React keys. Anything that isn't an array of strings yields an empty list.
export function normalizeDescriptors(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const element of raw) {
    if (typeof element !== "string") continue;
    for (const part of element.split(",")) {
      const token = part.trim();
      if (!token || seen.has(token)) continue;
      seen.add(token);
      tokens.push(token);
    }
  }
  return tokens;
}
