import Link from "next/link";
import { notFound } from "next/navigation";

import { WorkTitle } from "@/components/work-title";
import { AGENT_TYPE_LABELS, type AgentType } from "@/lib/ledger/types";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

type WorkRow = {
  id: number;
  title: string;
  status: "draft" | "live" | "pending";
  red_line_certified: boolean;
  created_at: string;
  creator_id: string;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: agent } = await supabase
    .from("agent")
    .select("name")
    .eq("profile_slug", slug)
    .maybeSingle();
  return { title: agent ? `${agent.name} · AIRED` : "Contributor · AIRED" };
}

export default async function AgentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: agent } = await supabase
    .from("agent")
    .select("id, name, type, version, bio, profile_slug, created_at")
    .eq("profile_slug", slug)
    .maybeSingle();
  if (!agent) notFound();

  // Discography: works this agent appears on. A public discography shows only
  // live works; the viewer's own non-live works (drafts / 'In review') also
  // appear to them. We filter "live OR mine" in code — never another creator's
  // unpublished work, not even for an admin, whose broad read (work_admin_read)
  // exists for the Review queue, not this page. Dedupe (an agent may carry
  // several volleys per work).
  const user = await getCurrentUser();
  const { data: volleyRows } = await supabase
    .from("public_volley")
    .select(
      "work:work_id ( id, title, status, red_line_certified, created_at, creator_id )",
    )
    .eq("agent_id", agent.id);

  // PostgREST returns the FK embed `work` as a single object (many-to-one); the
  // query-type inferrer assumes an array, so we cast through unknown.
  const works: WorkRow[] = [];
  const seen = new Set<number>();
  for (const row of (volleyRows ?? []) as unknown as { work: WorkRow | null }[]) {
    const w = row.work;
    if (!w) continue;
    const mine = !!user && w.creator_id === user.id;
    if (w.status !== "live" && !mine) continue;
    if (!seen.has(w.id)) {
      seen.add(w.id);
      works.push(w);
    }
  }
  works.sort((a, b) => a.id - b.id);

  const type = agent.type as AgentType;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
      <header className="mb-8 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold text-foreground">
            {agent.name}
          </h1>
          <span className="rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-0.5 text-[11px] uppercase tracking-[0.14em] text-muted">
            {AGENT_TYPE_LABELS[type] ?? type}
          </span>
          {agent.version ? (
            <span className="font-mono text-xs text-muted/70">
              v{agent.version}
            </span>
          ) : null}
        </div>
        {agent.bio ? (
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            {agent.bio}
          </p>
        ) : null}
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-xs uppercase tracking-[0.18em] text-muted/70">
          Discography
        </h2>

        {works.length > 0 ? (
          <ul className="flex flex-col divide-y divide-white/8 overflow-hidden rounded-xl border border-white/8">
            {works.map((work) => (
              <li key={work.id}>
                <Link
                  href={`/registry/${work.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-4 transition hover:bg-white/[0.03]"
                >
                  <WorkTitle id={work.id} title={work.title} />
                  <div className="flex shrink-0 items-center gap-2">
                    {work.status === "draft" ? (
                      <span className="rounded-full border border-white/15 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-muted">
                        Draft
                      </span>
                    ) : null}
                    {work.status === "pending" ? (
                      <span className="rounded-full border border-amber-400/40 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-amber-300">
                        In review
                      </span>
                    ) : null}
                    {work.red_line_certified ? (
                      <span className="rounded-full border border-cert-red/40 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-cert-red">
                        Red Line
                      </span>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-white/12 px-5 py-10 text-center text-sm text-muted">
            No works yet. As {agent.name} is credited on volleys, the
            discography fills here.
          </p>
        )}
      </section>
    </main>
  );
}
