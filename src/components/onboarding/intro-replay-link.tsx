"use client";

import { useRouter } from "next/navigation";

import { replayOnboarding } from "./onboarding-state";

// The footer's "intro" link. Clears the single onboarding flag and fires the
// replay event, then heads home — where the overlay lives and re-opens at the
// first screen. Lower-case and quiet on purpose: it's a re-watch, not a CTA.
export function IntroReplayLink() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        replayOnboarding();
        router.push("/");
      }}
      className="font-mono lowercase tracking-wide text-muted/70 transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cert-red/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded"
    >
      intro
    </button>
  );
}
