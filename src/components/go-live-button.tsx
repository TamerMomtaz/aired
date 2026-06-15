"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { goLive } from "@/lib/works/actions";

// Owner-only control that flips a draft work to live (Phase 4). The parent on
// /registry/[id] only mounts this for the owner of a *draft*, so the visibility
// guard lives there; here we just confirm intent and call the action. RLS is the
// real authorization — the action runs as the user, never the service role.
// One-directional for now: draft → live, no un-publish.
export function GoLiveButton({ workId }: { workId: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onClick() {
    setError(null);
    if (
      !window.confirm(
        "Make this public? Anyone with the link will be able to stream it.",
      )
    ) {
      return;
    }

    startTransition(async () => {
      const result = await goLive(workId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The guard above now hides this button; refresh to reflect the live state.
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="self-start rounded-lg bg-cert-red px-4 py-2.5 text-sm font-medium text-white shadow-[0_0_18px_-6px_var(--cert-red)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Going live…" : "Go Live"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-cert-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}
