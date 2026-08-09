"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createMood } from "@/lib/library/actions";

// Name a mood into existence. Deliberately one field: the naming is the whole
// act, and anything else asked here would be a form standing between a listener
// and the thing they wanted.
export function MoodCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    const res = await createMood({ name: value });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setName("");
    router.push(`/moods/${res.moodId}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <label htmlFor="mood-name" className="sr-only">
          Name a new mood
        </label>
        <input
          id="mood-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="Name a mood…"
          className="min-w-0 flex-1 rounded-lg border border-white/12 bg-white/[0.03] px-3 py-2.5 text-sm text-foreground placeholder:text-muted/40 focus:border-cert-red/60 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!name.trim() || busy}
          className="shrink-0 rounded-lg bg-cert-red px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {busy ? "Making…" : "Make it"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-cert-red">
          {error}
        </p>
      ) : null}
    </form>
  );
}
