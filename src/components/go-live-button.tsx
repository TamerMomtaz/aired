"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { goLive } from "@/lib/works/actions";

// Owner-only control that flips a draft work to live (Phase 4). Going live is
// also the moment the creator agrees to the AIRED Community Covenant — a small
// modal carries the summary, links to the full /terms page, and requires the
// checkbox before the Go Live button can fire. The action records the
// acceptance alongside the status flip. The parent on /registry/[id] only
// mounts this for the owner of a *draft*, so the visibility guard lives there;
// RLS is the real authorization — the action runs as the user, never the
// service role. One-directional for now: draft → live, no un-publish.
export function GoLiveButton({ workId }: { workId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openModal() {
    setError(null);
    setAccepted(false);
    setOpen(true);
  }

  function closeModal() {
    if (pending) return;
    setOpen(false);
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
  onClose,
  onConfirm,
}: {
  accepted: boolean;
  setAccepted: (v: boolean) => void;
  pending: boolean;
  error: string | null;
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
        <div className="flex flex-col gap-1.5">
          <h2
            id="covenant-heading"
            className="text-base font-semibold text-foreground"
          >
            The AIRED Covenant
          </h2>
          <p className="text-sm text-muted">
            AIRED celebrates what other places hide: music made by human and AI,
            together. We will never ban the collaboration. In return, we ask
            one thing.
          </p>
        </div>

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
      </div>
    </div>
  );
}
