// Sealing the craft — SERVER ONLY (CLAUDE.md Rule 1, Phase 2 LOCKED DECISIONS).
//
// Option A: server-sealed. We encrypt the private_volley craft at the
// application layer, in the Node.js runtime, with AES-256-GCM. The key lives in
// env var AIRED_VOLLEY_ENC_KEY (base64, 32 bytes) and NEVER reaches the browser.
// Importing `node:crypto` keeps this module off client bundles — never import it
// into a Client Component.
//
// creator_key_ref records the scheme and is the upgrade seam to Option B
// (client-sealed, creator-passphrase-derived key) with no schema change.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export type Craft = {
  prompt: string;
  style_reference_raw: string;
  rejected_branches: string;
  rationale: string;
};

export const CREATOR_KEY_REF = "server:aes-256-gcm:v1";

// Canonical plaintext: JSON of the four craft fields with sorted keys, UTF-8.
// Deterministic, so the creator can later re-derive the same hash from decrypted
// content and prove the sealed trail matches the public skeleton.
export function canonicalCraft(craft: Craft): string {
  const obj: Record<string, string> = {
    prompt: craft.prompt ?? "",
    style_reference_raw: craft.style_reference_raw ?? "",
    rejected_branches: craft.rejected_branches ?? "",
    rationale: craft.rationale ?? "",
  };
  const sorted = Object.keys(obj)
    .sort()
    .reduce<Record<string, string>>((acc, key) => {
      acc[key] = obj[key];
      return acc;
    }, {});
  return JSON.stringify(sorted);
}

// hex SHA-256 of the canonical plaintext → public_volley.private_hash.
export function provenanceHash(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function loadKey(): Buffer {
  const b64 = process.env.AIRED_VOLLEY_ENC_KEY;
  if (!b64) {
    throw new Error(
      "AIRED_VOLLEY_ENC_KEY is not set. Generate one with `openssl rand -base64 32` and set it as a server-only env var (locally in .env.local and in Vercel).",
    );
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error(
      `AIRED_VOLLEY_ENC_KEY must decode to 32 bytes (got ${key.length}). Generate one with \`openssl rand -base64 32\`.`,
    );
  }
  return key;
}

// Seal plaintext → base64(iv ‖ authTag ‖ ciphertext). Per-row random 12-byte IV.
export function sealCraft(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag(); // 16 bytes
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

// Inverse of sealCraft. private_volley is never served; this exists for the
// creator-side "prove authorship on demand" path and for round-trip tests.
export function openCraft(packed: string): string {
  const key = loadKey();
  const buf = Buffer.from(packed, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
