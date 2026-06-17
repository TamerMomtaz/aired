import Link from "next/link";

import { IntroReplayLink } from "@/components/onboarding/intro-replay-link";

// The app shell's bottom bar. Quiet and global: a small brand lockup, the few
// links worth keeping one tap away, and the "intro" replay (re-watch the
// first-visit onboarding). Sits above the now-playing bar in normal flow, so it
// never hides behind it.
export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-white/8 bg-background/60">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 py-7 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="font-semibold tracking-[0.22em] text-foreground/80">
            AIRED
          </span>
          <span
            aria-hidden
            className="h-px w-6 rounded-full bg-cert-red"
            style={{
              boxShadow:
                "0 0 8px color-mix(in srgb, var(--cert-red) 70%, transparent)",
            }}
          />
          <span className="text-muted/80">AI-ed and proud.</span>
        </div>

        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href="/" className="transition hover:text-foreground">
            Listen
          </Link>
          <Link href="/terms" className="transition hover:text-foreground">
            Covenant
          </Link>
          <IntroReplayLink />
          <span className="font-mono text-muted/50">Σ I · {year}</span>
        </nav>
      </div>
    </footer>
  );
}
