"use client";

import { useEffect, useMemo, useRef } from "react";

import { parseLrc } from "@/lib/lyrics/lrc";

// The public "lit display": lyrics that follow the Red Line player. The active
// line glows cert-red and the rest dim; un-timed lyrics simply read as a static
// block. Driven entirely by `currentTime` from the player above (Phase 4).
export function SyncedLyrics({
  lyrics,
  currentTime,
}: {
  lyrics: string | null;
  currentTime: number;
}) {
  const lines = useMemo(() => parseLrc(lyrics), [lyrics]);
  const hasTiming = useMemo(() => lines.some((l) => l.t !== null), [lines]);

  // The lit line is the last one whose timestamp has passed.
  const activeIndex = useMemo(() => {
    if (!hasTiming) return -1;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].t;
      if (t !== null && t <= currentTime + 0.001) idx = i;
    }
    return idx;
  }, [lines, hasTiming, currentTime]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);

  // Karaoke anchor: hold the lit line at the container's center while lines
  // scroll underneath. All motion is scoped to the lyrics box — getBoundingClientRect
  // sidesteps offsetParent quirks so the page is never touched.
  useEffect(() => {
    if (activeIndex < 0) return;
    const container = containerRef.current;
    const el = lineRefs.current[activeIndex];
    if (!container || !el) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const elOffset = eRect.top - cRect.top + container.scrollTop;
    const top = elOffset - container.clientHeight / 2 + el.clientHeight / 2;
    container.scrollTo({
      top: Math.max(0, top),
      behavior: reduce ? "auto" : "smooth",
    });
  }, [activeIndex]);

  // Nothing to show: render nothing for the public (the owner's "Add lyrics"
  // affordance lives in the editor, not here).
  if (lines.length === 0 || lines.every((l) => l.text.trim() === "")) {
    return null;
  }

  // Un-timed lyrics: a calm, readable static block — no highlight, no scroll box.
  if (!hasTiming) {
    return (
      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-5 text-sm leading-relaxed text-foreground/80">
        {lines.map((l, i) => (
          <p key={i}>{l.text.trim() === "" ? " " : l.text}</p>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      aria-label="Lyrics"
      className="relative max-h-72 overflow-y-auto overscroll-contain rounded-xl border border-white/8 bg-white/[0.02] p-5"
    >
      <div className="flex flex-col gap-2">
        {lines.map((l, i) => {
          const active = i === activeIndex;
          return (
            <p
              key={i}
              ref={(el) => {
                lineRefs.current[i] = el;
              }}
              aria-current={active ? "true" : undefined}
              className={`text-base leading-snug motion-safe:transition-colors motion-safe:duration-300 ${
                active ? "font-semibold text-cert-red" : "text-muted/55"
              }`}
            >
              {l.text.trim() === "" ? " " : l.text}
            </p>
          );
        })}
      </div>
    </div>
  );
}
