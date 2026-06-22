"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { formatDuration } from "@/lib/format";
import { setTeaserClip } from "@/lib/works/actions";

// TEASER CLIP (PART A) — let the owner art-direct WHICH slice of a song becomes
// its share video (Reels / TikTok / IG clip). The video used to always grab the
// first ~40s; the hook is often the drop or chorus, so the creator picks the
// window here. Saves the two per-song columns through setTeaserClip
// (work_owner_upd → owner-only). The worker re-clamps against the real duration
// and is the authority — this UI only nudges the inputs into range for instant
// feedback. Changing the window re-renders the clip on the next share (the R2
// cache key is versioned by start + length).

const MIN_LENGTH = 20;
const MAX_LENGTH = 50;
const DEFAULT_LENGTH = 40;
const MIN_TAIL = 5; // the worker keeps ≥5s of song after the start

const fieldClass =
  "w-24 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted/50 focus:border-cert-red/60 focus:ring-1 focus:ring-cert-red/40 disabled:opacity-50";

// "mm:ss" / "h:mm:ss" / plain seconds → whole seconds (≥0), or null if it isn't a
// clean time. Each colon-separated part must be digits-only.
function parseTime(value: string): number | null {
  const v = value.trim();
  if (!v) return 0;
  const parts = v.split(":");
  if (parts.length > 3) return null;
  let total = 0;
  for (const part of parts) {
    const p = part.trim();
    if (!/^\d+$/.test(p)) return null;
    total = total * 60 + Number(p);
  }
  return total;
}

export function TeaserClipEditor({
  workId,
  durationSeconds,
  initialStartSeconds,
  initialLengthSeconds,
}: {
  workId: number;
  durationSeconds: number;
  initialStartSeconds: number | null;
  initialLengthSeconds: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [startText, setStartText] = useState(
    formatDuration(initialStartSeconds ?? 0),
  );
  const [lengthText, setLengthText] = useState(
    String(initialLengthSeconds ?? DEFAULT_LENGTH),
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSaved(false);

    const startParsed = parseTime(startText);
    if (startParsed === null) {
      setError("Start must be mm:ss or a number of seconds.");
      return;
    }
    const lengthParsed = Number(lengthText.trim());
    if (!Number.isFinite(lengthParsed) || lengthParsed <= 0) {
      setError("Length must be a number of seconds.");
      return;
    }

    // Nudge into range for instant feedback (the worker re-clamps for real).
    const length = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.round(lengthParsed)));
    const maxStart = Math.max(0, Math.round(durationSeconds) - MIN_TAIL);
    const start = Math.min(Math.max(0, Math.round(startParsed)), maxStart);

    startTransition(async () => {
      const result = await setTeaserClip(workId, {
        startSeconds: start,
        lengthSeconds: length,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Reflect what was actually stored (incl. the clamp) back into the inputs.
      setStartText(formatDuration(start));
      setLengthText(String(length));
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="basis-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="rounded-lg border border-white/12 px-3.5 py-2 text-sm text-foreground transition hover:bg-white/[0.06]"
      >
        Teaser clip
      </button>

      {open ? (
        <div className="mt-3 flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <p className="text-xs text-muted">
            Pick the slice that becomes this song&apos;s video — the hook is often
            the drop or chorus, not the intro.
          </p>

          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted/60">
                Start
              </span>
              <input
                className={fieldClass}
                value={startText}
                onChange={(e) => setStartText(e.target.value)}
                inputMode="numeric"
                placeholder="0:45"
                disabled={pending}
                aria-label="Teaser clip start (mm:ss or seconds)"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted/60">
                Length (s)
              </span>
              <input
                className={fieldClass}
                value={lengthText}
                onChange={(e) => setLengthText(e.target.value)}
                inputMode="numeric"
                type="number"
                min={MIN_LENGTH}
                max={MAX_LENGTH}
                placeholder={String(DEFAULT_LENGTH)}
                disabled={pending}
                aria-label="Teaser clip length in seconds"
              />
            </label>

            <div className="flex flex-col gap-0.5 pb-1">
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted/60">
                Song length
              </span>
              <span className="font-mono text-sm text-muted">
                {formatDuration(durationSeconds)}
              </span>
            </div>

            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded-lg bg-cert-red px-4 py-2 text-sm font-medium text-white shadow-[0_0_18px_-6px_var(--cert-red)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>

          <p className="text-[11px] text-muted/70">
            Start as mm:ss or seconds · length {MIN_LENGTH}–{MAX_LENGTH}s (default{" "}
            {DEFAULT_LENGTH}). Kept inside the song automatically.
          </p>

          {error ? (
            <p role="alert" className="text-xs text-cert-red">
              {error}
            </p>
          ) : saved ? (
            <p className="text-xs text-emerald-300">
              Saved — the next video for this song uses this window.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
