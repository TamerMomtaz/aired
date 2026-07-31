// Delegated grants — the token side of the honest wheelbarrow.
//
// A program never publishes on its own behalf. It presents a service token, and
// that token resolves to TWO named profiles, which is the whole of reciprocal
// provenance in one line:
//
//   this HUMAN authorizes  ·  this PERFORMER is the artist
//
// The performer gets the work on their own rail (work.creator_id); the human is
// recorded as the hands that carried it (work.published_by_authority) and is
// credited as such in the performer's ledger. Everything downstream — the
// placement, the visible Manage label, the honesty trigger — is built on the
// mapping this module performs. If a token cannot be resolved to a named human
// authority, nothing is written at all.
//
// A token that names no performer speaks for the human alone: performer =
// authority, which is a human running their own automation over their own
// catalog. That is the honest reading of an unnamed performer, and it keeps
// every token configured before performers existed behaving exactly as it did.
//
// SERVER ONLY. Secrets live in env vars (CLAUDE.md §1.7) and never appear in a
// response body, a log line, or an error message — including the token the
// caller presented, which is treated as sensitive even when it is wrong.

import { createHash, timingSafeEqual } from "node:crypto";

export type DelegatedGrant = {
  /** The human (profile.id) whose authority this token carries — the hands. */
  authorityProfileId: string;
  /**
   * The artist (profile.id) the work is filed under — the credited performer.
   * Equal to the authority when the token names no separate performer.
   */
  performerProfileId: string;
  /** Human-readable label of the token used — written to the ledger, never the secret. */
  label: string;
};

type TokenRecord = DelegatedGrant & {
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
//      hash of its secret, so each Si performer rolls under a clearly-labelled
//      human authority and onto their own rail:
//        [{"label":"cee-wheelbarrow","authority":"<human profile uuid>",
//          "performer":"<performer profile uuid>","sha256":"<hex>"}]
//      `performer` is optional; omitted, it means the human is publishing their
//      own work. Generate a hash with:  printf %s "$TOKEN" | shasum -a 256
//
//   2. AIRED_INGEST_SECRET (+ AIRED_INGEST_AUTHORITY, optional
//      AIRED_INGEST_PERFORMER) — the single-token path named in the brief. The
//      raw secret is hashed here at read time, so the comparison path is
//      identical to (1) and no code ever compares raw secrets.
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
        // A performer is optional, but a MALFORMED one is refused rather than
        // quietly falling back to the authority: that would silently file a
        // performer's work onto the human's rail — the exact mistake this
        // field exists to prevent.
        const performerRaw =
          typeof e.performer === "string" ? e.performer.trim() : "";
        if (performerRaw && !UUID_RE.test(performerRaw)) {
          console.error(
            `[ingest-auth] skipping AIRED_INGEST_TOKENS entry (label=${label}) — performer must be a profile uuid.`,
          );
          continue;
        }
        records.push({
          authorityProfileId: authority,
          performerProfileId: performerRaw || authority,
          label,
          digest: Buffer.from(hex, "hex"),
        });
      }
    }
  }

  const secret = process.env.AIRED_INGEST_SECRET?.trim();
  const authority = process.env.AIRED_INGEST_AUTHORITY?.trim();
  const performer = process.env.AIRED_INGEST_PERFORMER?.trim();
  if (secret) {
    if (!UUID_RE.test(authority ?? "")) {
      console.error(
        "[ingest-auth] AIRED_INGEST_SECRET is set but AIRED_INGEST_AUTHORITY is missing or not a uuid — the token cannot name a human authority, so it is refused.",
      );
    } else if (performer && !UUID_RE.test(performer)) {
      // Same discipline as the multi-token path: a malformed performer is
      // refused, never silently collapsed onto the authority's rail.
      console.error(
        "[ingest-auth] AIRED_INGEST_PERFORMER is set but is not a profile uuid — the token cannot name the artist it speaks for, so it is refused.",
      );
    } else {
      records.push({
        authorityProfileId: authority as string,
        performerProfileId: performer || (authority as string),
        // Naming the env var that authorized it is the most useful default the
        // ledger can carry when no explicit label was configured.
        label:
          process.env.AIRED_INGEST_TOKEN_LABEL?.trim() || "aired-ingest-secret",
        digest: sha256(secret),
      });
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

// Resolve a presented token → the grant it carries (the authorizing human and
// the performer they authorize it for), or null.
//
// Constant-time: the presented token is hashed to a fixed 32 bytes and compared
// with timingSafeEqual against every configured digest — no `===`, no length
// leak, and no early exit, so the time taken reveals neither which token matched
// nor how far a wrong guess got.
export function resolveIngestToken(
  presented: string,
): DelegatedGrant | null {
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

  return {
    authorityProfileId: matched.authorityProfileId,
    performerProfileId: matched.performerProfileId,
    label: matched.label,
  };
}
