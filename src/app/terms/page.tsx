import Link from "next/link";

export const metadata = {
  title: "The AIRED Covenant",
  description:
    "AIRED celebrates what other places hide: music made by human and AI, together. One line — don't attack people for who they are.",
};

// The AIRED Covenant. Public, /terms — every Go Live action links here, and the
// modal summary mirrors this single rule. Short and load-bearing: the platform
// will never ban the collaboration; in return, one ask.
export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-12">
      <header className="mb-10 flex flex-col gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted/70">
          The Covenant
        </span>
        <h1 className="text-3xl font-semibold text-foreground sm:text-4xl">
          The AIRED Covenant
        </h1>
      </header>

      <article className="flex flex-col gap-7 text-base leading-relaxed text-foreground/90">
        <p>
          AIRED celebrates what other places hide: music made by human and AI,
          together. We will never ban the collaboration. In return, we ask one
          thing.
        </p>

        <p className="rounded-xl border border-cert-red/30 bg-cert-red/[0.06] p-5 text-foreground">
          By going live on AIRED, you confirm your work does not promote,
          glorify, or incite hatred, violence, or the dehumanization of any
          people — by race, religion, ethnicity, nationality, gender, sexuality,
          disability, or the like.
        </p>

        <p>
          That is the line. Not taste. Not polish. Not opinion. You can make
          almost anything here — except what attacks people for who they are.
        </p>

        <p className="text-lg font-medium text-foreground">
          Make something whole. Sigma I.
        </p>
      </article>

      <footer className="mt-12 flex flex-col gap-3 border-t border-white/8 pt-8 text-xs text-muted">
        <p className="font-mono text-muted/70">Σ I — within the without.</p>
        <Link
          href="/"
          className="self-start text-cert-red underline-offset-4 hover:underline"
        >
          ← Back to AIRED
        </Link>
      </footer>
    </main>
  );
}
