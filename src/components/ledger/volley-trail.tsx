import Link from "next/link";

import {
  DELTA_LABELS,
  ORIGIN_LABELS,
  ROLE_LABELS,
  formatSeq,
  type AgentType,
  type DeltaType,
  type VolleyOrigin,
  type VolleyRole,
} from "@/lib/ledger/types";

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

// Origin is the heart of the conductivity map: who carried this move — a human
// throw, a silicon catch, or a dialogue between them.
const ORIGIN_STYLE: Record<VolleyOrigin, string> = {
  HUMAN: "border-white/25 bg-white/10 text-foreground",
  AI: "border-cert-red/45 bg-cert-red/15 text-cert-red",
  DIALOGUE:
    "border-amber-400/40 bg-amber-400/10 text-amber-300",
};

// The conductivity map (brief part 5): human throw, silicon catch, dialogue
// moments, descriptors flowing in — SHAPES ONLY, never craft.
export function VolleyTrail({
  volleys,
  descriptors,
}: {
  volleys: TrailVolley[];
  descriptors: string[];
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
              <div className="flex flex-col gap-1.5 rounded-lg border border-white/8 bg-white/[0.02] px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono text-xs text-cert-red">
                    {formatSeq(v.seq)}
                  </span>
                  <span className="text-muted/40" aria-hidden>
                    ·
                  </span>
                  {v.agent ? (
                    v.agent.profile_slug ? (
                      <Link
                        href={`/agent/${v.agent.profile_slug}`}
                        className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
                      >
                        {v.agent.name}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium text-foreground">
                        {v.agent.name}
                      </span>
                    )
                  ) : (
                    <span className="text-sm text-muted">Unknown contributor</span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] ${ORIGIN_STYLE[v.origin]}`}
                  >
                    {ORIGIN_LABELS[v.origin]}
                  </span>
                  <span className="rounded-full border border-white/12 bg-white/[0.04] px-2 py-0.5 text-[11px] text-muted">
                    {ROLE_LABELS[v.role]}
                  </span>
                  <span className="text-[11px] text-muted/70">
                    {DELTA_LABELS[v.delta_type]}
                  </span>
                  {v.private_hash ? (
                    <span
                      title={`Sealed craft · sha256 ${v.private_hash.slice(0, 12)}…`}
                      className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] text-muted/50"
                    >
                      <LockGlyph />
                      sealed
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function LockGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="size-3"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
