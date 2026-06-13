"use client";

import { useEffect, useState } from "react";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";

type State = "checking" | "online" | "idle";

// A subtle, non-blocking proof that the browser can reach the aired-platform
// Supabase project with the public key. Fully guarded — it never breaks the page.
export function LedgerStatus() {
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: SUPABASE_ANON_KEY },
      signal: controller.signal,
    })
      .then((res) => {
        if (alive) setState(res.status < 500 ? "online" : "idle");
      })
      .catch(() => {
        if (alive) setState("idle");
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      alive = false;
      controller.abort();
      clearTimeout(timeout);
    };
  }, []);

  const label =
    state === "online"
      ? "ledger connected"
      : state === "checking"
        ? "ledger · connecting"
        : "ledger · standby";

  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden
        className={
          state === "online"
            ? "size-1.5 rounded-full bg-emerald-400"
            : state === "checking"
              ? "size-1.5 animate-pulse rounded-full bg-muted"
              : "size-1.5 rounded-full bg-muted/60"
        }
      />
      {label}
    </span>
  );
}
