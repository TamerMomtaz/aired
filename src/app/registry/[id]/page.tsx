import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { GoLiveButton } from "@/components/go-live-button";
import { IssueCertButton } from "@/components/issue-cert-button";
import { PlayerStage } from "@/components/player-stage";
import { trackFromFeedWork, type Track } from "@/components/player/track";
import { ShareButton } from "@/components/share-button";
import { SongQr } from "@/components/song-qr";
import { VolleyEditor } from "@/components/ledger/volley-editor";
import { VolleyTrail, type TrailVolley } from "@/components/ledger/volley-trail";
import { WorkTitle } from "@/components/work-title";
import { type ContributorSummary } from "@/lib/agents/actions";
import { formatCatalogId } from "@/lib/catalog";
import { formatDuration, formatPlays } from "@/lib/format";
import { normalizeDescriptors } from "@/lib/ledger/descriptors";
import {
  type AgentType,
  type DeltaType,
  type VolleyOrigin,
  type VolleyRole,
} from "@/lib/ledger/types";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { dedupeContributors, getFeed } from "@/lib/works/queries";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  // Pull the contributor names alongside the title so the share copy and the
  // description tag both name the makers — the platform's whole point. The
  // colocated opengraph-image picks up the rich card automatically.
  const { data: work } = await supabase
    .from("work")
    .select(
      "id, title, public_volley(agent(name, profile_slug))",
    )
    .eq("id", Number(id))
    .maybeSingle();

  if (!work) {
    return { title: "Work · AIRED" };
  }

  const contributors = dedupeContributors(
    (work as unknown as {
      public_volley: Array<{ agent: { name: string; profile_slug: string | null } | null }>;
    }).public_volley,
  );
  const names = contributors.map((c) => c.name);
  const makers = formatMakerList(names);
  const catalog = formatCatalogId(work.id);
  const title = `${catalog} · "${work.title}" · AIRED`;
  const description = makers
    ? `${catalog} · "${work.title}" by ${makers}. Made by carbon and silicon, credited by name. Listen on AIRED.`
    : `${catalog} · "${work.title}". Made by carbon and silicon, credited by name. Listen on AIRED.`;
  const canonical = `/registry/${work.id}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "music.song",
      title,
      description,
      url: canonical,
      siteName: "AIRED",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

// "Tee, Claude & Suno" — soft cap at four names so the OG description stays
// scannable on a phone preview; the rest fold into a "+N" tail. Identity only,
// never a style descriptor (CLAUDE.md rules 2 + 3a).
function formatMakerList(names: string[]): string {
  if (names.length === 0) return "";
  const visible = names.slice(0, 4);
  const extra = names.length - visible.length;
  let head: string;
  if (visible.length === 1) head = visible[0];
  else if (visible.length === 2) head = `${visible[0]} & ${visible[1]}`;
  else
    head = `${visible.slice(0, -1).join(", ")} & ${visible[visible.length - 1]}`;
  return extra > 0 ? `${head} +${extra}` : head;
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
      "id, title, artwork_url, status, red_line_certified, duration_seconds, descriptors, hls_playlist_key, lyrics, creator_id, created_at, play_count",
    )
    .eq("id", workId)
    .maybeSingle();
  if (!work) notFound();

  const isOwner = !!user && user.id === work.creator_id;

  // RLS on `certification` is `select using (true)` — fine to fetch for anyone.
  // We only need to know whether one exists, to decide "Issue" vs "View" in the
  // owner trigger below (and to flag certified works on the public chrome).
  const { data: cert } = await supabase
    .from("certification")
    .select("id")
    .eq("work_id", workId)
    .maybeSingle();
  const isCertified = !!cert;

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

  // The contributors who MADE this work, surfaced once each (carbon and silicon,
  // by name — CLAUDE.md §3a) in trail order. Feeds the global player's now-playing
  // bar and the OS media session when this track plays.
  const contributors: Track["contributors"] = [];
  const seenContributors = new Set<string>();
  for (const v of volleys) {
    const a = v.agent;
    if (!a) continue;
    const key = (a.profile_slug ?? a.name).toLowerCase();
    if (seenContributors.has(key)) continue;
    seenContributors.add(key);
    contributors.push({ name: a.name, profile_slug: a.profile_slug });
  }

  const track: Track = {
    id: work.id,
    title: work.title,
    hlsPlaylistKey: work.hls_playlist_key,
    artworkUrl: work.artwork_url,
    durationSeconds: work.duration_seconds,
    contributors,
  };

  // The catalog as a queue (radio order) so "play from here" rolls onward from
  // this song. A live work sits inside it; a draft isn't in the public feed, so
  // PlayerStage falls back to a queue of just this track.
  const feed = await getFeed(supabase);
  const queue = feed
    .map(trackFromFeedWork)
    .filter((t) => t.hlsPlaylistKey)
    .sort((a, b) => a.id - b.id);

  // Render descriptors as clean separated chips: split any comma-joined element,
  // trim, drop blanks, and de-duplicate (mirrors the declare_volley RPC merge).
  const descriptors = normalizeDescriptors(work.descriptors);

  // Carbon + silicon names, deduped, for the share copy. Same dedupe rule as
  // the public feed (see src/lib/works/queries.ts).
  const contributorNames = dedupeContributors(volleys).map((a) => a.name);

  // Real listens for this work — denormalized onto `work`, kept exact by a
  // trigger. Drafts never accrue plays, so this reads 0 for an unpublished work.
  const playCount = work.play_count ?? 0;

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
            {isCertified ? (
              <span className="rounded-full border border-cert-red/40 px-2.5 py-0.5 uppercase tracking-[0.14em] text-cert-red">
                Red Line
              </span>
            ) : null}
            <span className="text-muted/70">
              {formatDuration(work.duration_seconds)}
            </span>
            {work.status === "live" ? (
              <>
                <span aria-hidden className="text-muted/40">
                  ·
                </span>
                <span className="text-muted/70">{formatPlays(playCount)}</span>
              </>
            ) : null}
          </div>

          {isOwner && work.status === "draft" ? (
            <GoLiveButton workId={work.id} />
          ) : null}

          {work.status === "live" ? (
            <div className="flex flex-wrap items-start gap-2">
              {isCertified ? (
                <Link
                  href={`/cert/${work.id}`}
                  className="rounded-lg border border-cert-red/40 px-4 py-2.5 text-sm font-medium text-cert-red transition hover:bg-cert-red/10"
                >
                  View Certificate →
                </Link>
              ) : isOwner ? (
                <IssueCertButton workId={work.id} />
              ) : null}
              <ShareButton
                workId={work.id}
                title={work.title}
                contributorNames={contributorNames}
              />
              <SongQr workId={work.id} title={work.title} />
            </div>
          ) : null}
        </div>
      </header>

      {/* Hear it → read it → see who made it: the player, then the synced
          lyrics (and the owner's tap-sync editor), then the ledger. */}
      <PlayerStage
        track={track}
        queue={queue}
        lyrics={work.lyrics}
        isOwner={isOwner}
      />

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
