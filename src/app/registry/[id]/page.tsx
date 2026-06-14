import Image from "next/image";
import { notFound } from "next/navigation";

import { RedLinePlayer } from "@/components/RedLinePlayer";
import { VolleyEditor } from "@/components/ledger/volley-editor";
import { VolleyTrail, type TrailVolley } from "@/components/ledger/volley-trail";
import { WorkTitle } from "@/components/work-title";
import { type ContributorSummary } from "@/lib/agents/actions";
import { formatCatalogId } from "@/lib/catalog";
import { formatDuration } from "@/lib/format";
import { normalizeDescriptors } from "@/lib/ledger/descriptors";
import {
  type AgentType,
  type DeltaType,
  type VolleyOrigin,
  type VolleyRole,
} from "@/lib/ledger/types";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: work } = await supabase
    .from("work")
    .select("id, title")
    .eq("id", Number(id))
    .maybeSingle();
  return {
    title: work
      ? `${formatCatalogId(work.id)} · "${work.title}" · AIRED`
      : "Work · AIRED",
  };
}

type VolleyRecord = {
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

export default async function WorkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const workId = Number(id);
  if (!Number.isInteger(workId) || workId <= 0) notFound();

  const supabase = await createClient();
  const user = await getCurrentUser();

  // RLS returns live works to anyone and drafts only to their creator, so an
  // unauthorized draft simply 404s.
  const { data: work } = await supabase
    .from("work")
    .select(
      "id, title, artwork_url, status, red_line_certified, duration_seconds, descriptors, hls_playlist_key, creator_id, created_at",
    )
    .eq("id", workId)
    .maybeSingle();
  if (!work) notFound();

  const isOwner = !!user && user.id === work.creator_id;

  const { data: volleyData } = await supabase
    .from("public_volley")
    .select(
      "id, seq, role, origin, delta_type, private_hash, agent:agent_id ( id, name, profile_slug, type )",
    )
    .eq("work_id", workId)
    .order("seq", { ascending: true });

  // The FK embed `agent` is a single object at runtime (many-to-one); the
  // query-type inferrer assumes an array, so we cast through unknown.
  const volleys: TrailVolley[] = (
    (volleyData ?? []) as unknown as VolleyRecord[]
  ).map((v) => ({
      id: v.id,
      seq: v.seq,
      role: v.role,
      origin: v.origin,
      delta_type: v.delta_type,
      private_hash: v.private_hash,
      agent: v.agent,
    }),
  );

  // Render descriptors as clean separated chips: split any comma-joined element,
  // trim, drop blanks, and de-duplicate (mirrors the declare_volley RPC merge).
  const descriptors = normalizeDescriptors(work.descriptors);

  let agents: ContributorSummary[] = [];
  let suggestedSeq = 0;
  if (isOwner) {
    const { data: agentData } = await supabase
      .from("agent")
      .select("id, name, type, profile_slug")
      .order("name", { ascending: true });
    agents = (agentData ?? []) as ContributorSummary[];
    const maxSeq = volleys.reduce((m, v) => Math.max(m, Number(v.seq)), -1);
    suggestedSeq = volleys.length ? Math.floor(maxSeq) + 1 : 0;
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
      <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-start">
        {work.artwork_url ? (
          <Image
            src={work.artwork_url}
            alt={`Artwork for ${work.title}`}
            width={128}
            height={128}
            className="size-32 shrink-0 rounded-xl border border-white/10 object-cover"
            unoptimized
          />
        ) : (
          <div className="flex size-32 shrink-0 items-center justify-center rounded-xl border border-dashed border-white/12 text-[10px] uppercase tracking-[0.16em] text-muted/50">
            no art
          </div>
        )}

        <div className="flex flex-col gap-3">
          <WorkTitle id={work.id} title={work.title} size="lg" />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span
              className={
                work.status === "live"
                  ? "rounded-full border border-emerald-400/40 px-2.5 py-0.5 uppercase tracking-[0.14em] text-emerald-300"
                  : "rounded-full border border-white/15 px-2.5 py-0.5 uppercase tracking-[0.14em] text-muted"
              }
            >
              {work.status}
            </span>
            {work.red_line_certified ? (
              <span className="rounded-full border border-cert-red/40 px-2.5 py-0.5 uppercase tracking-[0.14em] text-cert-red">
                Red Line
              </span>
            ) : null}
            <span className="text-muted/70">
              {formatDuration(work.duration_seconds)}
            </span>
          </div>
        </div>
      </header>

      <section className="mb-8">
        <RedLinePlayer
          hlsPlaylistKey={work.hls_playlist_key}
          workId={work.id}
          title={work.title}
        />
      </section>

      <section className="mb-8 flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.18em] text-muted/70">
          The Volley Ledger
        </h2>
        <VolleyTrail volleys={volleys} descriptors={descriptors} />
      </section>

      {isOwner ? (
        <section className="flex flex-col gap-3">
          <p className="rounded-lg border border-white/8 bg-white/[0.02] px-4 py-3 text-xs text-muted">
            This is your draft. Declare the volleys that made it — typically 5–15
            for a track. The Red Line player above goes live once this track&apos;s
            audio is processed for streaming.
          </p>
          <VolleyEditor
            workId={work.id}
            agents={agents}
            suggestedSeq={suggestedSeq}
          />
        </section>
      ) : null}
    </main>
  );
}
