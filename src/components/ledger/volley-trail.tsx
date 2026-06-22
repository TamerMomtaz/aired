import {
  type AgentType,
  type DeltaType,
  type VolleyOrigin,
  type VolleyRole,
} from "@/lib/ledger/types";

import { VolleyRow } from "./volley-row";

export type TrailVolley = {
  id: string;
  seq: number | string;
  role: VolleyRole;
  origin: VolleyOrigin;
  delta_type: DeltaType;
  private_hash: string | null;
  agent: {
    id: string;
    name: string;
    profile_slug: string | null;
    type: AgentType;
  } | null;
};

// The conductivity map (brief part 5): human throw, silicon catch, dialogue
// moments, descriptors flowing in — SHAPES ONLY, never craft. When `canEdit`
// (the work's owner is viewing), each node carries an inline corrector for its
// public-skeleton fields; the read-only trail is unchanged for everyone else.
export function VolleyTrail({
  volleys,
  descriptors,
  canEdit = false,
  workId,
}: {
  volleys: TrailVolley[];
  descriptors: string[];
  canEdit?: boolean;
  workId?: number;
}) {
  return (
    <section className="flex flex-col gap-5">
      {descriptors.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-[0.18em] text-muted/70">
            Descriptors flowing in
          </span>
          <div className="flex flex-wrap gap-1.5">
            {descriptors.map((d) => (
              <span
                key={d}
                className="rounded-full border border-white/12 bg-white/[0.04] px-2.5 py-0.5 text-xs text-muted"
              >
                {d}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {volleys.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/12 px-5 py-10 text-center text-sm text-muted">
          No volleys yet. The ledger is what makes this an AIRED work — declare
          the first throw.
        </p>
      ) : (
        <ol className="relative flex flex-col gap-3 border-l border-white/10 pl-5">
          {volleys.map((v) => (
            <li key={v.id} className="relative">
              <span
                aria-hidden
                className="absolute -left-[1.4rem] top-2 size-2 rounded-full bg-cert-red ring-4 ring-background"
              />
              <VolleyRow
                volley={v}
                canEdit={canEdit}
                workId={workId ?? 0}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
