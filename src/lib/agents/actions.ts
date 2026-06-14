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

export type ContributorSummary = {
  id: string;
  name: string;
  type: AgentType;
  profile_slug: string | null;
};

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
