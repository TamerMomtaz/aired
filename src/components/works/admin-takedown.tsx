"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { restoreWork, takedownWork } from "@/lib/review/actions";

// Admin governance on a work's own page: pull it off every public surface
// (with a reason the owner sees), or restore one that's been pulled. Works on a
// LIVE / approved work too. Authorization is enforced server-side (the DEFINER
// RPCs assert is_admin); this island is just the control surface — only rendered
// for an admin. After a change it refreshes so the page (and its public
// visibility) reflect the new state.
export function AdminTakedownControls({
  workId,
  takenDown,
  reason,
}: {
  workId: number;
  takenDown: boolean;
  reason: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  function submitTakedown() {
    if (!note.trim()) return;
    setError(null);
    startTransition(async () => {
      const r = await takedownWork(workId, note);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      setNote("");
      router.refresh();
    });
  }

  function restore() {
    setError(null);
    startTransition(async () => {
      const r = await restoreWork(workId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.16em] text-muted/60">
          Admin
        </span>
        {takenDown ? (
          <span className="rounded-full border border-cert-red/40 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-cert-red">
            Taken down
          </span>
        ) : null}
      </div>

      {takenDown ? (
        <>
          {reason ? (
            <p className="text-xs text-muted">Reason: {reason}</p>
          ) : null}
          <button
            type="button"
            onClick={restore}
            disabled={pending}
            className="self-start rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-medium text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Restoring…" : "Restore to public"}
          </button>
        </>
      ) : !open ? (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          disabled={pending}
          className="self-start rounded-lg border border-cert-red/40 px-4 py-2 text-sm font-medium text-cert-red transition hover:bg-cert-red/10 disabled:opacity-50"
        >
          Take down
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor={`takedown-${workId}`} className="text-xs text-muted">
            Why is this being taken down? The owner will see this reason.
          </label>
          <textarea
            id={`takedown-${workId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={pending}
            rows={2}
            maxLength={280}
            placeholder="e.g. Violates the Community Covenant — names another artist as a style target."
            className="w-full resize-y rounded-md border border-white/12 bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted/50 focus:border-white/25"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setNote("");
              }}
              disabled={pending}
              className="rounded-md border border-white/12 px-3 py-1.5 text-sm text-muted transition hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitTakedown}
              disabled={pending || !note.trim()}
              className="rounded-md bg-cert-red px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Taking down…" : "Take down"}
            </button>
          </div>
        </div>
      )}

      {error ? (
        <p role="alert" className="text-sm text-cert-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}
