// Delegated human authority — the token side of the honest wheelbarrow.
//
// A program never publishes on its own behalf. It presents a service token, and
// that token resolves to the HUMAN who authorized it. Everything downstream
// (work.published_by_authority, the visible Manage label, the honesty trigger)
// is built on the mapping this module performs. If a token cannot be resolved to
// a named human authority, nothing is written at all.
//
// SERVER ONLY. Secrets live in env vars (CLAUDE.md §1.7) and never appear in a
// response body, a log line, or an error message — including the token the
// caller presented, which is treated as sensitive even when it is wrong.

import { createHash, timingSafeEqual } from "node:crypto";

export type DelegatedAuthority = {
  /** The human (profile.id) whose authority this token carries. */
  authorityUserId: string;
  /** Human-readable label of the token used — written to the ledger, never the secret. */
  label: string;
};

type TokenRecord = DelegatedAuthority & {
  /** SHA-256 of the token secret. Only ever the hash — never the secret itself. */
  digest: Buffer;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

// Read the configured token set. Two shapes, both env-only:
//
//   1. AIRED_INGEST_TOKENS — a JSON array of named tokens, each storing ONLY a
//      hash of its secret, so several future Si performers can each roll under a
//      clearly-labelled human authority:
//        [{"label":"cee-wheelbarrow","authority":"<profile uuid>","sha256":"<hex>"}]
//      Generate a hash with:  printf %s "$TOKEN" | shasum -a 256
//
//   2. AIRED_INGEST_SECRET (+ AIRED_INGEST_AUTHORITY) — the single-token path
//      named in the brief. The raw secret is hashed here at read time, so the
//      comparison path is identical to (1) and no code ever compares raw
//      secrets.
//
// Parsed per request on purpose: the set is tiny, env is immutable per
// deployment, and a memo would only add a stale-state failure mode in dev.
// Malformed entries are skipped with a log line that names the LABEL only.
function loadTokens(): TokenRecord[] {
  const records: TokenRecord[] = [];

  const raw = process.env.AIRED_INGEST_TOKENS?.trim();
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error(
        "[ingest-auth] AIRED_INGEST_TOKENS is not valid JSON — no named tokens loaded.",
      );
      parsed = null;
    }
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (!entry || typeof entry !== "object") continue;
        const e = entry as Record<string, unknown>;
        const label = typeof e.label === "string" ? e.label.trim() : "";
        const authority =
          typeof e.authority === "string" ? e.authority.trim() : "";
        const hex = typeof e.sha256 === "string" ? e.sha256.trim() : "";
        if (!label || !UUID_RE.test(authority) || !SHA256_HEX_RE.test(hex)) {
          console.error(
            `[ingest-auth] skipping malformed AIRED_INGEST_TOKENS entry (label=${label || "?"}) — need label, authority uuid, and sha256 hex.`,
          );
          continue;
        }
        records.push({
          authorityUserId: authority,
          label,
          digest: Buffer.from(hex, "hex"),
        });
      }
    }
  }

  const secret = process.env.AIRED_INGEST_SECRET?.trim();
  const authority = process.env.AIRED_INGEST_AUTHORITY?.trim();
  if (secret) {
    if (UUID_RE.test(authority ?? "")) {
      records.push({
        authorityUserId: authority as string,
        // Naming the env var that authorized it is the most useful default the
        // ledger can carry when no explicit label was configured.
        label:
          process.env.AIRED_INGEST_TOKEN_LABEL?.trim() || "aired-ingest-secret",
        digest: sha256(secret),
      });
    } else {
      console.error(
        "[ingest-auth] AIRED_INGEST_SECRET is set but AIRED_INGEST_AUTHORITY is missing or not a uuid — the token cannot name a human authority, so it is refused.",
      );
    }
  }

  return records;
}

/** True when at least one usable delegated token is configured. */
export function ingestConfigured(): boolean {
  return loadTokens().length > 0;
}

// Pull the bearer token out of an Authorization header. Returns null for a
// missing, blank, or non-Bearer header — the caller answers a generic 401 either
// way, so no shape detail ever leaks back to the client.
export function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer[ \t]+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

// Resolve a presented token → the human authority it carries, or null.
//
// Constant-time: the presented token is hashed to a fixed 32 bytes and compared
// with timingSafeEqual against every configured digest — no `===`, no length
// leak, and no early exit, so the time taken reveals neither which token matched
// nor how far a wrong guess got.
export function resolveIngestToken(
  presented: string,
): DelegatedAuthority | null {
  const token = presented?.trim();
  if (!token) return null;

  const digest = sha256(token);
  const records = loadTokens();

  let matched: TokenRecord | null = null;
  for (const record of records) {
    // Digests are always 32 bytes, so timingSafeEqual can never throw here.
    if (timingSafeEqual(digest, record.digest)) {
      matched = record;
    }
  }
  if (!matched) return null;

  return { authorityUserId: matched.authorityUserId, label: matched.label };
}
