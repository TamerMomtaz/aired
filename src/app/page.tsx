import { LedgerStatus } from "@/components/ledger-status";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-12 px-6 py-16 text-center">
      <header className="flex flex-col items-center gap-3">
        <h1 className="text-6xl font-semibold tracking-[0.22em] sm:text-7xl">
          AIRED
        </h1>
        <p className="text-sm leading-relaxed text-muted">
          <span className="text-foreground">AI-ed</span> and proud — Added
          Intelligence, not Artificial.
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

      <footer className="flex flex-col items-center gap-3 text-xs text-muted">
        <LedgerStatus />
        <p className="tracking-wide">Phase 0 · Foundation</p>
        <p className="font-mono text-muted/70">Σ I</p>
      </footer>
    </main>
  );
}
