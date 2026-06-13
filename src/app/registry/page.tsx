import Link from "next/link";

import { WorkTitle } from "@/components/work-title";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Registry · AIRED" };

// The public catalog. RLS only returns live works to the world (and the viewer's
// own drafts), so this query is safe to run with the anon key. Uploading arrives
// in Phase 2 — for now the registry is real but empty.
export default async function RegistryPage() {
  const supabase = await createClient();
  const { data: works, error } = await supabase
    .from("work")
    .select("id, title, red_line_certified, created_at")
    .eq("status", "live")
    .order("id", { ascending: true });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
      <header className="mb-8 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">Registry</h1>
        <p className="text-sm text-muted">
          Every AIRED work, numbered and named. The number anchors; the title
          sings.
        </p>
      </header>

      {error ? (
        <p className="rounded-lg border border-cert-red/30 bg-cert-red/10 px-4 py-3 text-sm text-foreground">
          The registry couldn&apos;t be loaded right now. Please try again shortly.
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
                {work.red_line_certified ? (
                  <span className="shrink-0 rounded-full border border-cert-red/40 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-cert-red">
                    Red Line
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyRegistry />
      )}
    </main>
  );
}

function EmptyRegistry() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-white/12 px-6 py-16 text-center">
      <span className="font-mono text-sm uppercase tracking-[0.18em] text-muted/60">
        AIRED-0001 · awaiting
      </span>
      <p className="max-w-sm text-sm leading-relaxed text-muted">
        The registry is empty — for now. The first works land in Phase 2, when
        tracks can be uploaded and their Volley Ledger declared. Every one will
        appear here, credited to everyone who made it, carbon and silicon alike.
      </p>
      <Link
        href="/signup"
        className="rounded-lg bg-cert-red px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110"
      >
        Claim your name
      </Link>
    </div>
  );
}
