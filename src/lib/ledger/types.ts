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
