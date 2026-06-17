"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  markOnboarded,
  ONBOARDING_REPLAY_EVENT,
  useOnboarded,
  useReducedMotion,
} from "./onboarding-state";

// First-visit onboarding — the front door for people Tee shares AIRED with.
//
// Three branded screens then a Matrix-pill entry. It's a client-side gate: it
// shows ONLY for a visitor who hasn't been onboarded AND who landed on the root
// ("/"). A shared /registry/[id] song link is never interrupted — they came for
// that track. Completing or skipping sets the single "aired_onboarded" flag so
// it never shows again; the footer's "intro" link clears it to replay.
//
// Mounted once in the root layout above everything (z-50; now-playing bar is
// z-30, header z-20). prefers-reduced-motion tones the motion right down.

type Step = 0 | 1 | 2;
type Side = "left" | "right";

export function Onboarding() {
  const pathname = usePathname();
  const onboarded = useOnboarded();
  const reduced = useReducedMotion();

  const [step, setStep] = useState<Step>(0);
  const [chosen, setChosen] = useState<Side | null>(null);
  const [pillsRevealed, setPillsRevealed] = useState(false);
  const [closing, setClosing] = useState(false);
  const [runId, setRunId] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const continueRef = useRef<HTMLButtonElement | null>(null);
  const leftPillRef = useRef<HTMLButtonElement | null>(null);

  const visible = !onboarded && pathname === "/";
  // With reduced motion the logo lands sharp instantly, so the pills are ready
  // the moment screen 3 appears; otherwise they wait for the de-pixelation.
  const pillsReady = reduced || pillsRevealed;

  // Replay (footer "intro" link): reset to the first screen and re-open. The
  // setState calls live in this subscription callback — the endorsed pattern —
  // not synchronously in an effect body.
  useEffect(() => {
    const onReplay = () => {
      setStep(0);
      setChosen(null);
      setPillsRevealed(false);
      setClosing(false);
      setRunId((n) => n + 1);
    };
    window.addEventListener(ONBOARDING_REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(ONBOARDING_REPLAY_EVENT, onReplay);
  }, []);

  // Lock the page behind the overlay while it's open.
  useEffect(() => {
    if (!visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [visible]);

  // Move focus to the live control whenever the step (or pill reveal) changes,
  // so keyboard users land somewhere useful and Enter does the obvious thing.
  useEffect(() => {
    if (!visible) return;
    const t = window.setTimeout(() => {
      if (step < 2) continueRef.current?.focus();
      else if (pillsReady) leftPillRef.current?.focus();
      else containerRef.current?.focus();
    }, 60);
    return () => window.clearTimeout(t);
  }, [visible, step, pillsReady]);

  // Screen 3: the AIRED mark resolves OUT of pixelation into the sharp lockup,
  // then the headline + pills fade in. Drawn on a canvas so we can animate the
  // sample resolution from coarse blocks up to crisp. Reduced motion skips the
  // pixel storm and presents the sharp mark straight away.
  useEffect(() => {
    if (!visible || step !== 2) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || 288;
    const cssH = canvas.clientHeight || 112;
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    canvas.width = w;
    canvas.height = h;

    // Sharp source — the AIRED wordmark above the glowing Red Line, the same
    // lockup the favicon/brand mark uses, drawn here in the page's Geist font.
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const octx = off.getContext("2d");
    if (!octx) return;

    const fontFamily =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--font-geist-sans")
        .trim() || "system-ui, sans-serif";

    const drawSharp = () => {
      octx.clearRect(0, 0, w, h);
      const fontPx = Math.round(h * 0.34);
      octx.fillStyle = "#ededed";
      octx.textAlign = "center";
      octx.textBaseline = "middle";
      octx.font = `800 ${fontPx}px ${fontFamily}`;
      const spaced = octx as CanvasRenderingContext2D & {
        letterSpacing?: string;
      };
      try {
        spaced.letterSpacing = `${Math.round(fontPx * 0.16)}px`;
      } catch {
        // letterSpacing unsupported — the wordmark just renders tighter.
      }
      octx.fillText("AIRED", w / 2, h * 0.4);

      const lineW = w * 0.6;
      const lineH = Math.max(3 * dpr, Math.round(h * 0.05));
      const lineX = (w - lineW) / 2;
      const lineY = h * 0.66;
      const r = lineH / 2;
      octx.save();
      octx.shadowColor = "#ff2d2d";
      octx.shadowBlur = lineH * 2.6;
      octx.fillStyle = "#ff2d2d";
      octx.beginPath();
      octx.moveTo(lineX + r, lineY);
      octx.arcTo(lineX + lineW, lineY, lineX + lineW, lineY + lineH, r);
      octx.arcTo(lineX + lineW, lineY + lineH, lineX, lineY + lineH, r);
      octx.arcTo(lineX, lineY + lineH, lineX, lineY, r);
      octx.arcTo(lineX, lineY, lineX + lineW, lineY, r);
      octx.closePath();
      octx.fill();
      octx.restore();
    };

    drawSharp();
    let cancelled = false;
    let finished = false;
    // Re-draw once the webfont is ready, in case Geist wasn't loaded on first
    // paint — and re-blit to the display if the reveal already completed, so the
    // final sharp frame never gets stuck in the fallback font.
    document.fonts?.ready.then(() => {
      if (cancelled) return;
      drawSharp();
      if (finished) {
        ctx.imageSmoothingEnabled = true;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(off, 0, 0);
      }
    });

    if (reduced) {
      finished = true;
      ctx.imageSmoothingEnabled = true;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(off, 0, 0);
      return () => {
        cancelled = true;
      };
    }

    // Block buffer reused each frame: downscale sharp -> tiny, then upscale tiny
    // -> full with smoothing off, giving chunky pixels that shrink toward crisp.
    const small = document.createElement("canvas");
    small.width = w;
    small.height = h;
    const sctx = small.getContext("2d");
    if (!sctx) return;

    const DURATION = 1150;
    const MIN = 0.05;
    const start = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      const eased = 1 - Math.pow(1 - t, 3);

      if (t >= 1) {
        finished = true;
        ctx.imageSmoothingEnabled = true;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(off, 0, 0);
        setPillsRevealed(true); // in a rAF callback, not the effect body
        return;
      }

      const scale = MIN + (1 - MIN) * eased;
      const sw = Math.max(1, Math.round(w * scale));
      const sh = Math.max(1, Math.round(h * scale));

      sctx.imageSmoothingEnabled = false;
      sctx.clearRect(0, 0, w, h);
      sctx.drawImage(off, 0, 0, w, h, 0, 0, sw, sh);

      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(small, 0, 0, sw, sh, 0, 0, w, h);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [visible, step, runId, reduced]);

  const advance = useCallback(() => {
    setStep((s) => (s < 2 ? ((s + 1) as Step) : s));
  }, []);

  // Fade the overlay out, then flip the flag — which unmounts it and reveals
  // the Listen page underneath. The flag is set last so a reload mid-animation
  // simply shows the intro again rather than a half-finished state.
  const finish = useCallback(() => {
    setClosing(true);
    window.setTimeout(markOnboarded, 480);
  }, []);

  const choosePill = useCallback(
    (side: Side) => {
      if (chosen) return;
      setChosen(side); // lock to solid red + pulse; the other pill fades out
      window.setTimeout(finish, 680);
    },
    [chosen, finish],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const root = containerRef.current;
    if (!root) return;

    if (e.key === "Tab") {
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
      return;
    }

    if (step < 2 && (e.key === "ArrowRight" || e.key === "Enter")) {
      // Enter on a focused button is its own action (Continue / Skip); only
      // hijack Enter when focus is resting on the dialog shell itself.
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (e.key === "ArrowRight" || (tag !== "button" && tag !== "a")) {
        e.preventDefault();
        advance();
      }
    }
  };

  if (!visible) return null;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to AIRED"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={[
        "fixed inset-0 z-50 overflow-y-auto outline-none",
        "bg-background text-foreground",
        "transition-opacity duration-[460ms] ease-out motion-reduce:transition-none",
        closing ? "opacity-0" : "opacity-100",
      ].join(" ")}
    >
      {/* Vignette — pull focus to the centre, fade the edges to pure black. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 38%, transparent 40%, rgba(0,0,0,0.55) 100%)",
        }}
      />

      <button
        type="button"
        onClick={finish}
        className="fixed right-4 top-4 z-10 rounded-md px-3 py-1.5 text-xs text-muted/70 transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cert-red/50"
      >
        Skip
      </button>

      <div className="relative z-[1] flex min-h-dvh flex-col items-center justify-center gap-10 px-6 py-16 text-center">
        <div
          key={`${step}-${runId}`}
          className="onboard-step flex w-full max-w-xl flex-col items-center"
        >
          {step === 0 && <ScreenOne />}
          {step === 1 && <ScreenTwo />}
          {step === 2 && (
            <ScreenThree
              canvasRef={canvasRef}
              leftPillRef={leftPillRef}
              pillsReady={pillsReady}
              reduced={reduced}
              chosen={chosen}
              onChoose={choosePill}
            />
          )}
        </div>

        {step < 2 && (
          <button
            ref={continueRef}
            type="button"
            onClick={advance}
            className="group inline-flex items-center gap-2 rounded-full border border-cert-red/40 bg-cert-red/10 px-6 py-2.5 text-sm font-medium text-foreground transition hover:bg-cert-red/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cert-red/60"
          >
            Continue
            <span
              aria-hidden
              className="transition-transform group-hover:translate-x-0.5"
            >
              →
            </span>
          </button>
        )}

        <Dots step={step} />
      </div>
    </div>
  );
}

function BrandLockup({ className }: { className?: string }) {
  return (
    <div className={`flex flex-col items-center gap-2 ${className ?? ""}`}>
      <span className="text-sm font-semibold tracking-[0.34em] text-foreground/90">
        AIRED
      </span>
      <span
        aria-hidden
        className="h-[3px] w-20 rounded-full bg-cert-red"
        style={{
          boxShadow:
            "0 0 12px color-mix(in srgb, var(--cert-red) 70%, transparent)",
        }}
      />
    </div>
  );
}

function ScreenOne() {
  return (
    <div className="flex flex-col items-center">
      <span className="text-5xl font-extrabold tracking-[0.16em] text-foreground sm:text-6xl">
        AIRED<span className="text-cert-red">.</span>
      </span>
      <span
        aria-hidden
        className="mt-4 h-[3px] w-24 rounded-full bg-cert-red"
        style={{
          boxShadow:
            "0 0 14px color-mix(in srgb, var(--cert-red) 75%, transparent)",
        }}
      />
      <p className="mt-8 text-balance text-lg leading-relaxed text-foreground sm:text-xl">
        The first place a carbon mind and a silicon mind stand credited side by
        side, by name.
      </p>
      <p className="mt-4 text-balance text-base leading-relaxed text-muted">
        Every work here is a band — Human + AI, together, out loud.
      </p>
    </div>
  );
}

function ScreenTwo() {
  return (
    <div className="flex flex-col items-center">
      <BrandLockup />
      <p className="mt-8 text-balance text-lg leading-relaxed text-foreground sm:text-xl">
        You can <span className="font-semibold text-foreground">listen</span> —
        to art no one made alone. Or you can{" "}
        <span className="font-semibold text-foreground">make</span> — upload your
        work and name every hand that touched it, carbon and silicon, in the{" "}
        <span className="font-semibold text-cert-red">Volley Ledger</span>.
      </p>
      <p className="mt-4 text-base leading-relaxed text-muted">
        Nothing hidden. Everyone credited.
      </p>
    </div>
  );
}

function ScreenThree({
  canvasRef,
  leftPillRef,
  pillsReady,
  reduced,
  chosen,
  onChoose,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  leftPillRef: React.RefObject<HTMLButtonElement | null>;
  pillsReady: boolean;
  reduced: boolean;
  chosen: Side | null;
  onChoose: (side: Side) => void;
}) {
  return (
    <div className="flex flex-col items-center">
      <canvas
        ref={canvasRef}
        aria-hidden
        className="h-28 w-72 sm:h-32 sm:w-80"
      />

      <div
        className={[
          "mt-8 flex flex-col items-center gap-7 transition-all duration-700 ease-out motion-reduce:transition-none",
          pillsReady
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-2 opacity-0",
        ].join(" ")}
      >
        <h2 className="text-2xl font-semibold text-foreground sm:text-3xl">
          Start your journey
        </h2>

        <div
          role="group"
          aria-label="Choose a pill to enter AIRED"
          className="flex items-center gap-6 sm:gap-8"
        >
          <Pill
            side="left"
            buttonRef={leftPillRef}
            chosen={chosen}
            reduced={reduced}
            disabled={!pillsReady}
            onChoose={onChoose}
          />
          <Pill
            side="right"
            chosen={chosen}
            reduced={reduced}
            disabled={!pillsReady}
            onChoose={onChoose}
          />
        </div>

        <p className="max-w-xs text-balance text-sm leading-relaxed text-muted">
          At AIRED, both pills are red. There&rsquo;s no going back to sleep.
        </p>
      </div>
    </div>
  );
}

function Pill({
  side,
  buttonRef,
  chosen,
  reduced,
  disabled,
  onChoose,
}: {
  side: Side;
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
  chosen: Side | null;
  reduced: boolean;
  disabled: boolean;
  onChoose: (side: Side) => void;
}) {
  const isChosen = chosen === side;
  const isOther = chosen !== null && !isChosen;
  const staticColor =
    side === "left" ? "onboard-pill-static-red" : "onboard-pill-static-blue";

  // While undecided: shimmer (or a static colour under reduced motion). The
  // right pill starts half a cycle in via a negative delay, so it's blue while
  // the left is red — the Matrix back-and-forth.
  const idleClass = reduced ? staticColor : "onboard-pill";

  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={disabled}
      onClick={() => onChoose(side)}
      aria-label="Enter AIRED"
      style={
        !reduced && !chosen && side === "right"
          ? { animationDelay: "-1.6s" }
          : undefined
      }
      className={[
        "relative h-12 w-28 overflow-hidden rounded-full sm:h-14 sm:w-36",
        "transition-all duration-500 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        isChosen
          ? "onboard-pill-chosen"
          : isOther
            ? `${staticColor} scale-90 opacity-0`
            : idleClass,
        disabled ? "cursor-default" : "cursor-pointer hover:brightness-110",
      ].join(" ")}
    >
      {/* Capsule gloss — a soft specular highlight along the top. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-4 top-1.5 h-1/3 rounded-full bg-white/25 blur-[2px]"
      />
    </button>
  );
}

function Dots({ step }: { step: Step }) {
  return (
    <div
      role="group"
      aria-label={`Screen ${step + 1} of 3`}
      className="flex items-center gap-2"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          className={[
            "h-1.5 rounded-full transition-all duration-300",
            i === step
              ? "w-6 bg-cert-red"
              : i < step
                ? "w-1.5 bg-foreground/40"
                : "w-1.5 bg-white/15",
          ].join(" ")}
          style={
            i === step
              ? {
                  boxShadow:
                    "0 0 8px color-mix(in srgb, var(--cert-red) 70%, transparent)",
                }
              : undefined
          }
        />
      ))}
    </div>
  );
}
