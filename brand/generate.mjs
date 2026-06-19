#!/usr/bin/env node
// generate.mjs — build the AIRED brand kit.
//
//   node brand/generate.mjs
//
// Re-runnable, zero dependencies (Node built-ins only), no network, no fonts.
// Produces three exact-size assets as both PNG and standalone SVG, then
// pixel-verifies every output's dimensions and palette before exiting.
//
// The mark matches the site's landing/onboarding lockup (src/components/
// onboarding/onboarding.tsx — ScreenOne): the wordmark "AIRED" in a clean
// geometric sans with wide tracking, a red period after the D, and a short
// glowing red underline, all flat on matte black.

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { Canvas, hexToRgb, contoursToPath } from "./lib/render.mjs";
import { layout, place, METRICS } from "./lib/glyphs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PREVIEW = join(HERE, "preview");

// ---- Palette (CLAUDE.md §3; reds per the brand-kit spec) ------------------
// NOTE: the spec names "signal red #e10600" as the pixel-verify target. The
// live site currently sets --cert-red: #ff2d2d (a brighter glow-red). To match
// the site instead, change RED below to "#ff2d2d" and re-run.
const BG = "#0a0a0a"; // matte black field
const FG = "#ededed"; // off-white wordmark
const RED = "#e10600"; // signal red — period, underline, glow

const BG_RGB = hexToRgb(BG);
const FG_RGB = hexToRgb(FG);
const RED_RGB = hexToRgb(RED);

// ---- Wordmark constants (em; cap height = 1) ------------------------------
const STROKE = 0.145; // medium-confident geometric weight (wordmark)
const TRACK = 0.2; // wide letter-spacing (~0.2em)
const PERIOD_GAP = 0.1; // gap between D and the period

// ---------------------------------------------------------------------------
// Small device-space primitives (px) for the period + underline.
// ---------------------------------------------------------------------------
function circle(cx, cy, r) {
  const steps = Math.max(24, Math.ceil(r));
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}
// A stadium (fully rounded bar) as a fillable shape: middle rect + two caps.
function stadium(x0, y0, x1, y1) {
  const r = (y1 - y0) / 2;
  const cy = (y0 + y1) / 2;
  return [
    [[x0 + r, y0], [x1 - r, y0], [x1 - r, y1], [x0 + r, y1]],
    circle(x0 + r, cy, r),
    circle(x1 - r, cy, r),
  ];
}

// ---------------------------------------------------------------------------
// Lockup geometry — the AIRED wordmark + red period + glowing underline,
// centred at (cx, cy) on a canvas, in device pixels.
// ---------------------------------------------------------------------------
function lockup({ capPx, cx, cy, stroke = STROKE, track = TRACK, underlineFrac = 0.4, underlineEm = 0.05, gapUnder = 0.24 }) {
  const word = layout("AIRED", { s: stroke, tracking: track });
  const periodR = 0.65 * stroke;
  const tUem = Math.max(underlineEm, 3 / capPx); // never thinner than 3px
  const periodCxEm = word.width + PERIOD_GAP + periodR;
  const lockupWEm = periodCxEm + periodR;

  const blockW = lockupWEm * capPx;
  const originX = cx - blockW / 2;
  const baselineY = cy - ((gapUnder + tUem - 1) / 2) * capPx;

  // Wordmark letters (off-white).
  const fg = place(word.contours, { originX, baselineY, scale: capPx });

  // Red period, resting on the baseline.
  const pc = {
    cx: originX + periodCxEm * capPx,
    cy: baselineY - periodR * capPx,
    r: periodR * capPx,
  };

  // Red underline, centred under the lockup.
  const uW = underlineFrac * lockupWEm * capPx;
  const tU = tUem * capPx;
  const ucx = originX + (lockupWEm / 2) * capPx;
  const ucy = baselineY + (gapUnder + tUem / 2) * capPx;
  const ul = { x0: ucx - uW / 2, x1: ucx + uW / 2, y0: ucy - tU / 2, y1: ucy + tU / 2, cy: ucy, r: tU / 2 };

  // A point guaranteed to sit inside the off-white 'I' stem (palette check).
  const I = word.glyphs[1];
  const sampleI = { x: originX + (I.x + stroke / 2) * capPx, y: baselineY - 0.5 * capPx };

  const capTopY = baselineY - capPx;
  const blockH = ul.y1 - capTopY;
  return { fg, period: pc, underline: ul, blockW, blockH, capPx, lockupWEm, baselineY, originX, sampleI };
}

function paintLockup(cv, lk, { glowScale = 1.6, glowIntensity = 0.5 } = {}) {
  cv.fill(lk.fg, FG_RGB);
  cv.fill([circle(lk.period.cx, lk.period.cy, lk.period.r)], RED_RGB);
  const bar = stadium(lk.underline.x0, lk.underline.y0, lk.underline.x1, lk.underline.y1);
  const tU = lk.underline.y1 - lk.underline.y0;
  cv.glow(bar, RED_RGB, { radius: Math.round(tU * glowScale) + 6, intensity: glowIntensity });
  cv.fill(bar, RED_RGB);
}

// ---------------------------------------------------------------------------
// SVG assembly
// ---------------------------------------------------------------------------
const r2 = (n) => Math.round(n * 100) / 100;

function svgHeader(w, h) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n` +
    `  <rect width="${w}" height="${h}" fill="${BG}"/>\n`;
}

function svgLockup(lk) {
  const u = lk.underline;
  const std = (u.y1 - u.y0) * 0.85; // glow blur
  return (
    `  <defs><filter id="glow" x="-60%" y="-60%" width="220%" height="220%">` +
    `<feGaussianBlur stdDeviation="${r2(std)}"/></filter></defs>\n` +
    `  <rect x="${r2(u.x0)}" y="${r2(u.y0)}" width="${r2(u.x1 - u.x0)}" height="${r2(u.y1 - u.y0)}" rx="${r2(u.r)}" fill="${RED}" filter="url(#glow)" opacity="0.75"/>\n` +
    `  <path d="${contoursToPath(lk.fg)}" fill="${FG}" fill-rule="nonzero"/>\n` +
    `  <circle cx="${r2(lk.period.cx)}" cy="${r2(lk.period.cy)}" r="${r2(lk.period.r)}" fill="${RED}"/>\n` +
    `  <rect x="${r2(u.x0)}" y="${r2(u.y0)}" width="${r2(u.x1 - u.x0)}" height="${r2(u.y1 - u.y0)}" rx="${r2(u.r)}" fill="${RED}"/>\n`
  );
}

function svgPath(contours, fill, extra = "") {
  return `  <path d="${contoursToPath(contours)}" fill="${fill}" fill-rule="nonzero"${extra}/>\n`;
}

// ---------------------------------------------------------------------------
// Verification helpers
// ---------------------------------------------------------------------------
const checks = [];
function expect(label, got, want, tol = 4) {
  const ok = got.every((v, i) => Math.abs(v - want[i]) <= tol);
  checks.push({ label, got, want, ok });
}

// ---------------------------------------------------------------------------
// Asset 1 — Profile 1080×1080 (centred lockup inside a ~700px circle-safe zone)
// ---------------------------------------------------------------------------
function profile() {
  const W = 1080, H = 1080;
  const cv = new Canvas(W, H, BG);
  const lk = lockup({ capPx: 140, cx: W / 2, cy: H / 2, underlineFrac: 0.4, underlineEm: 0.05 });
  paintLockup(cv, lk);

  writeFileSync(join(HERE, "aired-profile-1080.png"), cv.toPNG());
  writeFileSync(join(HERE, "aired-profile-1080.svg"), svgHeader(W, H) + svgLockup(lk) + "</svg>\n");

  // Verify: dimensions, palette, and that the mark stays inside the 700 circle.
  expect("profile bg", cv.pixel(4, 4), BG_RGB);
  expect("profile wordmark (I stem)", cv.pixel(lk.sampleI.x, lk.sampleI.y), FG_RGB);
  expect("profile red period", cv.pixel(lk.period.cx, lk.period.cy), RED_RGB);
  expect("profile red underline", cv.pixel((lk.underline.x0 + lk.underline.x1) / 2, lk.underline.cy), RED_RGB);
  const halfDiag = Math.hypot(lk.blockW / 2, lk.blockH / 2);
  checks.push({ label: "profile inside 700px safe-circle", got: [Math.round(halfDiag)], want: ["<=350"], ok: halfDiag <= 350 });
  return { W, H };
}

// ---------------------------------------------------------------------------
// Asset 2 — Cover 1640×856 (lockup + tagline, bottom-left kept clear)
// ---------------------------------------------------------------------------
function cover() {
  const W = 1640, H = 856;
  const cv = new Canvas(W, H, BG);
  const lk = lockup({ capPx: 150, cx: W / 2, cy: 330, underlineFrac: 0.4, underlineEm: 0.05 });
  paintLockup(cv, lk);

  // Tagline — thin off-white geometric sans, centred beneath the lockup.
  const TAG = "AI-ed and proud · credited not thanked";
  const tCap = 34;
  const tg = layout(TAG, { s: 0.075, tracking: 0.06, sideBearing: 0.05 });
  const tagBaseline = 560;
  const tagOriginX = W / 2 - (tg.width * tCap) / 2;
  const tagDev = place(tg.contours, { originX: tagOriginX, baselineY: tagBaseline, scale: tCap });
  cv.fill(tagDev, FG_RGB, { ss: 6 });

  writeFileSync(join(HERE, "aired-cover-1640x856.png"), cv.toPNG());
  writeFileSync(
    join(HERE, "aired-cover-1640x856.svg"),
    svgHeader(W, H) + svgLockup(lk) + svgPath(tagDev, FG) + "</svg>\n",
  );

  // Verify dimensions, palette, and that the bottom-left (FB avatar) stays clear.
  expect("cover bg", cv.pixel(6, 6), BG_RGB);
  expect("cover wordmark (I stem)", cv.pixel(lk.sampleI.x, lk.sampleI.y), FG_RGB);
  expect("cover red period", cv.pixel(lk.period.cx, lk.period.cy), RED_RGB);
  expect("cover red underline", cv.pixel((lk.underline.x0 + lk.underline.x1) / 2, lk.underline.cy), RED_RGB);
  const tagBottom = tagBaseline + Math.abs(METRICS.desc) * tCap;
  const tagLeft = tagOriginX;
  checks.push({
    label: "cover bottom-left clear (avatar zone)",
    got: [`tagBottom=${Math.round(tagBottom)}`, `tagLeft=${Math.round(tagLeft)}`],
    want: ["bottom<600 & left>280"],
    ok: tagBottom < 600 && tagLeft > 280,
  });
  return { W, H };
}

// ---------------------------------------------------------------------------
// Asset 3 — Icon 512×512 ("AIRED." + red underline; legible down to ~48px)
// ---------------------------------------------------------------------------
function icon() {
  const W = 512, H = 512;
  const cv = new Canvas(W, H, BG);
  // The icon runs a touch bolder + larger so AIRED stays legible at ~48px, with
  // a tighter, less smudgy glow that survives the downscale.
  const lk = lockup({ capPx: 112, cx: W / 2, cy: H / 2, stroke: 0.16, track: 0.18, underlineFrac: 0.4, underlineEm: 0.085, gapUnder: 0.18 });
  paintLockup(cv, lk, { glowScale: 1.0, glowIntensity: 0.32 });

  writeFileSync(join(HERE, "aired-icon-512.png"), cv.toPNG());
  writeFileSync(join(HERE, "aired-icon-512.svg"), svgHeader(W, H) + svgLockup(lk) + "</svg>\n");

  // Downscaled previews to confirm legibility at small sizes.
  writeFileSync(join(PREVIEW, "aired-icon-96.png"), cv.downscalePNG(96, 96));
  writeFileSync(join(PREVIEW, "aired-icon-48.png"), cv.downscalePNG(48, 48));

  expect("icon bg", cv.pixel(4, 4), BG_RGB);
  expect("icon wordmark (I stem)", cv.pixel(lk.sampleI.x, lk.sampleI.y), FG_RGB);
  expect("icon red period", cv.pixel(lk.period.cx, lk.period.cy), RED_RGB);
  expect("icon red underline", cv.pixel((lk.underline.x0 + lk.underline.x1) / 2, lk.underline.cy), RED_RGB);
  const radius = Math.hypot(lk.blockW / 2, lk.blockH / 2);
  checks.push({ label: "icon inside 512 circle-crop", got: [Math.round(radius)], want: ["<=250"], ok: radius <= 250 });
  return { W, H };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
mkdirSync(PREVIEW, { recursive: true });

const assets = [
  ["aired-profile-1080", profile(), [1080, 1080]],
  ["aired-cover-1640x856", cover(), [1640, 856]],
  ["aired-icon-512", icon(), [512, 512]],
];

console.log("\nAIRED brand kit — palette  bg %s  fg %s  red %s\n", BG, FG, RED);
for (const [name, got, want] of assets) {
  const ok = got.W === want[0] && got.H === want[1];
  console.log(`  ${ok ? "OK " : "XX "} ${name}  ${got.W}x${got.H} (want ${want[0]}x${want[1]})`);
}
console.log("\n  pixel + layout checks:");
let pass = true;
for (const c of checks) {
  if (!c.ok) pass = false;
  console.log(`    ${c.ok ? "OK " : "XX "} ${c.label.padEnd(34)} got ${JSON.stringify(c.got)} want ${JSON.stringify(c.want)}`);
}
console.log(`\n  ${pass ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"}\n`);
if (!pass) process.exit(1);
