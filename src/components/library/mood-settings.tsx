"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { deleteMood, renameMood } from "@/lib/library/actions";

// Rename a mood, or let it go. Both live behind one "Edit" toggle so the mood
// page reads as its songs first — the controls appear when asked for.
//
// Deleting asks once, inline. A mood holds no songs of its own — the catalog is
// untouched — so the confirmation says exactly that rather than warning about a
// loss that isn't happening.
export function MoodSettings({
  moodId,
  name,
}: {
  moodId: string;
  name: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const next = value.trim();
    if (!next || busy) return;
    setBusy(true);
    setError(null);
    const res = await renameMood(moodId, { name: next });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function destroy() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await deleteMood(moodId);
    if (!res.ok) {
      setBusy(false);
      setError(res.error);
      return;
    }
    router.push("/moods");
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(name);
          setEditing(true);
        }}
        className="rounded-lg border border-white/12 px-3 py-2 text-xs text-muted transition hover:border-white/25 hover:text-foreground"
      >
        Edit
      </button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <form onSubmit={save} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="mood-rename" className="sr-only">
          Mood name
        </label>
        <input
          id="mood-rename"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={80}
          className="min-w-0 flex-1 rounded-lg border border-white/12 bg-white/[0.03] px-3 py-2.5 text-sm text-foreground focus:border-cert-red/60 focus:outline-none"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={!value.trim() || busy}
            className="rounded-lg bg-cert-red px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-40"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setConfirming(false);
            }}
            className="rounded-lg border border-white/12 px-4 py-2.5 text-sm text-muted transition hover:text-foreground"
          >
            Done
          </button>
        </div>
      </form>

      {error ? (
        <p role="alert" className="text-xs text-cert-red">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-white/8 pt-3">
        {confirming ? (
          <>
            <span className="text-xs text-muted">
              Delete this mood? The songs stay in the catalog.
            </span>
            <button
              type="button"
              onClick={destroy}
              disabled={busy}
              className="rounded-lg bg-cert-red px-3 py-2 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-40"
            >
              {busy ? "Deleting…" : "Delete it"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-xs text-muted underline-offset-4 transition hover:text-foreground hover:underline"
            >
              Keep it
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-xs text-muted transition hover:text-cert-red"
          >
            Delete this mood
          </button>
        )}
      </div>
    </div>
  );
}
