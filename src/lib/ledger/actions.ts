"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { Craft } from "./seal";
import {
  DELTA_TYPES,
  VOLLEY_ORIGINS,
  VOLLEY_ROLES,
  type DeltaType,
  type VolleyOrigin,
  type VolleyRole,
} from "./types";
import { writeVolley, type WriteVolleySanitized } from "./write";

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
  | { ok: true; sanitized: WriteVolleySanitized }
  | { ok: false; error: string };

// Declare one volley from the EDITOR — the creator's own hands, in their own
// session (Phase 2 brief part 2). The sanitize → hash → seal → atomic paired
// write sequence lives in ./write (writeVolley), shared with the delegated
// ingest door so both doors write the same ledger the same way. This action adds
// what only a session can: the signed-in user check (RLS then scopes the write to
// them, since declare_volley is SECURITY INVOKER) and the cache revalidation.
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

  const result = await writeVolley(supabase, input);
  if (!result.ok) {
    return result;
  }

  revalidatePath(`/registry/${input.workId}`);
  revalidatePath("/registry");
  return result;
}

export type EditVolleyInput = {
  volleyId: string;
  workId: number;
  role: VolleyRole;
  origin: VolleyOrigin;
  deltaType: DeltaType;
};

export type EditVolleyResult = { ok: true } | { ok: false; error: string };

// Correct the PUBLIC SHAPE of an existing volley — role / origin / delta_type.
// These are skeleton fields only: they are NOT part of the sealed craft and
// never feed provenanceHash(), so editing them leaves private_volley and its
// private_hash untouched — no re-seal, the Red Line stays intact (a mislabel is
// a five-second fix, never "start over"). RLS (public_volley_owner_upd) scopes
// the write to the work's owner; the enforce_volley_origin trigger is the
// structural backstop against an origin that contradicts the contributor type.
export async function editVolley(
  input: EditVolleyInput,
): Promise<EditVolleyResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Sign in to edit a volley." };
  }

  // Validate the shape vocabulary (reachable via direct POST).
  if (!(VOLLEY_ROLES as readonly string[]).includes(input.role)) {
    return { ok: false, error: "Unknown role." };
  }
  if (!(VOLLEY_ORIGINS as readonly string[]).includes(input.origin)) {
    return { ok: false, error: "Unknown origin." };
  }
  if (!(DELTA_TYPES as readonly string[]).includes(input.deltaType)) {
    return { ok: false, error: "Unknown delta type." };
  }

  // Skeleton-only update. agent_id, work_id, seq, private_hash and the sealed
  // twin are never touched here.
  const { data, error } = await supabase
    .from("public_volley")
    .update({
      role: input.role,
      origin: input.origin,
      delta_type: input.deltaType,
    })
    .eq("id", input.volleyId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data) {
    // RLS returned no row: not the work's owner, or the volley is gone.
    return { ok: false, error: "You can only edit volleys on your own work." };
  }

  revalidatePath(`/registry/${input.workId}`);
  revalidatePath("/registry");
  return { ok: true };
}
