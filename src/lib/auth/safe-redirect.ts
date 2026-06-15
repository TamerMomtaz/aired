// Only ever redirect to a path on our own site. `next` arrives from a query
// string (email links, OAuth state), so an attacker could try `//evil.com` or
// `https://evil.com`. Accept a single-slash absolute path and nothing else.
export function safeNext(
  next: string | null | undefined,
  fallback = "/",
): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  return next;
}
