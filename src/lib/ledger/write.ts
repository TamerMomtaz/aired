// ONE ledger writer, two doors.
//
// Declaring a volley is the same act whether a creator does it by hand in the
// editor or a program carries a finished work through the delegated ingest door:
// sanitize the reference → hash the canonical craft → seal it → write the paired
// private + public rows in one atomic RPC. That sequence lives HERE, so both
// doors run the identical code. The wheelbarrow is a new door, not a new ledger.
//
// The only difference between callers is the Supabase client they hand in:
//   • the editor passes the session-bound client, so RLS scopes the write to the
//     signed-in owner (declare_volley is SECURITY INVOKER);
//   • the ingest route passes the service client, having already resolved the
//     delegated token to the human authority that owns the work — and the
//     enforce_volley_origin trigger still fires, because triggers fire for every
//     writer.
//
// SERVER ONLY — it imports ./seal, which reads the encryption key.

import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeReference } from "./sanitizeReference";
import {
  canonicalCraft,
  CREATOR_KEY_REF,
  provenanceHash,
  sealCraft,
  type Craft,
} from "./seal";
import {
  DELTA_TYPES,
  VOLLEY_ORIGINS,
  VOLLEY_ROLES,
  type DeltaType,
  type VolleyOrigin,
  type VolleyRole,
} from "./types";

// Either Supabase client shape writes the ledger identically.
export type LedgerClient = SupabaseClient;

export type WriteVolleyInput = {
  workId: number;
  seq: number;
  agentId: string;
  role: VolleyRole;
  origin: VolleyOrigin;
  deltaType: DeltaType;
  craft: Craft;
};

export type WriteVolleySanitized = {
  matched: boolean;
  unknownReference: boolean;
  descriptors: string[];
};

export type WriteVolleyResult =
  | { ok: true; sanitized: WriteVolleySanitized }
  | { ok: false; error: string };

export async function writeVolley(
  supabase: LedgerClient,
  input: WriteVolleyInput,
): Promise<WriteVolleyResult> {
  // Validate the shape vocabulary. Both doors are reachable by a direct POST, so
  // this runs server-side regardless of what the caller sent.
  if (!(VOLLEY_ROLES as readonly string[]).includes(input.role)) {
    return { ok: false, error: "Unknown role." };
  }
  if (!(VOLLEY_ORIGINS as readonly string[]).includes(input.origin)) {
    return { ok: false, error: "Unknown origin." };
  }
  if (!(DELTA_TYPES as readonly string[]).includes(input.deltaType)) {
    return { ok: false, error: "Unknown delta type." };
  }
  if (!input.agentId) {
    return { ok: false, error: "Credit a contributor for this volley." };
  }
  if (!Number.isFinite(input.seq)) {
    return { ok: false, error: "Enter a sequence number (e.g. 0, 1, 1.5)." };
  }

  // Reference-sanitizer at the boundary, BEFORE any public write. The server
  // re-runs it regardless of what the client sent — names never reach public.
  const sanitized = sanitizeReference(input.craft.style_reference_raw ?? "");

  // Seal the verbatim craft. The RAW style reference is sealed; only sanitized
  // descriptors (never a name) are eligible for the public descriptor set.
  const craft: Craft = {
    prompt: input.craft.prompt ?? "",
    style_reference_raw: input.craft.style_reference_raw ?? "",
    rejected_branches: input.craft.rejected_branches ?? "",
    rationale: input.craft.rationale ?? "",
  };

  let ciphertext: string;
  let privateHash: string;
  try {
    const canonical = canonicalCraft(craft);
    privateHash = provenanceHash(canonical);
    ciphertext = sealCraft(canonical);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to seal the craft.",
    };
  }

  const publicDescriptors = sanitized.unknownReference
    ? []
    : sanitized.descriptors;

  // One atomic transaction: private_volley + public_volley (+ the descriptor
  // merge) land together, or nothing does.
  const { error } = await supabase.rpc("declare_volley", {
    p_work_id: input.workId,
    p_seq: input.seq,
    p_agent_id: input.agentId,
    p_role: input.role,
    p_origin: input.origin,
    p_delta_type: input.deltaType,
    p_private_hash: privateHash,
    p_ciphertext: ciphertext,
    p_creator_key_ref: CREATOR_KEY_REF,
    p_public_descriptors: publicDescriptors,
  });
  if (error) {
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    sanitized: {
      matched: sanitized.matched,
      unknownReference: sanitized.unknownReference,
      descriptors: publicDescriptors,
    },
  };
}
