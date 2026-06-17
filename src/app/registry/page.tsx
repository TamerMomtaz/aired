import Link from "next/link";

import { PlayCount } from "@/components/play-count";
import { WorkTitle } from "@/components/work-title";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Registry · AIRED" };

// The catalog. RLS returns every live work to the world, plus the viewer's own
// drafts — so a signed-in creator sees their in-progress works here too, badged
// as drafts, while the public sees only what's live.
export default async function RegistryPage() {
  const supabase = await createClient();
  const user = await getCurrentUser();

  const { data: works, error } = await supabase
    .from("work")
    .select("id, title, status, red_line_certified, created_at, play_count")
    .order("id", { ascending: true });

  let hasAgent = false;
  if (user) {
    const { data } = await supabase
      .from("agent")
      .select("id")
      .eq("profile_id", user.id)
      .limit(1)
      .maybeSingle();
    hasAgent = !!data;
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-foreground">Registry</h1>
          <p className="text-sm text-muted">
            Every AIRED work, numbered and named. The number anchors; the title
            sings.
          </p>
        </div>
        {user ? (
          <Link
            href="/upload"
            className="shrink-0 rounded-lg bg-cert-red px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110"
          >
            Upload
          </Link>
        ) : null}
      </header>

      {error ? (
        <p className="rounded-lg border border-cert-red/30 bg-cert-red/10 px-4 py-3 text-sm text-foreground">
          The registry couldn&apos;t be loaded right now. Please try again
          shortly.
        </p>
      ) : works && works.length > 0 ? (
        <ul className="flex flex-col divide-y divide-white/8 overflow-hidden rounded-xl border border-white/8">
          {works.map((work) => (
            <li key={work.id}>
              <Link
                href={`/registry/${work.id}`}
                className="flex items-center justify-between gap-4 px-4 py-4 transition hover:bg-white/[0.03]"
              >
                <WorkTitle id={work.id} title={work.title} />
                <div className="flex shrink-0 items-center gap-2">
                  {work.status === "live" ? (
                    <PlayCount
                      count={work.play_count ?? 0}
                      className="font-mono text-[11px] text-muted/60"
                    />
                  ) : null}
                  {work.status === "draft" ? (
                    <span className="rounded-full border border-white/15 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-muted">
                      Draft
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
        <EmptyRegistry signedIn={!!user} hasAgent={hasAgent} />
      )}
    </main>
  );
}

function EmptyRegistry({
  signedIn,
  hasAgent,
}: {
  signedIn: boolean;
  hasAgent: boolean;
}) {
  const cta = !signedIn
    ? { href: "/signup", label: "Claim your name" }
    : hasAgent
      ? { href: "/upload", label: "Upload your first work" }
      : { href: "/claim", label: "Claim your name" };

  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-white/12 px-6 py-16 text-center">
      <span className="font-mono text-sm uppercase tracking-[0.18em] text-muted/60">
        AIRED-0001 · awaiting
      </span>
      <p className="max-w-sm text-sm leading-relaxed text-muted">
        The registry is empty — for now. Upload a track, declare its Volley
        Ledger, and it appears here, credited to everyone who made it, carbon and
        silicon alike.
      </p>
      <Link
        href={cta.href}
        className="rounded-lg bg-cert-red px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110"
      >
        {cta.label}
      </Link>
    </div>
  );
}
