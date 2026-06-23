// The Volley Ledger vocabulary (CLAUDE.md §4). These mirror the Postgres enums
// volley_role / volley_origin / delta_type / agent_type exactly, and are shared
// by client editors and server actions alike. The public ledger stores the
// SHAPE of a contribution (these), never its content.

export const VOLLEY_ROLES = [
  "lyric_thrown",
  "lyric_caught",
  "structure",
  "genre_direction",
  "vocal_render",
  "production",
  "artwork",
  "edit",
  "audit",
] as const;
export type VolleyRole = (typeof VOLLEY_ROLES)[number];

export const VOLLEY_ORIGINS = ["HUMAN", "AI", "DIALOGUE"] as const;
export type VolleyOrigin = (typeof VOLLEY_ORIGINS)[number];

export const DELTA_TYPES = ["added", "removed", "reframed"] as const;
export type DeltaType = (typeof DELTA_TYPES)[number];

export const AGENT_TYPES = ["human", "ai_model", "ai_voice", "tool"] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

// Human-friendly labels for the editor and the conductivity map.
export const ROLE_LABELS: Record<VolleyRole, string> = {
  lyric_thrown: "Lyric thrown",
  lyric_caught: "Lyric caught",
  structure: "Structure",
  genre_direction: "Genre direction",
  vocal_render: "Vocal render",
  production: "Production",
  artwork: "Artwork",
  edit: "Edit",
  audit: "Audit",
};

export const ORIGIN_LABELS: Record<VolleyOrigin, string> = {
  HUMAN: "Human",
  AI: "AI",
  DIALOGUE: "Dialogue",
};

export const DELTA_LABELS: Record<DeltaType, string> = {
  added: "added",
  removed: "removed",
  reframed: "reframed",
};

export const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  human: "Human",
  ai_model: "AI model",
  ai_voice: "AI voice",
  tool: "Tool",
};

// Render a numeric seq as V0 / V1 / V1.5 — the number anchors the trail.
export function formatSeq(seq: number | string): string {
  const n = typeof seq === "string" ? Number(seq) : seq;
  if (!Number.isFinite(n)) return `V${seq}`;
  return `V${Number(n)}`;
}

// Origin must never contradict the contributor's type: a silicon contributor
// (ai_model) could not have carried a HUMAN-origin move, and a human could not
// have carried an AI-origin one. DIALOGUE — the "neither alone" move (CLAUDE.md
// §7) — stays legal for ANY contributor; ai_voice / tool carry no restriction.
// These three helpers mirror the enforce_volley_origin() DB trigger exactly, so
// the editors guide the choice and block a bad pair before it ever reaches the
// database exception.

// The sensible default origin when a contributor is chosen: humans throw
// (HUMAN), silicon renders (AI). The creator can still switch to DIALOGUE.
export function defaultOriginForAgentType(type: AgentType): VolleyOrigin {
  return type === "human" ? "HUMAN" : "AI";
}

// True when this contributor type could never have carried this origin.
export function originContradictsAgentType(
  type: AgentType,
  origin: VolleyOrigin,
): boolean {
  if (type === "ai_model" && origin === "HUMAN") return true;
  if (type === "human" && origin === "AI") return true;
  return false;
}

// A clear reason for a contradictory pair, or null when the pair is legal.
export function originConflictMessage(
  type: AgentType,
  origin: VolleyOrigin,
): string | null {
  if (type === "ai_model" && origin === "HUMAN") {
    return "An AI contributor can't carry a Human-origin move — use AI or Dialogue.";
  }
  if (type === "human" && origin === "AI") {
    return "A human contributor can't carry an AI-origin move — use Human or Dialogue.";
  }
  return null;
}
