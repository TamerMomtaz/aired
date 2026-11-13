// A mix saved to its maker's AIRED account (public.mix).
export type AccountMix = {
  id: string;
  title: string;
  duration_seconds: number;
  bpm: number | null;
  energy: string | null;
  dj_name: string | null;
  story: string | null;
  planned_by: "brain" | "rules";
  source_work_ids: number[];
  credits: { work_id: number; label: string; by: string }[];
  hls_playlist_key: string | null;
  shared: boolean;
  created_at: string;
};

export const MIX_COLUMNS =
  "id, title, duration_seconds, bpm, energy, dj_name, story, planned_by, source_work_ids, credits, hls_playlist_key, shared, created_at";

export const MIX_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
