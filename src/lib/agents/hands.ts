// THE HANDS — the carrying human, written into the performer's ledger.
//
// The law, in code, and it holds at BOTH doors that can file a work onto an
// artist's rail: the delegated token door (src/lib/ingest/publish.ts) and the
// upload page's performer selector (src/lib/works/actions.ts). On a human's work
// the AI is a credited contributor; on a performer's own work the authorizing
// human is credited too — as the hands that carried it to shore, never as its
// author. Neither is the tool.
//
// This module exists so that credit is written the SAME way whichever door was
// used. A carried work must be indistinguishable in the ledger from any other: a
// reader looking at (&) CEE's trail should not be able to tell whether Tee typed
// the upload form or a program POSTed it, because in the only way that matters —
// who made this, and who is accountable for it being here — nothing differs.
//
// SERVER ONLY.

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveContributor } from "@/lib/agents/resolve";
import type { AgentType } from "@/lib/ledger/types";

export type HandsClient = SupabaseClient;

export type ResolveHandsResult =
  | { ok: true; agentId: string; name: string }
  | { ok: false; error: string };

// The `agent` row that credits the authorizing human.
//
// A human who has ever been credited already has an agent row linked to their
// profile; we reuse it so the hands keep ONE public page and ONE discography
// (Rule 3a) instead of sprouting a fresh identity per performer they carry. Only
// if no linked human agent exists do we find-or-create one from their artist
// name — through the SAME resolver the editor uses, so it lands on their
// canonical row if the name is already known.
//
// The row must be type `human`: the volley below is declared origin HUMAN, and
// enforce_volley_origin refuses HUMAN on an ai_model contributor. That is the
// point — a human carried this, and the trail may not say otherwise.
export async function resolveHandsAgent(
  supabase: HandsClient,
  humanProfileId: string,
  humanName: string,
): Promise<ResolveHandsResult> {
  const { data: linkedRows } = await supabase
    .from("agent")
    .select("id, name, type")
    .eq("profile_id", humanProfileId)
    .order("created_at", { ascending: true });
  const linked = (
    (linkedRows ?? []) as Array<{ id: string; name: string; type: AgentType }>
  ).find((a) => a.type === "human");
  if (linked) {
    return { ok: true, agentId: linked.id, name: linked.name };
  }

  const name = humanName.trim();
  if (!name) {
    return {
      ok: false,
      error:
        "The authorizing human has no artist name yet, so they cannot be credited as the hands — set a display name on that profile first.",
    };
  }
  const resolved = await resolveContributor(supabase, { name, type: "human" });
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }
  return { ok: true, agentId: resolved.agent.id, name: resolved.agent.name };
}

/**
 * The sealed rationale on the hands volley. It states what happened and refuses
 * the two lies available to it: it never claims authorship, and it never claims
 * a door that wasn't used. `tokenLabel` is the delegated token's label, or null
 * when a human filed the work by hand at the upload page.
 */
export function handsVolleyRationale(input: {
  handsName: string;
  performerName: string;
  tokenLabel?: string | null;
}): string {
  const { handsName, performerName, tokenLabel } = input;
  const how = tokenLabel
    ? `under the delegated token "${tokenLabel}"`
    : "by hand at the AIRED upload page";
  return `Carried to shore by ${handsName} for ${performerName}, ${how}. Published on ${handsName}'s authority — not authored by them.`;
}
