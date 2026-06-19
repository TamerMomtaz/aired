// AIRED brand kit generator — metallic / "warm metallic posh" edition.
//
// Produces three marks, each as a standalone SVG + a pixel-exact PNG:
//   • profile  1080 × 1080   (survives circle crop)
//   • cover    1640 × 856
//   • icon      512 × 512    (survives circle crop)
//
// Design language (per brand brief):
//   - Core palette only: bg #0a0a0a · signal red #e10600 · wordmark base #ededed.
//   - WORDMARK "AIRED": brushed/polished metal — vertical light→shadow gradient,
//     raised emboss (bright top edge, dark bottom bevel), faint brushed striations.
//   - RED LINE: polished red lacquer / filament under glass — vertical sheen
//     (#ff3a30 top → #e10600 → #b00500 bottom) with a luminous, fading end-falloff.
//   - SACRED GEOMETRY (rings + hexagram) and BRONZE FILIGREE: thin metal inlay,
//     gold/bronze gradient (#d9b87a → #7a5c2e) with a faint highlight edge.
//   - COVER tagline serif: subtle silver gradient (light top → mid-grey bottom).
//
// All copy is outlined to <path> (no font dependency) so the SVG renders
// identically everywhere and the PNG matches the SVG exactly.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import { Resvg } from "@resvg/resvg-js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");
fs.mkdirSync(OUT, { recursive: true });

// ── palette ────────────────────────────────────────────────────────────────
const BG = "#0a0a0a"; // matte black
const RED = "#e10600"; // signal red (mid stop of the lacquer)
const FG = "#ededed"; // wordmark base (mid stop of the metal)

// metallic shading endpoints (tints/shades of the core palette — no new hues)
const METAL_HI = "#f5f5f5"; // polished highlight, near top
const METAL_LO = "#6a6a6a"; // shadow, lower third
const BEVEL_HI = "#fbfbfb"; // 1px specular top edge
const BEVEL_LO = "#050505"; // dark bottom bevel
const RED_HI = "#ff3a30"; // lacquer sheen top
const RED_LO = "#b00500"; // lacquer deep bottom
const BRONZE_HI = "#d9b87a"; // gold/bronze highlight
const BRONZE_MID = "#a8814a";
const BRONZE_LO = "#7a5c2e"; // bronze shadow
const BRONZE_EDGE = "#efe0bb"; // faint highlight edge on inlay
const SILVER_HI = "#f2f2f2"; // tagline light top
const SILVER_LO = "#9a9a9a"; // tagline mid-grey bottom

// ── fonts ──────────────────────────────────────────────────────────────────
function loadFont(file) {
  const buf = fs.readFileSync(path.join(HERE, "fonts", file));
  // exact-slice the ArrayBuffer so opentype never sees pooled bytes
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
const F_WORDMARK = loadFont("Montserrat-ExtraBold.ttf");
const F_SERIF = loadFont("EBGaramond-Medium.ttf");

// ── text → outlined path ─────────────────────────────────────────────────────
// Builds a single Path for `text` at `fontSize`, baseline at y=0, left edge at
// x=0, with `trackingEm` letter-spacing. Returns { d, width }.
function outline(font, text, fontSize, trackingEm = 0) {
  const scale = fontSize / font.unitsPerEm;
  const glyphs = font.stringToGlyphs(text);
  const full = new opentype.Path();
  let x = 0;
  glyphs.forEach((g) => {
    full.extend(g.getPath(x, 0, fontSize));
    x += g.advanceWidth * scale + trackingEm * fontSize;
  });
  const width = x - trackingEm * fontSize; // drop trailing track
  return { d: full.toPathData(3), width };
}

// Pick the fontSize that makes `text` exactly `targetWidth` wide.
function fitSize(font, text, targetWidth, trackingEm = 0) {
  const probe = outline(font, text, 1000, trackingEm);
  return (targetWidth / probe.width) * 1000;
}

// ── geometry helpers ─────────────────────────────────────────────────────────
const rad = (deg) => (deg * Math.PI) / 180;
function trianglePts(cx, cy, r, rotDeg) {
  return [0, 120, 240]
    .map((a) => {
      const t = rad(a + rotDeg);
      return `${(cx + r * Math.cos(t)).toFixed(2)},${(cy + r * Math.sin(t)).toFixed(2)}`;
    })
    .join(" ");
}

// Hexagram (two interlocked triangles) + concentric rings, as thin bronze inlay.
// `op` scales overall opacity so it can sit faint behind the wordmark.
function sacredGeometry(cx, cy, r, sw, op) {
  const up = trianglePts(cx, cy, r, -90); // apex up
  const down = trianglePts(cx, cy, r, 90); // apex down
  const ring1 = r * 1.28;
  const ring2 = r * 1.5;
  const tri = (pts, fill, w, dy = 0, o = 1) =>
    `<polygon points="${pts}" fill="none" stroke="${fill}" stroke-width="${w}" stroke-linejoin="round" transform="translate(0 ${dy})" opacity="${o}"/>`;
  const ring = (rr, fill, w, dy = 0, o = 1) =>
    `<circle cx="${cx}" cy="${cy}" r="${rr.toFixed(2)}" fill="none" stroke="${fill}" stroke-width="${w}" transform="translate(0 ${dy})" opacity="${o}"/>`;
  return `
  <g opacity="${op}">
    <!-- faint highlight edge (drawn first, sits just above) -->
    ${ring(ring1, BRONZE_EDGE, sw, -0.6, 0.3)}
    ${ring(ring2, BRONZE_EDGE, sw * 0.8, -0.6, 0.22)}
    ${tri(up, BRONZE_EDGE, sw, -0.6, 0.28)}
    ${tri(down, BRONZE_EDGE, sw, -0.6, 0.28)}
    <!-- bronze inlay -->
    ${ring(ring1, "url(#bronze)", sw)}
    ${ring(ring2, "url(#bronze)", sw * 0.8)}
    ${tri(up, "url(#bronze)", sw)}
    ${tri(down, "url(#bronze)", sw)}
    <circle cx="${cx}" cy="${cy}" r="${(sw * 1.4).toFixed(2)}" fill="url(#bronze)"/>
  </g>`;
}

// Restrained filigree divider: a center diamond bead, two hairlines, small
// open rings at the tips. Reads as fine metal inlay, not a busy scroll.
function filigree(cx, cy, halfW, sw, op) {
  const beadGap = halfW * 0.16;
  const tip = halfW * 0.82;
  const ringR = halfW * 0.085;
  const bead = halfW * 0.06;
  const part = (stroke, w, dy, o) => `
    <g transform="translate(0 ${dy})" opacity="${o}">
      <line x1="${cx - tip}" y1="${cy}" x2="${cx - beadGap}" y2="${cy}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"/>
      <line x1="${cx + beadGap}" y1="${cy}" x2="${cx + tip}" y2="${cy}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"/>
      <polygon points="${cx},${cy - bead} ${cx + bead},${cy} ${cx},${cy + bead} ${cx - bead},${cy}" fill="${stroke}"/>
      <circle cx="${cx - tip - ringR}" cy="${cy}" r="${ringR}" fill="none" stroke="${stroke}" stroke-width="${w}"/>
      <circle cx="${cx + tip + ringR}" cy="${cy}" r="${ringR}" fill="none" stroke="${stroke}" stroke-width="${w}"/>
    </g>`;
  return `
  <g opacity="${op}">
    ${part(BRONZE_EDGE, sw, -0.5, 0.3)}
    ${part("url(#bronze)", sw, 0, 1)}
  </g>`;
}

// Metallic wordmark: emboss stack (dark bevel below, specular above, gradient
// face on top) + optional faint brushed striations. Paths are inlined (no
// <use>) so the SVG stays portable into Figma / Canva / Illustrator.
function wordmark(d, width, cx, baselineY, { shadow, hi, brushed }) {
  const tx = (cx - width / 2).toFixed(2);
  const ty = baselineY.toFixed(2);
  const brushLayer = brushed
    ? `<path d="${d}" fill="url(#brushed)" opacity="0.07"/>`
    : "";
  return `
  <g transform="translate(${tx} ${ty})">
    <path d="${d}" fill="${BEVEL_LO}" transform="translate(0 ${shadow})"/>
    <path d="${d}" fill="${BEVEL_HI}" transform="translate(0 ${-hi})"/>
    <path d="${d}" fill="url(#metal)"/>
    ${brushLayer}
  </g>`;
}

// Polished-lacquer red line with vertical sheen, soft glow, and fading ends.
function redLine(cx, cy, w, h, glowStd, key) {
  const x = cx - w / 2;
  const y = cy - h / 2;
  const rx = h / 2;
  const fade = Math.max(0.04, Math.min(0.09, (rx * 1.4) / w)); // soften only the tips
  return `
  <defs>
    <linearGradient id="ends_${key}" x1="${x}" y1="0" x2="${x + w}" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#000"/>
      <stop offset="${fade.toFixed(3)}" stop-color="#fff"/>
      <stop offset="${(1 - fade).toFixed(3)}" stop-color="#fff"/>
      <stop offset="1" stop-color="#000"/>
    </linearGradient>
    <mask id="endsMask_${key}" maskUnits="userSpaceOnUse" x="${x - h}" y="${y - h}" width="${w + h * 2}" height="${h * 3}">
      <rect x="${x - h}" y="${y - h}" width="${w + h * 2}" height="${h * 3}" fill="url(#ends_${key})"/>
    </mask>
  </defs>
  <!-- luminous glow, fading at the tips -->
  <g mask="url(#endsMask_${key})">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${RED}" filter="url(#redGlow_${key})" opacity="0.7"/>
    <!-- lacquer body -->
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="url(#redLacquer)"/>
    <!-- glassy top sheen -->
    <rect x="${x}" y="${y}" width="${w}" height="${(h * 0.5).toFixed(2)}" rx="${rx}" fill="url(#redSheen)"/>
  </g>`;
}

// Silver-metal serif tagline (cover only), outlined.
function tagline(text, targetWidth, cx, baselineY) {
  const size = fitSize(F_SERIF, text, targetWidth, 0.01);
  const { d, width } = outline(F_SERIF, text, size, 0.01);
  const tx = (cx - width / 2).toFixed(2);
  return `
  <g transform="translate(${tx} ${baselineY})">
    <path d="${d}" fill="${BEVEL_LO}" transform="translate(0 0.8)" opacity="0.8"/>
    <path d="${d}" fill="url(#silver)"/>
  </g>`;
}

// ── shared defs (gradients/filters/pattern) ─────────────────────────────────
function commonDefs(brushSp, glowStd, key) {
  return `
  <defs>
    <!-- metal face: bright top → base #ededed → shadow lower third -->
    <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${METAL_HI}"/>
      <stop offset="0.14" stop-color="${FG}"/>
      <stop offset="0.46" stop-color="#c2c2c2"/>
      <stop offset="0.66" stop-color="#7d7d7d"/>
      <stop offset="1" stop-color="${METAL_LO}"/>
    </linearGradient>
    <!-- red lacquer: sheen top → signal red → deep bottom -->
    <linearGradient id="redLacquer" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${RED_HI}"/>
      <stop offset="0.5" stop-color="${RED}"/>
      <stop offset="1" stop-color="${RED_LO}"/>
    </linearGradient>
    <linearGradient id="redSheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.4"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <!-- bronze inlay -->
    <linearGradient id="bronze" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BRONZE_HI}"/>
      <stop offset="0.5" stop-color="${BRONZE_MID}"/>
      <stop offset="1" stop-color="${BRONZE_LO}"/>
    </linearGradient>
    <!-- silver serif -->
    <linearGradient id="silver" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${SILVER_HI}"/>
      <stop offset="1" stop-color="${SILVER_LO}"/>
    </linearGradient>
    <!-- soft spotlight behind the mark (light only, no new hue) -->
    <radialGradient id="spot" cx="0.5" cy="0.42" r="0.62">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.05"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <!-- brushed-steel striations (very fine horizontal lines) -->
    <pattern id="brushed" patternUnits="userSpaceOnUse" width="6" height="${brushSp}">
      <rect width="6" height="1" fill="#ffffff"/>
    </pattern>
    <filter id="redGlow_${key}" x="-50%" y="-300%" width="200%" height="700%">
      <feGaussianBlur stdDeviation="${glowStd}"/>
    </filter>
  </defs>`;
}

function svgDoc(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

// ── compositions ─────────────────────────────────────────────────────────────
function buildIcon() {
  const S = 512;
  const cx = S / 2;
  const wmWidth = S * 0.6;
  const size = fitSize(F_WORDMARK, "AIRED", wmWidth, 0.14);
  const { d, width } = outline(F_WORDMARK, "AIRED", size, 0.14);
  const cap = size * 0.72;
  const baselineY = S * 0.5 + cap * 0.34; // optical centering of word+line block
  const lineH = S * 0.022;
  const lineY = baselineY + size * 0.2;
  const geomR = S * 0.2;
  return svgDoc(
    S,
    S,
    `${commonDefs(3, lineH * 1.1, "i")}
    <rect width="${S}" height="${S}" fill="${BG}"/>
    <rect width="${S}" height="${S}" fill="url(#spot)"/>
    ${sacredGeometry(cx, baselineY - cap * 0.42, geomR, S * 0.0045, 0.4)}
    ${wordmark(d, width, cx, baselineY, { shadow: size * 0.02, hi: size * 0.012, brushed: false })}
    ${redLine(cx, lineY, width, lineH, lineH * 1.1, "i")}`,
  );
}

function buildProfile() {
  const S = 1080;
  const cx = S / 2;
  const wmWidth = S * 0.58;
  const size = fitSize(F_WORDMARK, "AIRED", wmWidth, 0.14);
  const { d, width } = outline(F_WORDMARK, "AIRED", size, 0.14);
  const cap = size * 0.72;
  const baselineY = S * 0.47 + cap * 0.34;
  const lineH = S * 0.018;
  const lineY = baselineY + size * 0.2;
  const geomR = S * 0.2;
  return svgDoc(
    S,
    S,
    `${commonDefs(5, lineH * 1.0, "p")}
    <rect width="${S}" height="${S}" fill="${BG}"/>
    <rect width="${S}" height="${S}" fill="url(#spot)"/>
    ${sacredGeometry(cx, baselineY - cap * 0.42, geomR, S * 0.004, 0.45)}
    ${wordmark(d, width, cx, baselineY, { shadow: size * 0.02, hi: size * 0.012, brushed: true })}
    ${redLine(cx, lineY, width, lineH, lineH * 1.1, "p")}
    ${filigree(cx, lineY + S * 0.085, width * 0.46, S * 0.0035, 0.62)}`,
  );
}

function buildCover() {
  const W = 1640;
  const H = 856;
  const cx = W / 2;
  const wmWidth = W * 0.42;
  const size = fitSize(F_WORDMARK, "AIRED", wmWidth, 0.16);
  const { d, width } = outline(F_WORDMARK, "AIRED", size, 0.16);
  const cap = size * 0.72;
  const baselineY = H * 0.42 + cap * 0.34;
  const lineH = H * 0.022;
  const lineY = baselineY + size * 0.2;
  const geomR = H * 0.26;
  return svgDoc(
    W,
    H,
    `${commonDefs(5, lineH * 1.0, "c")}
    <rect width="${W}" height="${H}" fill="${BG}"/>
    <rect width="${W}" height="${H}" fill="url(#spot)"/>
    ${sacredGeometry(cx, baselineY - cap * 0.42, geomR, W * 0.0026, 0.32)}
    ${wordmark(d, width, cx, baselineY, { shadow: size * 0.02, hi: size * 0.012, brushed: true })}
    ${redLine(cx, lineY, width, lineH, lineH * 1.0, "c")}
    ${tagline("AI-ed and proud · credited not thanked", W * 0.4, cx, lineY + H * 0.16)}
    ${filigree(cx, lineY + H * 0.27, W * 0.13, W * 0.0022, 0.6)}`,
  );
}

// ── render ───────────────────────────────────────────────────────────────────
function emit(name, svg, w) {
  const svgPath = path.join(OUT, `${name}.svg`);
  const pngPath = path.join(OUT, `${name}.png`);
  fs.writeFileSync(svgPath, svg);
  const r = new Resvg(svg, { fitTo: { mode: "width", value: w } });
  fs.writeFileSync(pngPath, r.render().asPng());
  console.log(`✓ ${name}.svg + ${name}.png`);
}

emit("aired-icon-512", buildIcon(), 512);
emit("aired-profile-1080", buildProfile(), 1080);
emit("aired-cover-1640x856", buildCover(), 1640);
console.log("done →", OUT);
