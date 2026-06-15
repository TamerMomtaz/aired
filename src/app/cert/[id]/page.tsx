import Link from "next/link";
import { notFound } from "next/navigation";

import { formatCatalogId } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/server";

// The public Red Line certificate (Phase 4 #2 part 4). Public read — RLS on
// `certification` is `select using (true)`, so anonymous viewers see the cert.
// The brief gives the cert ONE job: certify authorship and process. The page
// renders the catalog number, title, the standard line, the contributor lineage
// (carbon and silicon, by name — CLAUDE.md §3a), the certified claims, and the
// prominent disclaimer that this never claims resemblance. The share-card image
// at /cert/[id]/card doubles as the opengraph-image; co-located route below.

export const dynamic = "force-dynamic";

type CertChecks = {
  human_origin?: boolean;
  authorship?: string;
  volley_count?: number;
  contributors?: { name: string; type: "human" | "ai" | "tool" }[];
  process?: string;
  resemblance_claim?: null | string;
  note?: string;
};

type CertRow = {
  id: string;
  work_id: number | string;
  standard: string | null;
  checks: CertChecks | null;
  descriptors: string[] | null;
  cert_url: string | null;
  issued_at: string;
};

type WorkRow = {
  id: number | string;
  title: string;
  duration_seconds: number | null;
  artwork_url: string | null;
  status: "draft" | "live";
};

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
  if (!work) return { title: "Certificate · AIRED" };
  return {
    title: `${formatCatalogId(work.id)} · Red Line Certificate · AIRED`,
    description: `Certified under the &I Standard v1 — Human IS the Loop. AIRED ${formatCatalogId(
      work.id,
    )} · "${work.title}". Certifies authorship and process, never resemblance.`,
  };
}

export default async function CertificatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const workId = Number(id);
  if (!Number.isInteger(workId) || workId <= 0) notFound();

  const supabase = await createClient();

  const { data: cert } = (await supabase
    .from("certification")
    .select("id, work_id, standard, checks, descriptors, cert_url, issued_at")
    .eq("work_id", workId)
    .maybeSingle()) as { data: CertRow | null };
  if (!cert) notFound();

  // The work read is RLS-gated, but live works are returned to everyone. A cert
  // only exists for a live work (the mint action requires status='live'), so
  // this fetch should always succeed.
  const { data: work } = (await supabase
    .from("work")
    .select("id, title, duration_seconds, artwork_url, status")
    .eq("id", workId)
    .maybeSingle()) as { data: WorkRow | null };
  if (!work) notFound();

  const contributors = cert.checks?.contributors ?? [];
  const issued = new Date(cert.issued_at);
  const issuedLabel = issued.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-10">
      <article className="relative flex flex-col gap-7 overflow-hidden rounded-2xl border border-cert-red/30 bg-white/[0.02] p-6 sm:p-8">
        {/* Red Line motif — the cert's signature mark. */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-[3px] bg-cert-red shadow-[0_0_18px_2px_var(--cert-red)]"
        />

        <header className="flex flex-col gap-2 pt-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-cert-red">
            Red Line Certificate
          </span>
          <h1 className="text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
            {formatCatalogId(Number(work.id))}
          </h1>
          <p className="text-lg text-foreground/90">
            &ldquo;{work.title}&rdquo;
          </p>
        </header>

        <section className="flex flex-col gap-2 rounded-xl border border-white/8 bg-white/[0.02] p-5">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted/70">
            The Standard
          </span>
          <p className="text-base font-medium text-foreground">
            Certified under the {cert.standard ?? "&I v1"} Standard — Human IS
            the Loop.
          </p>
          <p className="text-xs text-muted">
            Issued {issuedLabel}.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted/70">
            The contributor lineage
          </span>
          {contributors.length === 0 ? (
            <p className="text-sm text-muted">
              The ledger lists every hand that shaped this work.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {contributors.map((c) => (
                <li
                  key={c.name}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                    c.type === "human"
                      ? "border-white/25 bg-white/[0.06] text-foreground"
                      : c.type === "tool"
                        ? "border-white/15 bg-white/[0.03] text-muted"
                        : "border-cert-red/40 bg-cert-red/10 text-cert-red"
                  }`}
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] opacity-70">
                    {c.type === "human"
                      ? "carbon"
                      : c.type === "tool"
                        ? "tool"
                        : "silicon"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted/70">
            What this certifies
          </span>
          <ul className="flex flex-col gap-1.5 text-sm text-foreground/85">
            <li className="flex gap-2">
              <span aria-hidden className="text-cert-red">
                ·
              </span>
              <span>
                Authorship is declared via the Volley Ledger
                {cert.checks?.volley_count != null
                  ? ` (${cert.checks.volley_count} volleys sealed)`
                  : ""}
                .
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden className="text-cert-red">
                ·
              </span>
              <span>
                Process: {cert.checks?.process ?? "human-directed, AI-collaborated"}.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden className="text-cert-red">
                ·
              </span>
              <span>
                Human origin:{" "}
                <span className="font-medium">
                  {cert.checks?.human_origin ? "yes" : "not declared"}
                </span>
                .
              </span>
            </li>
          </ul>
        </section>

        <p className="rounded-xl border border-cert-red/30 bg-cert-red/[0.06] p-4 text-sm leading-relaxed text-foreground">
          This certifies authorship and process — never resemblance. AIRED makes
          no claim of similarity to any artist.
        </p>

        <div className="flex flex-wrap gap-3">
          <Link
            href={`/registry/${work.id}`}
            className="rounded-lg bg-cert-red px-4 py-2.5 text-sm font-medium text-white shadow-[0_0_18px_-6px_var(--cert-red)] transition hover:brightness-110"
          >
            ▶ Listen on AIRED
          </Link>
          <a
            href={`/cert/${work.id}/card`}
            download={`AIRED-${String(work.id).padStart(4, "0")}-redline.png`}
            className="rounded-lg border border-white/12 px-4 py-2.5 text-sm text-muted transition hover:text-foreground"
          >
            Download share card
          </a>
        </div>
      </article>

      <footer className="mt-6 text-center font-mono text-[11px] uppercase tracking-[0.22em] text-muted/60">
        Σ I — within the without
      </footer>
    </main>
  );
}
