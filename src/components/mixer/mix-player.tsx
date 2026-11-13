"use client";

import { useEffect, useRef, useState } from "react";

import { formatDuration } from "@/lib/format";

export type PlayerPart = { at: number; label: string };

// The finished mix's own player: a big play button, a clock you can read at a
// glance and a bar to drag. It names the part that is playing, so a rough spot
// can be reported as "3:21, while Song X plays on". It is the page's only
// <audio>; pressing play pauses the global player so two things never sound
// at once.
export function MixPlayer({
  url,
  seconds,
  parts,
  onPlay,
}: {
  url: string;
  seconds: number;
  parts: PlayerPart[];
  onPlay: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(seconds);

  // A finished mix lands below the controls; bring it into view.
  useEffect(() => {
    boxRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [url]);

  const now = currentPart(parts, time);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => setPlaying(false));
    else a.pause();
  }

  function seek(to: number) {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(to, length));
    setTime(a.currentTime);
  }

  return (
    <div ref={boxRef} className="club-player flex flex-col gap-3 rounded-xl p-4">
      <audio
        ref={audioRef}
        src={url}
        preload="auto"
        onPlay={() => {
          onPlay();
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setLength(d);
        }}
      />
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause the mix" : "Play the mix"}
          className="club-player-btn flex size-14 shrink-0 items-center justify-center rounded-full text-xl font-bold"
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="flex min-w-0 flex-col">
          <p className="club-player-clock tabular-nums" aria-live="off">
            {formatDuration(Math.floor(time))}
            <span className="club-player-total"> / {formatDuration(Math.round(length))}</span>
          </p>
          {now ? <p className="truncate text-xs text-foreground/80">Now: {now}</p> : null}
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(1, length)}
        step={0.1}
        value={Math.min(time, length)}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label="Position in the mix"
        className="club-player-bar w-full"
      />
      <div className="flex gap-2">
        <button type="button" onClick={() => seek(time - 10)} className="club-player-skip">
          − 10 s
        </button>
        <button type="button" onClick={() => seek(time + 10)} className="club-player-skip">
          + 10 s
        </button>
      </div>
    </div>
  );
}

function currentPart(parts: PlayerPart[], t: number): string | null {
  let label: string | null = null;
  for (const p of parts) {
    if (p.at <= t + 0.05) label = p.label;
    else break;
  }
  return label;
}
