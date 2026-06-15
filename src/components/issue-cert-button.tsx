"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { issueCertificate } from "@/lib/works/actions";

// Owner-only control that mints the Red Line certificate for a live work (Phase
// 4 #2). The parent on /registry/[id] only mounts this when isOwner &&
// status==='live' && no cert exists; once issued, that branch flips to the
// public "View Certificate →" link. RLS is the real authorization — the action
// runs as the user, never the service role. The cert is immutable (no UPDATE /
// DELETE policy), so this is one-shot per work.
export function IssueCertButton({ workId }: { workId: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onClick() {
    setError(null);
    startTransition(async () => {
      const result = await issueCertificate(workId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
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
        {pending ? "Issuing…" : "Issue Red Line Certificate"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-cert-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}
