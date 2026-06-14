"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
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

export type DeclareVolleyInput = {
  workId: number;
  seq: number;
  agentId: string;
  role: VolleyRole;
  origin: VolleyOrigin;
  deltaType: DeltaType;
  craft: Craft;
};

export type DeclareVolleyResult =
  | {
      ok: true;
      sanitized: {
        matched: boolean;
        unknownReference: boolean;
        descriptors: string[];
      };
    }
  | { ok: false; error: string };

// Declare one volley: seal the craft and write the paired private + public rows
// atomically (Phase 2 brief part 2). Order: sanitize → hash → encrypt → one
// atomic RPC that inserts private_volley + public_volley (+ merges descriptors)
// in a single transaction. If anything fails, nothing is written.
export async function declareVolley(
  input: DeclareVolleyInput,
): Promise<DeclareVolleyResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Sign in to declare a volley." };
  }

  // Validate the shape vocabulary (these are reachable via direct POST).
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

  // One atomic transaction (SECURITY INVOKER → RLS scopes it to the owner).
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

  revalidatePath(`/registry/${input.workId}`);
  revalidatePath("/registry");
  return {
    ok: true,
    sanitized: {
      matched: sanitized.matched,
      unknownReference: sanitized.unknownReference,
      descriptors: publicDescriptors,
    },
  };
}
