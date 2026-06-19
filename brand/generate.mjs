// =============================================================================
// AIRED — brand kit generator
// -----------------------------------------------------------------------------
// Builds the three brand marks from scratch as standalone SVG + exact-size PNG.
//
//   1. Profile  1080 x 1080   centered metallic AIRED + lacquered red line,
//                             bronze hexagram + concentric rings behind.
//   2. Cover    1640 x 856    wordmark left-of-center, full-width red circuit
//                             trace with nodes, silver-serif tagline, corner
//                             filigree (bottom-left kept clear for FB avatar).
//   3. Icon     512 x 512     the full metallic AIRED wordmark set across the
//                             middle, lacquered red line just beneath it, faint
//                             bronze rings behind. Reads as AIRED, never one
//                             letter; sized to survive a circle crop and stay
//                             legible down to ~48px.
//
// The wordmark "AIRED" is drawn as hand-built geometric monoline letterforms
// (filled vector paths) — no system font, so it is pixel-exact and font
// independent. Only the cover tagline uses a (locally installed) serif.
//
// Rasterizer: @resvg/resvg-js (the engine next/og bundles). No external fonts
// or network are used; the tagline serif is loaded from the local system.
//
//   run:  node brand/generate.mjs
// =============================================================================

import { Resvg } from "@resvg/resvg-js";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, "dist");
mkdirSync(DIST, { recursive: true });

// ----------------------------------------------------------------- palette ---
// Exact brand palette — no colors are introduced beyond these (plus pure black
// used only to deepen the matte background vignette).
const C = {
  bg: "#0a0a0a", // matte black background
  red: "#e10600", // signal red (deep / shadow tone)
  redHi: "#ff2d2d", // brighter red highlight tone
  redTop: "#ff3a30", // lacquer sheen, top
  redBot: "#b00500", // lacquer shadow, bottom
  metalBase: "#ededed", // wordmark base
  metalTop: "#f5f5f5", // brushed-metal highlight, top
  metalLow: "#6a6a6a", // brushed-metal shadow, lower third
  bronzeHi: "#d9b87a", // bronze inlay highlight
  bronzeLo: "#7a5c2e", // bronze inlay shadow
};

// number formatter — trims float noise and avoids "-0"
const n = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};

// -------------------------------------------------------------- primitives ---
const rect = (x, y, w, h) =>
  `M${n(x)},${n(y)} h${n(w)} v${n(h)} h${n(-w)} z`;

const poly = (pts) =>
  "M" + pts.map((p) => `${n(p[0])},${n(p[1])}`).join(" L") + " z";

// vertical linear gradient in user space
function linGradV(id, yTop, yBot, stops) {
  const s = stops
    .map(
      ([o, c, op]) =>
        `<stop offset="${o}" stop-color="${c}"${
          op != null ? ` stop-opacity="${op}"` : ""
        }/>`
    )
    .join("");
  return `<linearGradient id="${id}" x1="0" y1="${n(yTop)}" x2="0" y2="${n(
    yBot
  )}" gradientUnits="userSpaceOnUse">${s}</linearGradient>`;
}

// horizontal linear gradient in user space
function linGradH(id, xL, xR, stops) {
  const s = stops
    .map(
      ([o, c, op]) =>
        `<stop offset="${o}" stop-color="${c}"${
          op != null ? ` stop-opacity="${op}"` : ""
        }/>`
    )
    .join("");
  return `<linearGradient id="${id}" x1="${n(xL)}" y1="0" x2="${n(
    xR
  )}" y2="0" gradientUnits="userSpaceOnUse">${s}</linearGradient>`;
}

const metalStops = [
  [0, C.metalTop],
  [0.16, C.metalBase],
  [0.5, "#cfcfcf"],
  [0.68, "#7d7d7d"],
  [1, C.metalLow],
];
const lacquerStops = [
  [0, C.redTop],
  [0.45, C.red],
  [1, C.redBot],
];
const silverStops = [
  [0, "#f5f5f5"],
  [0.55, "#cfcfcf"],
  [1, "#8f8f8f"],
];
const bronzeStops = [
  [0, C.bronzeHi],
  [0.5, "#a07c44"],
  [1, C.bronzeLo],
];

// --------------------------------------------------- the AIRED wordmark -------
// Hand-built geometric monoline letterforms. Returns the filled sub-paths
// (each {d, eo}) positioned with the cap-box top-left at (ox, oy), plus the
// total advance width. Monoline => constant stroke weight SW.
function wordmark(capH, ox, oy) {
  const SW = capH * 0.132; // monoline stroke weight
  const gap = capH * 0.17; // tracking between glyphs
  const subs = [];
  const push = (d, eo = false) => subs.push({ d, eo });

  const RC = (x, y, w, h) => rect(x, y + oy, w, h);
  const PG = (pts) => poly(pts.map(([px, py]) => [px, py + oy]));
  const stem = (x) => RC(x, 0, SW, capH);

  // A — two legs to a pointed apex (Λ as a single polygon) + crossbar
  function A(x) {
    const aw = capH * 0.82;
    const apexX = x + aw / 2;
    const vNotch = SW * 1.5; // inner apex sits just below outer apex
    const yb = capH * 0.6; // crossbar top
    push(
      PG([
        [x, capH],
        [apexX, 0],
        [x + aw, capH],
        [x + aw - SW, capH],
        [apexX, vNotch],
        [x + SW, capH],
      ])
    );
    const t = (capH - yb) / (capH - vNotch);
    const ilx = x + SW + (apexX - (x + SW)) * t;
    const irx = x + aw - SW + (apexX - (x + aw - SW)) * t;
    push(RC(ilx - 1, yb, irx - ilx + 2, SW));
    return aw;
  }

  // I — single stem
  function I(x) {
    push(stem(x));
    return SW;
  }

  // R — stem + bowl ring (even-odd) + diagonal leg
  function R(x) {
    const rw = capH * 0.66;
    const bowlB = capH * 0.52;
    push(stem(x));
    const tfx = x + rw * 0.42;
    const rxO = x + rw - tfx;
    const outer = `M${n(x)},${n(oy)} H${n(tfx)} A${n(rxO)},${n(
      bowlB / 2
    )} 0 0 1 ${n(tfx)},${n(oy + bowlB)} H${n(x)} z`;
    const tfx2 = tfx - SW * 0.3;
    const inner = `M${n(x + SW)},${n(oy + SW)} H${n(tfx2)} A${n(rxO - SW)},${n(
      bowlB / 2 - SW
    )} 0 0 1 ${n(tfx2)},${n(oy + bowlB - SW)} H${n(x + SW)} z`;
    push(outer + " " + inner, true);
    const ay = bowlB * 0.86;
    push(
      PG([
        [x + SW, ay],
        [x + SW * 2, ay],
        [x + rw, capH],
        [x + rw - SW, capH],
      ])
    );
    return rw;
  }

  // E — stem + three arms (slightly short middle arm)
  function E(x) {
    const ew = capH * 0.6;
    push(stem(x));
    push(RC(x, 0, ew, SW));
    push(RC(x, (capH - SW) / 2, ew * 0.84, SW));
    push(RC(x, capH - SW, ew, SW));
    return ew;
  }

  // D — stem + full-height bowl (even-odd)
  function D(x) {
    const dw = capH * 0.72;
    const tfx = x + dw * 0.42;
    const rxO = x + dw - tfx;
    const outer = `M${n(x)},${n(oy)} H${n(tfx)} A${n(rxO)},${n(
      capH / 2
    )} 0 0 1 ${n(tfx)},${n(oy + capH)} H${n(x)} z`;
    const tfx2 = tfx - SW * 0.3;
    const inner = `M${n(x + SW)},${n(oy + SW)} H${n(tfx2)} A${n(rxO - SW)},${n(
      capH / 2 - SW
    )} 0 0 1 ${n(tfx2)},${n(oy + capH - SW)} H${n(x + SW)} z`;
    push(outer + " " + inner, true);
    return dw;
  }

  const order = [A, I, R, E, D];
  let x = ox;
  order.forEach((fn, i) => {
    const w = fn(x);
    x += w + (i < order.length - 1 ? gap : 0);
  });
  return { subs, width: x - ox, height: capH, SW };
}

const fillPaths = (subs, fill, extra = "") =>
  subs
    .map(
      (s) =>
        `<path d="${s.d}" fill="${fill}"${
          s.eo ? ' fill-rule="evenodd"' : ""
        }${extra ? " " + extra : ""}/>`
    )
    .join("");

// embossed, brushed-metal wordmark lockup at (x, y) with cap height capH.
// Layered: highlight copy (up) -> shadow copy (down) -> gradient face ->
// fine horizontal brushed striations clipped to the letters.
function wordmarkLockup(capH, x, y, { gradId, clipId, striations = true }) {
  const wm = wordmark(capH, x, y);
  const off = Math.max(1.5, capH * 0.018);
  const hi = `<g transform="translate(0,${n(-off)})">${fillPaths(
    wm.subs,
    C.metalTop
  )}</g>`;
  const sh = `<g transform="translate(0,${n(off)})">${fillPaths(
    wm.subs,
    "#000000"
  )}</g>`;
  const face = fillPaths(wm.subs, `url(#${gradId})`);

  let stri = "";
  if (striations) {
    const step = Math.max(2.5, capH * 0.02);
    let lines = "";
    for (let yy = y; yy <= y + capH; yy += step) {
      lines += `<line x1="${n(x - 4)}" y1="${n(yy)}" x2="${n(
        x + wm.width + 4
      )}" y2="${n(yy)}" stroke="#ffffff" stroke-width="0.75" stroke-opacity="0.05"/>`;
    }
    stri = `<g clip-path="url(#${clipId})">${lines}</g>`;
  }

  const defs =
    linGradV(gradId, y, y + capH, metalStops) +
    (striations
      ? `<clipPath id="${clipId}">${fillPaths(wm.subs, "#000")}</clipPath>`
      : "");

  return { svg: hi + sh + face + stri, defs, ...wm };
}

// ----------------------------------------------------- the red line -----------
// Polished red lacquer / glowing filament: layered strokes for the glow (NOT an
// SVG blur filter — a zero-height blur box collapses), a vertical-sheen core,
// a bright centre filament, and a luminous fade at both ends via a mask.
function redLine(x1, x2, yc, core, idBase) {
  const len = x2 - x1;
  const gradId = `${idBase}-core`;
  const maskId = `${idBase}-fade`;
  const grad = linGradV(gradId, yc - core / 2, yc + core / 2, lacquerStops);

  const bar = (h, fill, op) =>
    `<rect x="${n(x1)}" y="${n(yc - h / 2)}" width="${n(len)}" height="${n(
      h
    )}" rx="${n(h / 2)}" fill="${fill}"${
      op != null ? ` fill-opacity="${op}"` : ""
    }/>`;

  const fil = Math.max(1, core * 0.16);
  const body =
    bar(core * 7, C.redHi, 0.05) +
    bar(core * 4, C.redHi, 0.09) +
    bar(core * 2.2, C.redTop, 0.18) +
    bar(core, `url(#${gradId})`) +
    `<rect x="${n(x1)}" y="${n(yc - fil / 2)}" width="${n(len)}" height="${n(
      fil
    )}" rx="${n(fil / 2)}" fill="#ff9a86" fill-opacity="0.5"/>`;

  const top = yc - core * 4;
  const h = core * 8;
  const fadeGrad = linGradH(`${maskId}-g`, x1, x2, [
    [0, "#000000"],
    [0.06, "#ffffff"],
    [0.94, "#ffffff"],
    [1, "#000000"],
  ]);
  const mask = `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="${n(
    x1
  )}" y="${n(top)}" width="${n(len)}" height="${n(h)}"><rect x="${n(
    x1
  )}" y="${n(top)}" width="${n(len)}" height="${n(
    h
  )}" fill="url(#${maskId}-g)"/></mask>`;

  return {
    defs: grad + fadeGrad + mask,
    svg: `<g mask="url(#${maskId})">${body}</g>`,
  };
}

// ------------------------------------------------- bronze ornaments -----------
// matte-black background with a soft corner vignette (pure black, low alpha)
function background(w, h) {
  return (
    `<rect width="${w}" height="${h}" fill="${C.bg}"/>` +
    `<rect width="${w}" height="${h}" fill="url(#vig)"/>`
  );
}
const vignette = (cx, cy, r) =>
  `<radialGradient id="vig" cx="${cx}" cy="${cy}" r="${r}" gradientUnits="objectBoundingBox"><stop offset="0.55" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.55"/></radialGradient>`;

// sacred-geometry hexagram + concentric rings, thin bronze inlay
function sacredGeometry(cx, cy, R, gradId) {
  const ring = (r, op) =>
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(
      r
    )}" fill="none" stroke="url(#${gradId})" stroke-width="2" stroke-opacity="${op}"/>`;
  const tri = (rot, op) => {
    const pts = [0, 120, 240].map((a) => {
      const rad = ((a + rot) * Math.PI) / 180;
      return [cx + R * 0.9 * Math.sin(rad), cy - R * 0.9 * Math.cos(rad)];
    });
    return `<path d="${poly(
      pts
    )}" fill="none" stroke="url(#${gradId})" stroke-width="2" stroke-opacity="${op}" stroke-linejoin="round"/>`;
  };
  return (
    `<g>` +
    ring(R, 0.32) +
    ring(R * 0.76, 0.22) +
    ring(R * 0.5, 0.16) +
    tri(0, 0.3) +
    tri(180, 0.3) +
    // faint highlight echo for shimmer
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(
      R
    )}" fill="none" stroke="#efe0bd" stroke-width="0.6" stroke-opacity="0.12"/>` +
    `</g>`
  );
}

// a refined corner filigree (bronze inlay): two concentric quarter arcs framing
// the corner, end ticks closing the channel, and a small diamond gem on the
// diagonal. corner: TL|TR|BR (bottom-left is intentionally left clear).
function filigree(corner, w, h, gradId) {
  const m = 72; // corner pivot inset
  const L = 132; // outer arc radius
  const k = 0.5523; // cubic approximation of a circular quarter
  let O, sx, sy;
  if (corner === "TL") {
    O = [m, m];
    sx = 1;
    sy = 1;
  } else if (corner === "TR") {
    O = [w - m, m];
    sx = -1;
    sy = 1;
  } else {
    O = [w - m, h - m];
    sx = -1;
    sy = -1;
  }
  const p = (dx, dy) => [O[0] + dx * sx, O[1] + dy * sy];
  const s = `url(#${gradId})`;
  const arc = (r) => {
    const a = p(r, 0),
      b = p(r, r * k),
      c = p(r * k, r),
      d = p(0, r);
    return `M${n(a[0])},${n(a[1])} C${n(b[0])},${n(b[1])} ${n(c[0])},${n(
      c[1]
    )} ${n(d[0])},${n(d[1])}`;
  };
  const tick = (pa, pb) =>
    `<line x1="${n(pa[0])}" y1="${n(pa[1])}" x2="${n(pb[0])}" y2="${n(
      pb[1]
    )}" stroke="${s}" stroke-width="1.4" stroke-opacity="0.5"/>`;
  const dot = (pt) =>
    `<circle cx="${n(pt[0])}" cy="${n(pt[1])}" r="2.2" fill="${s}" fill-opacity="0.7"/>`;
  const g = L * 0.46; // gem sits on the diagonal bisector
  const gem = poly([p(g + 7, g), p(g, g + 7), p(g - 7, g), p(g, g - 7)]);
  return (
    `<g fill="none" stroke="${s}" stroke-width="1.7" stroke-opacity="0.55" stroke-linecap="round">` +
    `<path d="${arc(L)}"/>` +
    `<path d="${arc(L * 0.8)}"/>` +
    tick(p(L, 0), p(L * 0.8, 0)) +
    tick(p(0, L), p(0, L * 0.8)) +
    `</g>` +
    `<path d="${gem}" fill="${s}" fill-opacity="0.5" stroke="#efe0bd" stroke-width="0.5" stroke-opacity="0.3"/>` +
    dot(p(L, 0)) +
    dot(p(0, L))
  );
}

// faint circuit nodes branching off a horizontal trace (cover negative space)
function circuitNodes(yc, xs, gradId) {
  let out = "";
  for (const [x, dir, r] of xs) {
    const ny = yc + dir * 46;
    out +=
      `<line x1="${n(x)}" y1="${n(yc)}" x2="${n(x)}" y2="${n(
        ny
      )}" stroke="url(#${gradId})" stroke-width="1.4" stroke-opacity="0.4"/>` +
      `<circle cx="${n(x)}" cy="${n(ny)}" r="${n(
        r + 2.5
      )}" fill="none" stroke="url(#${gradId})" stroke-width="1.2" stroke-opacity="0.5"/>` +
      `<circle cx="${n(x)}" cy="${n(ny)}" r="${n(r)}" fill="${
        C.redHi
      }" fill-opacity="0.55"/>`;
  }
  return out;
}

// ------------------------------------------------------------- assembly -------
const svgDoc = (w, h, defs, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
  `<defs>${defs}</defs>${body}</svg>`;

// 1 · PROFILE 1080x1080 ---------------------------------------------------------
function buildProfile() {
  const W = 1080,
    H = 1080;
  const cx = W / 2,
    cy = H / 2;
  const capH = 150;
  // center the wordmark; red line sits just beneath the baseline
  const wmProbe = wordmark(capH, 0, 0);
  const wx = cx - wmProbe.width / 2;
  const wy = 398; // cap-box top
  const lock = wordmarkLockup(capH, wx, wy, {
    gradId: "p-metal",
    clipId: "p-clip",
  });
  const lineY = wy + capH + 52;
  const line = redLine(wx, wx + lock.width, lineY, 7, "p-line");

  const defs =
    vignette(0.5, 0.5, 0.72) +
    linGradV("p-bronze", cy - 320, cy + 320, bronzeStops) +
    lock.defs +
    line.defs;

  const body =
    background(W, H) +
    sacredGeometry(cx, cy, 312, "p-bronze") +
    lock.svg +
    line.svg;

  const probes = [
    { x: 210, y: 360, kind: "bg", label: "background" },
    { x: cx, y: lineY + 2, kind: "red", label: "red line core" },
    { x: Math.round(wx + capH * 1.056), y: wy + capH * 0.5, kind: "metal", label: "wordmark metal" },
  ];
  const scans = [
    { kind: "bronze", label: "hexagram inlay", box: [cx + 196, cy - 240, cx + 250, cy - 186] },
  ];
  return { name: "aired-profile-1080", W, H, svg: svgDoc(W, H, defs, body), probes, scans };
}

// 2 · COVER 1640x856 ------------------------------------------------------------
function buildCover() {
  const W = 1640,
    H = 856;
  const capH = 150;
  const wx = 132;
  const wy = 250; // cap-box top
  const lock = wordmarkLockup(capH, wx, wy, {
    gradId: "c-metal",
    clipId: "c-clip",
  });

  const tagY = wy + capH + 70; // tagline baseline
  const tagSize = 36;
  const tagline =
    `<text x="${n(wx + 2)}" y="${n(
      tagY
    )}" font-family="Liberation Serif, DejaVu Serif, Georgia, 'Times New Roman', serif" font-size="${tagSize}" letter-spacing="2.5" fill="url(#c-silver)">AI-ed and proud · credited not thanked</text>`;

  const lineY = 612;
  const line = redLine(40, W - 40, lineY, 6, "c-line");
  const nodes = circuitNodes(
    lineY,
    [
      [980, -1, 4],
      [1120, 1, 3.5],
      [1248, -1, 5],
      [1380, 1, 4],
      [1500, -1, 3.5],
      [880, 1, 3],
    ],
    "c-bronze"
  );

  const defs =
    vignette(0.42, 0.45, 0.85) +
    linGradV("c-silver", tagY - tagSize * 0.78, tagY + tagSize * 0.1, silverStops) +
    linGradV("c-bronze", 40, H - 40, bronzeStops) +
    lock.defs +
    line.defs;

  const body =
    background(W, H) +
    filigree("TL", W, H, "c-bronze") +
    filigree("TR", W, H, "c-bronze") +
    filigree("BR", W, H, "c-bronze") +
    nodes +
    line.svg +
    lock.svg +
    tagline;

  const probes = [
    { x: 820, y: 200, kind: "bg", label: "background" },
    { x: 820, y: lineY + 2, kind: "red", label: "red line core" },
    { x: Math.round(wx + capH * 1.056), y: wy + capH * 0.5, kind: "metal", label: "wordmark metal" },
  ];
  const scans = [
    { kind: "silver", label: "tagline serif", box: [wx + 8, tagY - 30, wx + 620, tagY + 8] },
    { kind: "bronze", label: "corner filigree", box: [W - 210, 30, W - 60, 178] },
  ];
  return { name: "aired-cover-1640x856", W, H, svg: svgDoc(W, H, defs, body), probes, scans };
}

// 3 · ICON 512x512 --------------------------------------------------------------
// The full metallic AIRED wordmark — same brushed-steel lockup, lacquered red
// line, and bronze rings as the other marks — set across the middle of the
// square. "AIRED" is wide, so the cap height is tuned to leave a margin on every
// side (survives a circle crop) while staying legible down to ~48px.
function buildIcon() {
  const W = 512,
    H = 512;
  const cx = W / 2,
    cy = H / 2;

  // Wordmark sized so its box keeps clear of the square edges and of the
  // inscribed circle (avatar crop). ~120 leaves a ~40px side margin and reads
  // down to a 48px favicon.
  const capH = 120;
  const wmProbe = wordmark(capH, 0, 0); // measure to center horizontally
  const wx = cx - wmProbe.width / 2;
  const lineGap = capH * 0.3; // red line drops just beneath the baseline
  // Center the wordmark + red line as a single block on the square's mid-line.
  const wy = Math.round(cy - (capH + lineGap) / 2);

  const lock = wordmarkLockup(capH, wx, wy, {
    gradId: "i-metal",
    clipId: "i-clip",
  });
  const lineY = wy + capH + lineGap;
  const line = redLine(wx, wx + lock.width, lineY, 9, "i-line");

  // Faint bronze rings behind the word (the icon's existing geometry), with a
  // pale highlight echo on the outer ring for the same shimmer as the profile.
  const ringGrad = linGradV("i-bronze", cy - 210, cy + 210, bronzeStops);
  const rings =
    `<circle cx="${cx}" cy="${cy}" r="206" fill="none" stroke="url(#i-bronze)" stroke-width="3" stroke-opacity="0.42"/>` +
    `<circle cx="${cx}" cy="${cy}" r="150" fill="none" stroke="url(#i-bronze)" stroke-width="1.6" stroke-opacity="0.22"/>` +
    `<circle cx="${cx}" cy="${cy}" r="206" fill="none" stroke="#efe0bd" stroke-width="0.6" stroke-opacity="0.1"/>`;

  const defs =
    vignette(0.5, 0.5, 0.7) + ringGrad + lock.defs + line.defs;

  const body = background(W, H) + rings + lock.svg + line.svg;

  // Solid 'I' stem (2nd glyph: after A + one gap) is a reliable metal sample.
  const iStemX = wx + capH * 0.82 + capH * 0.17 + lock.SW / 2;
  const probes = [
    { x: 256, y: 34, kind: "bg", label: "background" },
    { x: Math.round(cx), y: Math.round(lineY + 3), kind: "red", label: "red line core" },
    {
      x: Math.round(iStemX),
      y: Math.round(wy + capH / 2),
      kind: "metal",
      label: "wordmark metal",
    },
  ];
  const scans = [
    { kind: "bronze", label: "bronze ring", box: [388, 98, 422, 132] },
  ];
  return { name: "aired-icon-512", W, H, svg: svgDoc(W, H, defs, body), probes, scans };
}

// --------------------------------------------------------- rasterize/verify ---
function pngSizeFromBuffer(buf) {
  // IHDR width/height are big-endian uint32 at byte offsets 16 and 20
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}
const hex = (rgb) =>
  "#" + rgb.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("");

// classify a sampled pixel into a brand-palette family
function inFamily(kind, [R, G, B]) {
  const avg = (R + G + B) / 3;
  const spread = Math.max(R, G, B) - Math.min(R, G, B);
  switch (kind) {
    case "bg":
      return Math.abs(R - 10) <= 4 && Math.abs(G - 10) <= 4 && Math.abs(B - 10) <= 4;
    case "red":
      return R > 140 && G < 90 && B < 90 && R - G > 80;
    case "metal":
      return spread <= 24 && avg >= 80;
    case "silver":
      return spread <= 30 && avg >= 110;
    case "bronze":
      return R > G && G >= B && R > 30 && R - B > 14;
    default:
      return false;
  }
}

function scanRegion(at, kind, [x0, y0, x1, y1]) {
  let best = null,
    bestScore = -1;
  for (let y = Math.round(y0); y < y1; y++) {
    for (let x = Math.round(x0); x < x1; x++) {
      const c = at(x, y);
      if (!inFamily(kind, c)) continue;
      const score = kind === "silver" ? c[0] + c[1] + c[2] : c[0] - c[2];
      if (score > bestScore) {
        bestScore = score;
        best = { x, y, c };
      }
    }
  }
  return best;
}

function render(asset) {
  const r = new Resvg(asset.svg, {
    fitTo: { mode: "width", value: asset.W },
    font: {
      loadSystemFonts: true,
      fontDirs: ["/usr/share/fonts"],
      defaultFontFamily: "Liberation Serif",
    },
    background: "rgba(0,0,0,0)",
  });
  const img = r.render();
  const png = img.asPng();
  const w = img.width,
    h = img.height;
  const px = img.pixels;
  const at = (x, y) => {
    const i = (Math.round(y) * w + Math.round(x)) * 4;
    return [px[i], px[i + 1], px[i + 2], px[i + 3]];
  };
  writeFileSync(join(DIST, asset.name + ".svg"), asset.svg, "utf8");
  writeFileSync(join(DIST, asset.name + ".png"), png);
  const [fw, fh] = pngSizeFromBuffer(png);
  return { img, png, w, h, at, fileSize: [fw, fh] };
}

// ----------------------------------------------------------------- driver -----
const assets = [buildProfile(), buildCover(), buildIcon()];
let pass = true;
console.log("AIRED brand kit — generate + verify\n");
for (const a of assets) {
  const r = render(a);
  const okDim =
    r.w === a.W && r.h === a.H && r.fileSize[0] === a.W && r.fileSize[1] === a.H;
  if (!okDim) pass = false;
  console.log(`• ${a.name}`);
  console.log(
    `    dimensions  ${r.w}x${r.h}  ·  png file ${r.fileSize[0]}x${r.fileSize[1]}  ·  ${
      okDim ? "OK ✓" : "MISMATCH ✗"
    }`
  );
  for (const pr of a.probes) {
    const c = r.at(pr.x, pr.y);
    const ok = inFamily(pr.kind, c);
    if (!ok) pass = false;
    console.log(
      `    ${pr.kind.padEnd(6)} ${hex(c).padEnd(8)} @(${pr.x},${Math.round(
        pr.y
      )})  ${pr.label.padEnd(18)} ${ok ? "OK ✓" : "FAIL ✗"}`
    );
  }
  for (const sc of a.scans || []) {
    const best = scanRegion(r.at, sc.kind, sc.box);
    if (!best) pass = false;
    console.log(
      `    ${sc.kind.padEnd(6)} ${
        best ? hex(best.c).padEnd(8) : "—       "
      } scan          ${sc.label.padEnd(18)} ${best ? "found ✓" : "MISSING ✗"}`
    );
  }
  console.log("");
}
console.log(
  pass
    ? "✓ all assets written to brand/dist/ — dimensions and core palette verified"
    : "✗ verification reported a problem — see above"
);
process.exit(pass ? 0 : 1);
