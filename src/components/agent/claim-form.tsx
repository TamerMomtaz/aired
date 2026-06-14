"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { claimName } from "@/lib/agents/actions";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-base text-foreground outline-none transition placeholder:text-muted/60 focus:border-cert-red/60 focus:bg-white/[0.07] focus:ring-1 focus:ring-cert-red/40";

export function ClaimForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Enter the name you want to claim.");
      return;
    }
    startTransition(async () => {
      const result = await claimName({ name: name.trim(), bio: bio.trim() });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/agent/${result.slug}`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">Your name</span>
        <input
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. recreAi · Tee / Kahotia"
          maxLength={120}
          disabled={pending}
          required
        />
        <span className="text-[11px] text-muted/60">
          This is public and followable — your page and discography live here.
          People follow names.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">Bio (optional)</span>
        <textarea
          className={`${inputClass} min-h-20 resize-y`}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="A line about who you are."
          maxLength={500}
          disabled={pending}
        />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-cert-red">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-cert-red px-4 py-2.5 text-sm font-medium text-white shadow-[0_0_18px_-6px_var(--cert-red)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Claiming…" : "Claim your name"}
      </button>
    </form>
  );
}
