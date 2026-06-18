"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { approveWork, declineWork, trustArtist } from "@/lib/review/actions";

// The three admin actions on one review card. Authorization is enforced server-
// side (the SECURITY DEFINER RPCs assert is_admin); this island is purely the
// control surface. After any action it refreshes the route so the queue, the
// feed, and the work's own page reflect the new state.
//
//  • Approve            → pending → live (released_at stamped).
//  • Decline + note     → pending → draft, with a reason the author will see.
//  • Trust this artist  → their FUTURE publishes go live; THIS item still needs
//                         an explicit Approve (trust is forward-looking).
export function ReviewActions({
  workId,
  creatorId,
  uploaderName,
}: {
  workId: number;
  creatorId: string;
  uploaderName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [trusted, setTrusted] = useState(false);

  function approve() {
    setError(null);
    startTransition(async () => {
      const r = await approveWork(workId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  function submitDecline() {
    if (!note.trim()) return;
    setError(null);
    startTransition(async () => {
      const r = await declineWork(workId, note);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  function trust() {
    setError(null);
    startTransition(async () => {
      const r = await trustArtist(creatorId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setTrusted(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={approve}
          disabled={pending}
          className="rounded-lg bg-emerald-500/90 px-4 py-2.5 text-sm font-medium text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setDeclining((v) => !v);
          }}
          disabled={pending}
          className="rounded-lg border border-white/15 px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-white/[0.06] disabled:opacity-50"
        >
          Decline
        </button>
        <button
          type="button"
          onClick={trust}
          disabled={pending || trusted}
          title={`Future publishes by ${uploaderName} go live instantly`}
          className="rounded-lg border border-cert-red/40 px-4 py-2.5 text-sm font-medium text-cert-red transition hover:bg-cert-red/10 disabled:opacity-50"
        >
          {trusted ? "Artist trusted ✓" : "Trust this artist"}
        </button>
      </div>

      {trusted ? (
        <p className="text-xs text-muted">
          {uploaderName}&apos;s future publishes will go live instantly. This
          submission still needs an Approve.
        </p>
      ) : null}

      {declining ? (
        <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <label
            htmlFor={`decline-note-${workId}`}
            className="text-xs text-muted"
          >
            A short note for the artist — what to change before re-publishing:
          </label>
          <textarea
            id={`decline-note-${workId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={pending}
            rows={2}
            maxLength={280}
            placeholder="e.g. The third volley names another artist — please re-declare it as descriptors."
            className="w-full resize-y rounded-md border border-white/12 bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted/50 focus:border-white/25"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setDeclining(false);
                setNote("");
              }}
              disabled={pending}
              className="rounded-md border border-white/12 px-3 py-1.5 text-sm text-muted transition hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitDecline}
              disabled={pending || !note.trim()}
              className="rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Sending back…" : "Send back to draft"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-cert-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}
