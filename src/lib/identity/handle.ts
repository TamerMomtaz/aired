// The artist handle — the public slug that addresses /artist/[handle]. One per
// account, unique (profile.handle has a unique index). Pure helpers only (no
// server imports) so the first-run wizard can validate + preview a handle live in
// the browser, and the server actions can re-validate authoritatively.

export const HANDLE_MIN = 2;
export const HANDLE_MAX = 32;

// Route segments and bare words a handle must never become, so /artist/<handle>
// can never shadow another path or read as a system page.
const RESERVED = new Set([
  "admin",
  "agent",
  "aired",
  "album",
  "api",
  "artist",
  "auth",
  "cert",
  "claim",
  "edit",
  "login",
  "logout",
  "manage",
  "me",
  "new",
  "qr",
  "registry",
  "review",
  "settings",
  "signup",
  "terms",
  "upload",
  "welcome",
]);

// A bare UUID (the /artist/[id] fallback shape). A handle that matched this would
// be unreachable — the route resolves an id-shaped param as a profile id first —
// so it is rejected as a handle.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Lowercase, fold to ASCII, collapse every run of non-alphanumerics to a single
// dash, trim dashes. The same shape as the agent slugifier, tuned for handles.
export function slugifyHandle(value: string): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, HANDLE_MAX)
    .replace(/-+$/g, "");
}

// Validate an already-slugified handle. Returns a human message to show on a bad
// value, or null when it's well-formed. (Uniqueness is a separate, DB-backed
// check — see lib/identity/actions.)
export function handleError(handle: string): string | null {
  if (!handle) return "Choose a handle for your artist page.";
  if (handle.length < HANDLE_MIN) {
    return "A handle needs at least 2 characters.";
  }
  if (handle.length > HANDLE_MAX) {
    return `Keep your handle to ${HANDLE_MAX} characters or fewer.`;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle)) {
    return "Handles use lowercase letters, numbers and single dashes only.";
  }
  if (UUID_RE.test(handle) || RESERVED.has(handle)) {
    return "That handle is reserved — try another.";
  }
  return null;
}
