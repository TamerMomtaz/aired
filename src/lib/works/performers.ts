// WHOM MAY I CARRY? — the read side of performer authority.
//
// An AI performer is an artist here: their own profile, their own rail, their own
// catalog (see the (&) CEE migration). The one thing they are not is an account —
// they never sign in, so a work can only reach their rail through a human who is
// authorized to carry them. That authorization is a row in `performer_authority`,
// granted by the platform, not a capability anyone can hand themselves.
//
// This module answers one question for the upload page: which artists may THIS
// signed-in human file a work under? The honest answer for almost everyone is
// "none", and the page then looks exactly as it does today.
//
// The list is not a security boundary — it shapes a dropdown. The boundary is the
// `work_owner_ins` RLS policy and the `enforce_publish_honesty` trigger, both of
// which re-ask the same question inside the database on every insert. Hiding a
// control is UX; refusing a write is the gate.

import { artistName } from "@/lib/albums/public-queries";
import { AGENT_TYPE_LABELS, type AgentType } from "@/lib/ledger/types";
import { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type CarriedPerformer = {
  /** The performer's profile id — this becomes work.creator_id. */
  profileId: string;
  /** Their public artist name, exactly as the rail shows it (Rule 3a). */
  name: string;
  /** Their page at /artist/<handle>, when they have claimed a handle. */
  handle: string | null;
  /**
   * What KIND of artist they are, in the platform's own words — read from the
   * `agent` row linked to their profile, which is the only place that fact is
   * recorded. (&) CEE is `ai_model`, so this reads "Art Intelligence"; a human
   * artist reads "Human"; a performer with no linked agent row reads null and
   * gets no chip rather than an invented one.
   */
  kindLabel: string | null;
};

type GrantRow = { performer_id: string };
type ProfileRow = { id: string; display_name: string | null; handle: string | null };
type AgentRow = { profile_id: string; type: AgentType };

/**
 * The performers this human is authorized to carry, by name, ready for a select.
 * Empty for every user without a grant — which is everyone but the authorizing
 * humans the platform has explicitly vouched for.
 */
export async function getCarriedPerformers(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<CarriedPerformer[]> {
  // RLS on performer_authority already scopes SELECT to your own grants; the
  // explicit filter says the same thing in the query, so a policy change can
  // never silently widen what this page offers.
  const { data: grantData } = await supabase
    .from("performer_authority")
    .select("performer_id")
    .eq("human_id", userId);
  const performerIds = ((grantData ?? []) as GrantRow[]).map(
    (g) => g.performer_id,
  );
  if (performerIds.length === 0) return [];

  const [{ data: profileData }, { data: agentData }] = await Promise.all([
    supabase
      .from("profile")
      .select("id, display_name, handle")
      .in("id", performerIds),
    supabase.from("agent").select("profile_id, type").in("profile_id", performerIds),
  ]);

  const kindByProfile = new Map<string, AgentType>();
  for (const a of (agentData ?? []) as AgentRow[]) {
    if (a.profile_id && !kindByProfile.has(a.profile_id)) {
      kindByProfile.set(a.profile_id, a.type);
    }
  }

  return ((profileData ?? []) as ProfileRow[])
    .map((p) => {
      const kind = kindByProfile.get(p.id);
      return {
        profileId: p.id,
        name: artistName(p.display_name),
        handle: p.handle?.trim() || null,
        kindLabel: kind ? AGENT_TYPE_LABELS[kind] : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * True when this human holds the authority to file works under this performer.
 * The server-side gate the upload action runs BEFORE any write, so an
 * unauthorized crafted request is refused with a sentence rather than a raw
 * database exception — and refused identically whether or not the UI ever
 * rendered a selector for them.
 */
export async function carriesPerformer(
  supabase: SupabaseServerClient,
  userId: string,
  performerId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("performer_authority")
    .select("performer_id")
    .eq("human_id", userId)
    .eq("performer_id", performerId)
    .maybeSingle();
  return !!data;
}
