"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

// Kahotia himself, as the talk box: his full portrait (burlap half, blue half,
// arms crossed). While he talks, his stitched zigzag mouth comes alive as a
// moving wave that opens and closes with the words, and what he says is typed
// out across his crossed arms, keeping pace with the voice.
//
// Where things sit on the portrait (public/kahotia/portrait.jpg, 504×571):
// the mouth runs from x 170 to 298 around y 232; the crossed arms fill the
// bottom quarter. The overlays below are placed in percentages of those.

const W = 128; // mouth drawing width (viewBox units)
const H = 32; // mouth drawing height
const STEPS = 64;

// The stitched mouth: a zigzag that, while talking, travels like a wave and
// parts in the middle (darker inside), widest at the centre like real lips.
function mouthPaths(open: number, phase: number, zig: number) {
  const upper: string[] = [];
  const lower: string[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const x = (i / STEPS) * W;
    const t = x / W;
    const lips = Math.sin(Math.PI * t); // 0 at the corners, 1 in the middle
    const wave =
      zig * Math.sin(2 * Math.PI * 6.5 * t + phase) * (0.35 + 0.65 * lips);
    const mid = H / 2;
    upper.push(`${x.toFixed(1)},${(mid - open * lips + wave).toFixed(2)}`);
    lower.push(`${x.toFixed(1)},${(mid + open * lips + wave).toFixed(2)}`);
  }
  const top = `M${upper.join(" L")}`;
  const bottom = `M${lower.join(" L")}`;
  const cavity = `M${upper.join(" L")} L${lower.reverse().join(" L")} Z`;
  return { top, bottom, cavity };
}

function TalkingMouth({ speaking, beat }: { speaking: boolean; beat: number }) {
  const topRef = useRef<SVGPathElement | null>(null);
  const bottomRef = useRef<SVGPathElement | null>(null);
  const cavityRef = useRef<SVGPathElement | null>(null);
  const energyRef = useRef(0);

  // Every word the voice reports gives the mouth a fresh push.
  useEffect(() => {
    energyRef.current = 1;
  }, [beat]);

  useEffect(() => {
    if (!speaking) return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let raf = 0;
    let last = performance.now();
    let phase = 0;
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      phase += dt * (reduce ? 1.5 : 7);
      energyRef.current = Math.max(0, energyRef.current - dt * 2.2);
      const s = now / 1000;
      // A syllable rhythm, so the mouth moves even on phones that don't
      // report words, lifted further by each reported word.
      const syllable =
        Math.max(0, Math.sin(s * 11.5)) * (0.55 + 0.45 * Math.sin(s * 3.1));
      const open = (reduce ? 2.5 : 2 + 8 * syllable) + 4 * energyRef.current;
      const p = mouthPaths(open, phase, 8.5);
      topRef.current?.setAttribute("d", p.top);
      bottomRef.current?.setAttribute("d", p.bottom);
      cavityRef.current?.setAttribute("d", p.cavity);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [speaking]);

  const rest = mouthPaths(0, 0, 8.5);
  return (
    <>
      {/* Softens the painted stitch underneath while the live mouth moves, so
          only one mouth is seen. */}
      <div
        aria-hidden
        className={`pointer-events-none absolute left-[32.5%] top-[36%] h-[9.5%] w-[28%] backdrop-blur-[5px] transition-opacity duration-200 [mask-image:radial-gradient(ellipse_at_center,black_55%,transparent_75%)] ${speaking ? "opacity-100" : "opacity-0"}`}
      />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        aria-hidden
        className={`pointer-events-none absolute left-[33.7%] top-[37.8%] h-[5.6%] w-[25.4%] overflow-visible transition-opacity duration-200 ${speaking ? "opacity-100" : "opacity-0"}`}
      >
        <defs>
          {/* Burlap thread on the doll's side, steel stitch on the blue side. */}
          <linearGradient id="kahotia-thread" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#e6d9b8" />
            <stop offset="0.52" stopColor="#d9ccab" />
            <stop offset="0.56" stopColor="#b7c3d0" />
            <stop offset="1" stopColor="#a9b6c4" />
          </linearGradient>
          <filter
            id="kahotia-soft"
            x="-10%"
            y="-60%"
            width="120%"
            height="220%"
          >
            <feGaussianBlur stdDeviation="0.6" />
          </filter>
        </defs>
        <path
          ref={cavityRef}
          d={rest.cavity}
          fill="#140a06"
          fillOpacity="0.88"
          filter="url(#kahotia-soft)"
        />
        <path
          ref={topRef}
          d={rest.top}
          fill="none"
          stroke="url(#kahotia-thread)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          ref={bottomRef}
          d={rest.bottom}
          fill="none"
          stroke="url(#kahotia-thread)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeOpacity="0.85"
        />
      </svg>
    </>
  );
}

// What Kahotia says, typed across his crossed arms as he says it.
function ArmsText({
  line,
  speaking,
  spoken,
}: {
  line: string;
  speaking: boolean;
  spoken: number;
}) {
  const [typed, setTyped] = useState({ line, chars: 0 });
  const chars = typed.line === line ? typed.chars : 0;

  useEffect(() => {
    if (!speaking) return;
    const id = window.setInterval(() => {
      setTyped((t) =>
        t.line === line
          ? { line, chars: Math.min(line.length, t.chars + 1) }
          : { line, chars: 1 },
      );
    }, 65);
    return () => window.clearInterval(id);
  }, [line, speaking]);

  // Never behind the voice, and the whole line once he's done talking.
  const shown = speaking
    ? Math.min(line.length, Math.max(chars, spoken))
    : line.length;
  const text = line.slice(0, shown);
  const typing = speaking && shown < line.length;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[34%] flex-col justify-end overflow-hidden bg-gradient-to-t from-[#06142e]/80 via-[#06142e]/45 to-transparent px-[6%] pb-[4%] [mask-image:linear-gradient(to_bottom,transparent,black_22%)]">
      <p
        dir="auto"
        aria-live="polite"
        className="w-full text-center text-[14px] font-semibold leading-snug tracking-wide text-[#f3f7ff] [text-shadow:0_1px_2px_rgba(4,16,48,0.95),0_0_12px_rgba(47,116,224,0.55)] sm:text-base"
      >
        {text}
        {typing ? (
          <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-[#f3f7ff] motion-reduce:animate-none" />
        ) : null}
      </p>
    </div>
  );
}

export function KahotiaStage({
  line,
  speaking,
  spoken,
  listening,
  thinking,
  heard,
  ar,
}: {
  line: string;
  speaking: boolean;
  spoken: number;
  listening: boolean;
  thinking: boolean;
  heard: string;
  ar: boolean;
}) {
  return (
    <div className="relative mx-auto aspect-[504/571] w-full max-w-[calc(48dvh*504/571)] shrink-0 overflow-hidden rounded-2xl bg-gradient-to-r from-[#e8902a] to-[#2f74e0] p-[2px] shadow-[0_0_40px_-12px_rgba(47,116,224,0.8)]">
      <div className="relative size-full overflow-hidden rounded-[14px] bg-black">
        <Image
          src="/kahotia/portrait.jpg"
          alt="Kahotia, half burlap doll and half blue man, arms crossed"
          fill
          priority
          sizes="(max-width: 640px) 100vw, 420px"
          className="object-cover"
        />
        <TalkingMouth speaking={speaking} beat={spoken} />

        {listening || thinking ? (
          <div className="absolute inset-x-[6%] top-[4%] flex justify-center">
            <p
              dir="auto"
              className="max-w-full rounded-full bg-black/60 px-3.5 py-1.5 text-center text-xs text-white/90 backdrop-blur"
            >
              {thinking
                ? ar
                  ? "كاهوتيا بيفكّر…"
                  : "Kahotia is thinking…"
                : heard || (ar ? "سامعك…" : "I'm listening…")}
            </p>
          </div>
        ) : null}

        <ArmsText line={line} speaking={speaking} spoken={spoken} />
      </div>
    </div>
  );
}
