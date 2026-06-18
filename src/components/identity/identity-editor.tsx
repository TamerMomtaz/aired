"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { HandleHint, useHandleCheck } from "@/components/identity/handle-field";
import {
  emptyPick,
  ImageField,
  type ImagePick,
  resolveImagePick,
} from "@/components/identity/image-field";
import { updateIdentity } from "@/lib/identity/actions";
import { handleError, slugifyHandle } from "@/lib/identity/handle";

// The identity editor form (/settings) — the same fields the first-run wizard
// sets, available anytime. Saves through updateIdentity (owner RLS). Shares the
// handle live-check and image picker with the wizard.

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-base text-foreground outline-none transition placeholder:text-muted/60 focus:border-cert-red/60 focus:bg-white/[0.07] focus:ring-1 focus:ring-cert-red/40 disabled:opacity-60";
const labelText = "text-xs font-medium text-muted";
const primaryBtn =
  "rounded-lg bg-cert-red px-5 py-2.5 text-sm font-medium text-white shadow-[0_0_18px_-6px_var(--cert-red)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";

type Initial = {
  displayName: string;
  handle: string;
  bio: string;
  avatarUrl: string | null;
  mascotName: string;
  mascotAvatarUrl: string | null;
};

export function IdentityEditor({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [handle, setHandle] = useState(initial.handle);
  const [bio, setBio] = useState(initial.bio);
  const [avatar, setAvatar] = useState<ImagePick>(emptyPick(initial.avatarUrl));
  const [mascotName, setMascotName] = useState(initial.mascotName);
  const [mascotAvatar, setMascotAvatar] = useState<ImagePick>(
    emptyPick(initial.mascotAvatarUrl),
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedHandle, setSavedHandle] = useState<string | null>(null);

  const handleFmtError = useMemo(
    () => (handle ? handleError(handle) : null),
    [handle],
  );
  const { avail } = useHandleCheck(handle, handleFmtError);

  async function save() {
    setError(null);
    setSavedHandle(null);
    if (!displayName.trim()) {
      setError("Give your artist a name.");
      return;
    }
    if (handleFmtError) {
      setError(handleFmtError);
      return;
    }
    setBusy(true);
    try {
      const [avatarUrl, mascotAvatarUrl] = await Promise.all([
        resolveImagePick(avatar),
        resolveImagePick(mascotAvatar),
      ]);
      const res = await updateIdentity({
        displayName,
        handle,
        bio,
        avatarUrl,
        mascotName,
        mascotAvatarUrl,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSavedHandle(slugifyHandle(handle));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <label className="flex flex-col gap-1.5">
        <span className={labelText}>Artist name</span>
        <input
          className={inputClass}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your artist name"
          maxLength={80}
          disabled={busy}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelText}>Handle</span>
        <div className="flex items-center gap-2">
          <span className="select-none text-sm text-muted/70">
            ai-red.io/artist/
          </span>
          <input
            className={inputClass}
            value={handle}
            onChange={(e) => setHandle(slugifyHandle(e.target.value))}
            placeholder="your-handle"
            maxLength={32}
            disabled={busy}
            inputMode="text"
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>
        <HandleHint handle={handle} fmtError={handleFmtError} avail={avail} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelText}>Bio</span>
        <textarea
          className={`${inputClass} min-h-20 resize-y`}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="A line or two about you and your sound."
          maxLength={600}
          disabled={busy}
        />
      </label>

      <ImageField
        label="Avatar"
        pick={avatar}
        onPick={setAvatar}
        disabled={busy}
        shape="round"
      />

      <div className="h-px bg-white/8" />

      <label className="flex flex-col gap-1.5">
        <span className={labelText}>Mascot name</span>
        <input
          className={inputClass}
          value={mascotName}
          onChange={(e) => setMascotName(e.target.value)}
          placeholder="The emblem of your voices (e.g. Kahotia)"
          maxLength={80}
          disabled={busy}
        />
      </label>

      <ImageField
        label="Mascot image"
        pick={mascotAvatar}
        onPick={setMascotAvatar}
        disabled={busy}
        shape="round"
      />

      {error ? (
        <p role="alert" className="text-sm text-cert-red">
          {error}
        </p>
      ) : null}

      {savedHandle ? (
        <p className="text-sm text-emerald-400">
          Saved.{" "}
          <Link
            href={`/artist/${savedHandle}`}
            className="underline-offset-4 hover:underline"
          >
            View your artist page →
          </Link>
        </p>
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={busy || !displayName.trim() || !!handleFmtError}
          className={primaryBtn}
        >
          {busy ? "Saving…" : "Save identity"}
        </button>
      </div>
    </div>
  );
}
