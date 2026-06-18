"use client";

import { useEffect, useState } from "react";

import { checkHandle } from "@/lib/identity/actions";

// The live handle-availability check + hint, shared by the first-run wizard and
// the identity editor. The DB unique index is the real arbiter (the save action
// re-checks and translates a race-lost collision); this just shows the result as
// you type, so a taken handle is caught before submit (graceful retry).

export type HandleAvail = {
  handle: string;
  available: boolean;
  reason?: string;
} | null;

// Returns the latest availability result for `handle`. State is only ever set
// inside the debounce callback (never synchronously in the effect body); a result
// that no longer matches the current handle reads as "still checking" in the hint.
export function useHandleCheck(handle: string, fmtError: string | null) {
  const [avail, setAvail] = useState<HandleAvail>(null);

  useEffect(() => {
    if (!handle || fmtError) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const res = await checkHandle(handle);
      if (cancelled) return;
      setAvail(
        res.ok
          ? { handle, available: res.available, reason: res.reason }
          : null,
      );
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [handle, fmtError]);

  return { avail };
}

export function HandleHint({
  handle,
  fmtError,
  avail,
}: {
  handle: string;
  fmtError: string | null;
  avail: HandleAvail;
}) {
  if (!handle) {
    return (
      <span className="text-[11px] text-muted/60">
        Letters, numbers and dashes — this is your public address.
      </span>
    );
  }
  if (fmtError) {
    return <span className="text-[11px] text-cert-red">{fmtError}</span>;
  }
  // No result yet, or a result for a previous keystroke — still settling.
  if (!avail || avail.handle !== handle) {
    return (
      <span className="text-[11px] text-muted/60">Checking availability…</span>
    );
  }
  if (avail.available) {
    return (
      <span className="text-[11px] text-emerald-400">{handle} is available ✓</span>
    );
  }
  return (
    <span className="text-[11px] text-cert-red">
      {avail.reason ?? `${handle} is taken — try another.`}
    </span>
  );
}
