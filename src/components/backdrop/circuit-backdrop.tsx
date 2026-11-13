"use client";

import { useEffect, useRef } from "react";

// The living circuit behind Brushed Onyx (Tee's facelift, round two).
//
// A board of fine traces — silver mostly, a few in gold and in blue — is drawn
// once to an offscreen canvas. On top of it, a handful of light pulses run
// along the traces in neon blue, gold and silver, like signal moving through a
// machine. It sits on a fixed layer behind the whole app: it never scrolls,
// never catches a tap, and a radial mask keeps it quiet behind the middle of
// the screen, where the reading happens, and fuller toward the edges.
//
// Cheap on purpose (AIRED is played in cars, on phones): 30 frames a second at
// most, device pixel ratio capped at 1.5, paused whenever the tab is hidden,
// and frozen still for anyone who asks their device for reduced motion.

const CELL = 26; // grid pitch in CSS px — traces run on this grid
const FPS = 30;
const PULSE_SPEED = 70; // CSS px per second
const PULSE_TAIL = 70; // CSS px of glowing tail

type Pt = { x: number; y: number };
type Trace = { pts: Pt[]; len: number; cum: number[] };
type Pulse = { trace: Trace; at: number; color: string };

const TRACE_INKS = [
  "rgba(205, 210, 222, 0.12)", // silver
  "rgba(205, 210, 222, 0.12)",
  "rgba(214, 186, 128, 0.13)", // gold
  "rgba(214, 186, 128, 0.13)", // gold
  "rgba(70, 150, 255, 0.13)", // blue
];
// Warmed for the mood lift: gold and amber lead, blue still runs through.
const PULSE_INKS = ["#e6c27a", "#ffb36b", "#47a8ff", "#eef1f7", "#e6c27a"];

// Eight directions; diagonals are rarer, the way a real board routes.
const DIRS: Pt[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
  { x: 1, y: -1 },
];

function rand(n: number) {
  return Math.floor(Math.random() * n);
}

function buildTraces(w: number, h: number): Trace[] {
  const cols = Math.ceil(w / CELL) + 1;
  const rows = Math.ceil(h / CELL) + 1;
  const used = new Set<number>();
  const count = Math.max(14, Math.round((w * h) / 16000));
  const traces: Trace[] = [];

  for (let t = 0; t < count * 3 && traces.length < count; t++) {
    let cx = rand(cols);
    let cy = rand(rows);
    if (used.has(cy * cols + cx)) continue;
    let dir = rand(4);
    const steps = 4 + rand(12);
    const pts: Pt[] = [{ x: cx * CELL, y: cy * CELL }];
    let sinceTurn = 0;
    for (let s = 0; s < steps; s++) {
      if (sinceTurn > 2 && Math.random() < 0.28) {
        // Bend by 45°, staying mostly orthogonal.
        const turn = Math.random() < 0.5 ? 1 : -1;
        dir = dir < 4 ? (Math.random() < 0.5 ? 4 + ((dir + (turn > 0 ? 0 : 3)) % 4) : (dir + turn + 4) % 4) : rand(4);
        sinceTurn = 0;
      }
      const d = DIRS[dir];
      const nx = cx + d.x;
      const ny = cy + d.y;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) break;
      const key = ny * cols + nx;
      if (used.has(key)) break;
      used.add(key);
      cx = nx;
      cy = ny;
      sinceTurn++;
      const last = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      const p = { x: cx * CELL, y: cy * CELL };
      // Merge straight runs into one segment.
      if (prev && Math.sign(p.x - last.x) === Math.sign(last.x - prev.x) && Math.sign(p.y - last.y) === Math.sign(last.y - prev.y)) {
        pts[pts.length - 1] = p;
      } else {
        pts.push(p);
      }
    }
    if (pts.length < 2) continue;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
    const len = cum[cum.length - 1];
    if (len < CELL * 3) continue;
    traces.push({ pts, len, cum });
  }
  return traces;
}

function pointAt(tr: Trace, d: number): Pt {
  const dd = Math.max(0, Math.min(tr.len, d));
  let i = 1;
  while (i < tr.cum.length - 1 && tr.cum[i] < dd) i++;
  const a = tr.pts[i - 1];
  const b = tr.pts[i];
  const seg = tr.cum[i] - tr.cum[i - 1] || 1;
  const k = (dd - tr.cum[i - 1]) / seg;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

// The stretch of a trace between two distances, as a polyline.
function slice(tr: Trace, from: number, to: number): Pt[] {
  const out: Pt[] = [pointAt(tr, from)];
  for (let i = 1; i < tr.pts.length - 1; i++) {
    if (tr.cum[i] > from && tr.cum[i] < to) out.push(tr.pts[i]);
  }
  out.push(pointAt(tr, to));
  return out;
}

export function CircuitBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = 0;
    let h = 0;
    let traces: Trace[] = [];
    let board: HTMLCanvasElement | null = null;
    let pulses: Pulse[] = [];
    let raf = 0;
    let last = 0;

    const spawn = (): Pulse => ({
      trace: traces[rand(traces.length)],
      at: 0,
      color: PULSE_INKS[rand(PULSE_INKS.length)],
    });

    const layout = () => {
      // Size to the largest the screen gets, so a phone's sliding address bar
      // never forces a rebuild (only a width change does).
      w = window.innerWidth;
      h = Math.max(window.innerHeight, window.screen?.height ?? 0);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      traces = buildTraces(w, h);

      board = document.createElement("canvas");
      board.width = canvas.width;
      board.height = canvas.height;
      const b = board.getContext("2d");
      if (!b) return;
      b.scale(dpr, dpr);
      b.lineWidth = 1;
      b.lineJoin = "round";
      b.lineCap = "round";
      for (const tr of traces) {
        const ink = TRACE_INKS[rand(TRACE_INKS.length)];
        b.strokeStyle = ink;
        b.beginPath();
        b.moveTo(tr.pts[0].x, tr.pts[0].y);
        for (const p of tr.pts.slice(1)) b.lineTo(p.x, p.y);
        b.stroke();
        // A pad at each end, like a via on a board.
        for (const end of [tr.pts[0], tr.pts[tr.pts.length - 1]]) {
          b.beginPath();
          b.arc(end.x, end.y, 2.2, 0, Math.PI * 2);
          b.stroke();
        }
      }
      const n = Math.max(6, Math.round(traces.length / 3));
      pulses = Array.from({ length: n }, () => {
        const p = spawn();
        p.at = Math.random() * p.trace.len;
        return p;
      });
    };

    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (board) ctx.drawImage(board, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const p of pulses) {
        const head = p.at;
        const tail = Math.max(0, head - PULSE_TAIL);
        if (head <= 0) continue;
        const pts = slice(p.trace, tail, Math.min(head, p.trace.len));
        const a = pts[0];
        const z = pts[pts.length - 1];
        const grad = ctx.createLinearGradient(a.x, a.y, z.x, z.y);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(1, p.color);
        // A soft halo, then the bright core.
        for (const [width, alpha] of [
          [6, 0.22],
          [1.6, 0.9],
        ] as const) {
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = grad;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (const q of pts.slice(1)) ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }
        if (head < p.trace.len) {
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(z.x, z.y, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 1000 / FPS) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      for (let i = 0; i < pulses.length; i++) {
        pulses[i].at += PULSE_SPEED * dt;
        if (pulses[i].at > pulses[i].trace.len + PULSE_TAIL) pulses[i] = spawn();
      }
      draw();
    };

    const start = () => {
      cancelAnimationFrame(raf);
      last = 0;
      if (still || document.hidden) {
        draw();
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    layout();
    start();

    let lastWidth = w;
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (window.innerWidth === lastWidth) return;
        lastWidth = window.innerWidth;
        layout();
        start();
      }, 200);
    };
    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else start();
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="circuit-backdrop" />;
}
