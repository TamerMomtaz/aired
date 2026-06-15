"use server";

import { revalidatePath } from "next/cache";

import { AGENT_TYPES, type AgentType } from "@/lib/ledger/types";
import { createClient } from "@/lib/supabase/server";

// Contributor identity is always public and celebrated (CLAUDE.md §3a). These
// actions create `agent` rows — the people and silicon that actually made a
// track. They are NOT style references; they are never anonymized.

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "agent"
  );
}

// Same display name modulo case + internal whitespace = same person. Names are
// the platform's search/follow engine (CLAUDE.md §3a); a duplicate row would
// fracture a contributor's discography.
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// Find a free profile_slug derived from `base`, appending -2, -3… on collision.
async function uniqueSlug(
  supabase: Awaited<ReturnType<typeof createClient>>,
  base: string,
): Promise<string> {
  let slug = base;
  for (let i = 0; i < 50; i++) {
    const { data } = await supabase
      .from("agent")
      .select("id")
      .eq("profile_slug", slug)
      .maybeSingle();
    if (!data) return slug;
    slug = `${base}-${i + 2}`;
  }
  // Extremely unlikely; fall back to a random suffix.
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

export type ContributorSummary = {
  id: string;
  name: string;
  type: AgentType;
  profile_slug: string | null;
};

// Look up an existing agent that shares an effective identity with `name`.
// First by the derived slug (catches case + punctuation + whitespace
// collisions like "AISong.org" → "aisong-org"), then by a case-insensitive
// name match. RLS (`agent_read_all`) lets us SELECT every agent regardless
// of who owns the row.
async function findExistingAgent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  name: string,
): Promise<ContributorSummary | null> {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  const normalized = normalizeName(trimmed);
  const slug = slugify(trimmed);

  const { data: bySlug } = await supabase
    .from("agent")
    .select("id, name, type, profile_slug")
    .eq("profile_slug", slug)
    .maybeSingle();
  if (bySlug) {
    return {
      id: bySlug.id,
      name: bySlug.name,
      type: bySlug.type as AgentType,
      profile_slug: bySlug.profile_slug,
    };
  }

  // .ilike with the literal trimmed name is an exact case-insensitive match
  // (no wildcards). It does not fold internal whitespace, so re-verify in JS
  // against the normalizer — that is the source of truth.
  const { data: byName } = await supabase
    .from("agent")
    .select("id, name, type, profile_slug")
    .ilike("name", trimmed)
    .limit(20);
  const match = (byName ?? []).find(
    (a) => normalizeName(a.name ?? "") === normalized,
  );
  if (!match) return null;
  return {
    id: match.id,
    name: match.name,
    type: match.type as AgentType,
    profile_slug: match.profile_slug,
  };
}

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

  const slug = await uniqueSlug(supabase, slugify(input.slug?.trim() || name));

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
// collaborator (an AI model/voice) or a tool. Created unlinked (profile_id null)
// and public, so it earns its own page and discography.
//
// Find-or-create: a contributor's name anchors their identity (CLAUDE.md §3a —
// names are the platform's search/follow engine). A second row for the same
// person — even if the picker was on a different type, or the typing varied in
// case or whitespace — fractures their discography. If a match exists we return
// it as-is, including its existing type and any pre-existing claim
// (profile_id), and the ledger links to the canonical row.
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

  const name = (input.name ?? "").trim();
  if (!name) {
    return { ok: false, error: "Name the contributor." };
  }
  const type: AgentType = (AGENT_TYPES as readonly string[]).includes(input.type)
    ? input.type
    : "tool";

  const existing = await findExistingAgent(supabase, name);
  if (existing) {
    return { ok: true, agent: existing };
  }

  const slug = await uniqueSlug(supabase, slugify(name));

  const { data, error } = await supabase
    .from("agent")
    .insert({
      type,
      name,
      version: input.version?.trim() || null,
      profile_slug: slug,
      profile_id: null,
    })
    .select("id, name, type, profile_slug")
    .single();
  if (error || !data) {
    // A concurrent insert may have raced ahead of us and won the unique
    // index. Re-resolve to the now-existing canonical row instead of
    // surfacing the raw DB error.
    const raced = await findExistingAgent(supabase, name);
    if (raced) {
      return { ok: true, agent: raced };
    }
    return { ok: false, error: error?.message ?? "Couldn't add contributor." };
  }

  revalidatePath("/registry");
  return {
    ok: true,
    agent: {
      id: data.id,
      name: data.name,
      type: data.type as AgentType,
      profile_slug: data.profile_slug,
    },
  };
}
