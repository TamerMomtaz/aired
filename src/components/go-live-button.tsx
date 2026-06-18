"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { goLive } from "@/lib/works/actions";

// Owner-only control that publishes a draft work. Publishing is also the moment
// the creator agrees to the AIRED Community Covenant — a small modal carries the
// summary, links to the full /terms page, and requires the checkbox before the
// button can fire. The action records the acceptance alongside the status flip.
//
// The Review Gate decides where the work lands: a trusted creator's work goes
// live instantly (the modal closes and the page refreshes to "live"); a new
// creator's work is held in the Review queue as 'pending', and the modal stays
// up to say so. The owner doesn't choose — their trust does. RLS is the real
// authorization (the action runs as the user, never the service role).
export function GoLiveButton({ workId }: { workId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once a publish is held for review, so the modal switches from the
  // covenant form to a short "in review" confirmation.
  const [outcome, setOutcome] = useState<"pending" | null>(null);
  const [pending, startTransition] = useTransition();

  function openModal() {
    setError(null);
    setAccepted(false);
    setOutcome(null);
    setOpen(true);
  }

  function closeModal() {
    if (pending) return;
    setOpen(false);
    // A held-for-review submission changed the page's state; refresh on close so
    // it shows the "In review" badge.
    if (outcome === "pending") {
      setOutcome(null);
      router.refresh();
    }
  }

  function confirm() {
    if (!accepted) return;
    setError(null);
    startTransition(async () => {
      const result = await goLive(workId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.status === "pending") {
        // Held for review — keep the modal up to explain; refresh on close.
        setOutcome("pending");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={openModal}
        className="self-start rounded-lg bg-cert-red px-4 py-2.5 text-sm font-medium text-white shadow-[0_0_18px_-6px_var(--cert-red)] transition hover:brightness-110"
      >
        Go Live
      </button>
      {open ? (
        <CovenantModal
          accepted={accepted}
          setAccepted={setAccepted}
          pending={pending}
          error={error}
          outcome={outcome}
          onClose={closeModal}
          onConfirm={confirm}
        />
      ) : null}
    </div>
  );
}

function CovenantModal({
  accepted,
  setAccepted,
  pending,
  error,
  outcome,
  onClose,
  onConfirm,
}: {
  accepted: boolean;
  setAccepted: (v: boolean) => void;
  pending: boolean;
  error: string | null;
  outcome: "pending" | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="covenant-heading"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-white/10 bg-background p-5 shadow-2xl sm:p-6"
      >
        {outcome === "pending" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <h2
                id="covenant-heading"
                className="text-base font-semibold text-foreground"
              >
                Sent for review
              </h2>
              <p className="text-sm leading-relaxed text-muted">
                Thanks — your work is in the queue. An admin will take a quick
                look, and the moment it&apos;s approved it goes live. Until then
                it shows as{" "}
                <span className="text-amber-300">In review</span> on your page.
              </p>
            </div>
            <p className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-4 text-sm leading-relaxed text-foreground">
              Nothing else to do. We hold a new creator&apos;s first works
              briefly — once you&apos;re trusted, your publishes go live
              instantly.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-cert-red px-4 py-2.5 text-sm font-medium text-white shadow-[0_0_18px_-6px_var(--cert-red)] transition hover:brightness-110"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <h2
                id="covenant-heading"
                className="text-base font-semibold text-foreground"
              >
                The AIRED Covenant
              </h2>
              <p className="text-sm text-muted">
                AIRED celebrates what other places hide: music made by human and
                AI, together. We will never ban the collaboration. In return, we
                ask one thing.
              </p>
            </div>

            <p className="text-sm leading-relaxed text-muted">
              AIRED is an open host with a single line: no hate, no violence, no
              dehumanization. Everything else is welcome.
            </p>

            <p className="rounded-xl border border-cert-red/30 bg-cert-red/[0.06] p-4 text-sm leading-relaxed text-foreground">
              Your work does not promote, glorify, or incite hatred, violence, or
              the dehumanization of any people — by race, religion, ethnicity,
              nationality, gender, sexuality, disability, or the like.
            </p>

            <p className="text-xs text-muted/80">
              Read the{" "}
              <Link
                href="/terms"
                target="_blank"
                className="text-cert-red underline-offset-4 hover:underline"
              >
                full Covenant
              </Link>{" "}
              (opens in a new tab).
            </p>

            <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-sm text-foreground">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                disabled={pending}
                className="mt-0.5 size-4 shrink-0 accent-cert-red"
              />
              <span>I confirm this work follows the AIRED Covenant.</span>
            </label>

            {error ? (
              <p role="alert" className="text-sm text-cert-red">
                {error}
              </p>
            ) : null}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="rounded-lg border border-white/12 px-4 py-2.5 text-sm text-muted transition hover:text-foreground disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={!accepted || pending}
                className="rounded-lg bg-cert-red px-4 py-2.5 text-sm font-medium text-white shadow-[0_0_18px_-6px_var(--cert-red)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? "Going live…" : "Go Live"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
