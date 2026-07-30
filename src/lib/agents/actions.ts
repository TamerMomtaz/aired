"use server";

import { revalidatePath } from "next/cache";

import { type AgentType } from "@/lib/ledger/types";
import { createClient } from "@/lib/supabase/server";
import {
  resolveContributor,
  slugifyAgentName,
  uniqueAgentSlug,
  type ContributorSummary,
} from "./resolve";

// Contributor identity is always public and celebrated (CLAUDE.md §3a). These
// actions create `agent` rows — the people and silicon that actually made a
// track. They are NOT style references; they are never anonymized.
//
// The name → row resolution itself lives in ./resolve, shared with the delegated
// ingest door so both doors reach the same canonical contributor row.

export type { ContributorSummary };

export type ClaimNameInput = { name: string; slug?: string; bio?: string };
export type ClaimNameResult =
  | { ok: true; slug: string }
  | { ok: false; error: string };

// "Claim your name": create the creator's own human agent, linked to their
// profile, with a searchable, followable page.
export async function claimName(
  input: ClaimNameInput,
): Promise<ClaimNameResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Sign in to claim your name." };
  }

  const name = (input.name ?? "").trim();
  if (!name) {
    return { ok: false, error: "Enter the name you want to claim." };
  }

  const slug = await uniqueAgentSlug(
    supabase,
    slugifyAgentName(input.slug?.trim() || name),
  );

  // RLS (agent_auth_ins) only permits profile_id = auth.uid() for a linked row.
  const { error } = await supabase.from("agent").insert({
    type: "human" satisfies AgentType,
    name,
    profile_slug: slug,
    bio: input.bio?.trim() || null,
    profile_id: user.id,
  });
  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/registry");
  revalidatePath(`/agent/${slug}`);
  return { ok: true, slug };
}

export type CreateContributorInput = {
  name: string;
  type: AgentType;
  version?: string;
};
export type CreateContributorResult =
  | { ok: true; agent: ContributorSummary }
  | { ok: false; error: string };

// Add a contributor that isn't a human account on this platform — a silicon
// collaborator (an AI model/voice) or a tool — from the ledger editor. The
// find-or-create resolution is resolveContributor (./resolve), shared with the
// delegated ingest door: a contributor's name anchors their identity (CLAUDE.md
// §3a — names are the platform's search/follow engine), so the same name always
// resolves to the same canonical row rather than fracturing a discography.
export async function createContributor(
  input: CreateContributorInput,
): Promise<CreateContributorResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Sign in first." };
  }

  const result = await resolveContributor(supabase, input);
  if (!result.ok) {
    return result;
  }

  revalidatePath("/registry");
  return result;
}
