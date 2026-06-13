import Link from "next/link";

import { LedgerStatus } from "@/components/ledger-status";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-12 px-6 py-16 text-center">
      <header className="flex flex-col items-center gap-3">
        <h1 className="text-6xl font-semibold tracking-[0.22em] sm:text-7xl">
          AIRED
        </h1>
        <p className="text-sm leading-relaxed text-muted">
          <span className="text-foreground">AI-ed</span> and proud — Added
          Intelligence, not Artificial. The first platform where the AI is a
          named, credited collaborator.
        </p>
      </header>

      <section className="w-full" aria-label="The Red Line">
        <div className="redline-track">
          <div className="redline-fill">
            <span className="redline-head" />
          </div>
        </div>
        <p className="mt-3 text-[11px] uppercase tracking-[0.28em] text-muted">
          The Red Line
        </p>
      </section>

      <div className="flex w-full flex-col items-center gap-3">
        <Link
          href="/registry"
          className="w-full rounded-lg bg-cert-red px-5 py-3 text-sm font-medium text-white shadow-[0_0_22px_-8px_var(--cert-red)] transition hover:brightness-110"
        >
          Browse the registry
        </Link>
        <Link
          href="/signup"
          className="w-full rounded-lg border border-white/12 px-5 py-3 text-sm font-medium text-foreground transition hover:bg-white/[0.06]"
        >
          Start your ledger
        </Link>
      </div>

      <footer className="flex flex-col items-center gap-3 text-xs text-muted">
        <LedgerStatus />
        <p className="font-mono text-muted/70">Σ I</p>
      </footer>
    </main>
  );
}
