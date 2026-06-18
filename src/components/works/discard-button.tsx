"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { formatCatalogId } from "@/lib/catalog";
import { discardWork } from "@/lib/works/actions";
import type { WorkStatus } from "@/lib/albums/queries";

// Discard a work — EDIT & TIDY's cleanup tool. Used on Manage → Works, on the
// owner's draft page (the upload wizard's "Discard"), and on /upload's Resume
// list. Deleting is owner-only (work_owner_del) and irreversible (cascade takes
// the cert + plays), so the confirm scales with what's at stake:
//   • a plain draft → one tap to confirm;
//   • a LIVE work, or one with plays / a minted Red Line → a stronger confirm
//     with an explicit acknowledgement before the button arms.
// The server re-checks the same gate (force), so the level can't be skipped.

const btnBase =
  "rounded-lg border px-3.5 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50";

export function DiscardButton({
  workId,
  status,
  playCount,
  certified,
  redirectTo,
  className,
}: {
  workId: number;
  status: WorkStatus;
  playCount: number;
  certified: boolean;
  // Where to go after a successful discard. Omit to refresh in place (Manage /
  // upload); pass a path when the current page is the work being removed.
  redirectTo?: string;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const needsStrong = status === "live" || playCount > 0 || certified;
  const catalog = formatCatalogId(workId);

  function openModal() {
    setError(null);
    setAcknowledged(false);
    setOpen(true);
  }

  function closeModal() {
    if (pending) return;
    setOpen(false);
  }

  function confirm() {
    if (needsStrong && !acknowledged) return;
    setError(null);
    startTransition(async () => {
      const result = await discardWork(workId, { force: needsStrong });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={
          className ?? `${btnBase} border-white/12 text-cert-red hover:bg-cert-red/10`
        }
      >
        Discard
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`discard-${workId}-heading`}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
          onClick={closeModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-white/10 bg-background p-5 shadow-2xl sm:p-6"
          >
            <div className="flex flex-col gap-1.5">
              <h2
                id={`discard-${workId}-heading`}
                className="text-base font-semibold text-foreground"
              >
                Discard {catalog}?
              </h2>
              {needsStrong ? (
                <p className="text-sm leading-relaxed text-muted">
                  This work is live and carries history. Discarding it{" "}
                  <span className="text-foreground">cannot be undone</span> — it
                  permanently removes
                  {certified ? " its Red Line certificate," : ""}{" "}
                  {playCount > 0
                    ? `${playCount.toLocaleString()} ${playCount === 1 ? "play" : "plays"},`
                    : "its ledger,"}{" "}
                  and deletes its stored files. Its AIRED number is retired (not
                  reused).
                </p>
              ) : (
                <p className="text-sm leading-relaxed text-muted">
                  This permanently removes the draft, its volley ledger, and its
                  stored files. Its AIRED number won&apos;t be reused. Other
                  works are untouched.
                </p>
              )}
            </div>

            {needsStrong ? (
              <label className="flex items-start gap-3 rounded-xl border border-cert-red/30 bg-cert-red/[0.06] p-3.5 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  disabled={pending}
                  className="mt-0.5 size-4 shrink-0 accent-cert-red"
                />
                <span>
                  I understand this permanently deletes {catalog} and its history.
                </span>
              </label>
            ) : null}

            {error ? (
              <p role="alert" className="text-sm text-cert-red">
                {error}
              </p>
            ) : null}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeModal}
                disabled={pending}
                className={`${btnBase} border-white/12 text-muted hover:text-foreground`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={pending || (needsStrong && !acknowledged)}
                className="rounded-lg bg-cert-red px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending
                  ? "Discarding…"
                  : needsStrong
                    ? "Discard permanently"
                    : "Discard"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
