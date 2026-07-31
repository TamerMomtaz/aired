// Contributor identity resolution — shared by both doors.
//
// Contributor identity is always public and celebrated (CLAUDE.md Rule 3a):
// `agent` holds WHO MADE IT, searchable and followable, carbon and silicon
// alike. A contributor's NAME anchors that identity, so resolving a name to a
// row is find-or-create, never create-blindly: a second row for the same maker
// fractures their discography and breaks the platform's growth mechanic.
//
// This module holds the resolution itself so the editor's Server Action and the
// delegated ingest route reach the SAME canonical row for the same name — one
// contributor, one page, one discography, whichever door the work came through.
// (These names are never style references; they are never anonymized.)

import type { SupabaseClient } from "@supabase/supabase-js";

import { AGENT_TYPES, type AgentType } from "@/lib/ledger/types";

export type AgentClient = SupabaseClient;

export type ContributorSummary = {
  id: string;
  name: string;
  type: AgentType;
  profile_slug: string | null;
};

export function slugifyAgentName(value: string): string {
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
export function normalizeAgentName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// Find a free profile_slug derived from `base`, appending -2, -3… on collision.
export async function uniqueAgentSlug(
  supabase: AgentClient,
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

// Look up an existing agent that shares an effective identity with `name`.
// First by the derived slug (catches case + punctuation + whitespace collisions
// like "AISong.org" → "aisong-org"), then by a case-insensitive name match. RLS
// (`agent_read_all`) lets us SELECT every agent regardless of who owns the row.
export async function findExistingAgent(
  supabase: AgentClient,
  name: string,
): Promise<ContributorSummary | null> {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  const normalized = normalizeAgentName(trimmed);
  const slug = slugifyAgentName(trimmed);

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
  const match = ((byName ?? []) as ContributorSummary[]).find(
    (a) => normalizeAgentName(a.name ?? "") === normalized,
  );
  if (!match) return null;
  return {
    id: match.id,
    name: match.name,
    type: match.type as AgentType,
    profile_slug: match.profile_slug,
  };
}

export type ResolveContributorInput = {
  name: string;
  type: AgentType;
  version?: string;
};

export type ResolveContributorResult =
  | { ok: true; agent: ContributorSummary }
  | { ok: false; error: string };

// Find-or-create the canonical `agent` row for a name. If a match exists we
// return it as-is — including its existing type and any pre-existing claim
// (profile_id) — and the ledger links to that row. New rows are created unlinked
// (profile_id null) and public, so a silicon collaborator or tool earns its own
// page and discography from its first volley.
export async function resolveContributor(
  supabase: AgentClient,
  input: ResolveContributorInput,
): Promise<ResolveContributorResult> {
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

  const slug = await uniqueAgentSlug(supabase, slugifyAgentName(name));

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
    // A concurrent insert may have raced ahead of us and won the unique index.
    // Re-resolve to the now-existing canonical row instead of surfacing the raw
    // DB error.
    const raced = await findExistingAgent(supabase, name);
    if (raced) {
      return { ok: true, agent: raced };
    }
    return { ok: false, error: error?.message ?? "Couldn't add contributor." };
  }

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
