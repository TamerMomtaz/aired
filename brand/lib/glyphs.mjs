// glyphs.mjs — hand-built geometric letterforms for the AIRED brand kit.
//
// No fonts are used (none are reliably available here, and downloads fail).
// Every glyph is constructed from primitives — thick segments, thick elliptical
// arc-strokes, disks — drawn as a "thickened skeleton". Counters (the holes in
// A, R, D, e, o, p ...) are simply where no stroke is drawn, so the shapes are
// unions of solid strokes that the nonzero-winding renderer fills cleanly.
//
// Coordinate system (em): x grows right, y grows UP, baseline y = 0, cap height
// y = 1. The renderer flips y to device space at placement time. Stroke width
// `s` is in em, so the SAME builder draws the bold wordmark (s≈0.145) and the
// thin tagline (s≈0.075).

const D2R = Math.PI / 180;

// Default vertical metrics (em). Lower-case sits on an x-height; ascenders and
// descenders reach past it.
export const METRICS = { xH: 0.7, asc: 0.96, desc: -0.2, dot: 0.9 };

// ---------------------------------------------------------------------------
// Primitive contour builders — each returns ONE contour (array of [x,y]).
// ---------------------------------------------------------------------------

/** Points along an elliptical arc, a0->a1 in degrees. */
function arcPts(cx, cy, rx, ry, a0, a1) {
  const steps = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 3));
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const a = (a0 + ((a1 - a0) * i) / steps) * D2R;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

/** A straight stroke of width w between two points (butt caps). */
function seg(p0, p1, w) {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const len = Math.hypot(dx, dy) || 1e-6;
  const nx = (-dy / len) * (w / 2);
  const ny = (dx / len) * (w / 2);
  return [
    [p0[0] + nx, p0[1] + ny],
    [p1[0] + nx, p1[1] + ny],
    [p1[0] - nx, p1[1] - ny],
    [p0[0] - nx, p0[1] - ny],
  ];
}

/**
 * A curved stroke of width w following an elliptical arc (a "keyhole" ribbon:
 * outer arc + reversed inner arc in one contour, so nonzero fills the band and
 * leaves the counter open).
 */
function arcBand(cx, cy, rx, ry, a0, a1, w) {
  const outer = arcPts(cx, cy, rx + w / 2, ry + w / 2, a0, a1);
  const inner = arcPts(cx, cy, rx - w / 2, ry - w / 2, a1, a0);
  return outer.concat(inner);
}

/** A filled disk. */
function disk(cx, cy, r) {
  return arcPts(cx, cy, r, r, 0, 360);
}

const shoelace = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
};

/** Force CCW (positive area) so every solid stroke unions under nonzero. */
function pos(contour) {
  return shoelace(contour) < 0 ? contour.slice().reverse() : contour;
}

// ---------------------------------------------------------------------------
// Glyph builders — (s, m) => { w, c: [contours] }, w = ink width in em.
// ---------------------------------------------------------------------------

const GLYPHS = {
  // ---- Capitals (the wordmark uses A I R E D) -----------------------------
  A: (s) => {
    const W = 0.8, xc = W / 2, lf = s * 0.6, rf = W - s * 0.6, yB = 0.32;
    const lx = lf + (xc - lf) * yB, rx = rf + (xc - rf) * yB;
    return {
      w: W,
      c: [
        seg([lf, 0], [xc, 1], s),
        seg([rf, 0], [xc, 1], s),
        seg([lx, yB], [rx, yB], s * 0.92),
        disk(xc, 1 - s * 0.18, s * 0.5),
      ],
    };
  },
  I: (s) => ({ w: s, c: [seg([s / 2, 0], [s / 2, 1], s)] }),
  R: (s) => {
    const W = 0.72, ry = 0.245, cy = 1 - ry, rx = W - s;
    return {
      w: W,
      c: [
        seg([s / 2, 0], [s / 2, 1], s),
        arcBand(s / 2, cy, rx, ry, 90, -90, s),
        seg([s / 2, cy - ry], [W - s * 0.5, 0], s),
      ],
    };
  },
  E: (s) => {
    const W = 0.62;
    return {
      w: W,
      c: [
        seg([s / 2, 0], [s / 2, 1], s),
        seg([0, 1 - s / 2], [W, 1 - s / 2], s),
        seg([0, s / 2], [W, s / 2], s),
        seg([0, 0.5], [W * 0.82, 0.5], s),
      ],
    };
  },
  D: (s) => {
    const W = 0.78, cx = W * 0.5, rx = W - cx - s / 2, ry = 0.5 - s / 2;
    return {
      w: W,
      c: [
        seg([s / 2, 0], [s / 2, 1], s),
        seg([s / 2, 1 - s / 2], [cx, 1 - s / 2], s),
        seg([s / 2, s / 2], [cx, s / 2], s),
        arcBand(cx, 0.5, rx, ry, 90, -90, s),
      ],
    };
  },

  // ---- Lower-case (the tagline) -------------------------------------------
  a: (s, m) => {
    const W = 0.6;
    return {
      w: W,
      c: [
        arcBand(W / 2, m.xH / 2, (W - s) / 2, (m.xH - s) / 2, 0, 360, s),
        seg([W - s / 2, 0], [W - s / 2, m.xH], s),
      ],
    };
  },
  c: (s, m) => {
    const W = 0.58;
    return { w: W, c: [arcBand(W / 2, m.xH / 2, (W - s) / 2, (m.xH - s) / 2, 55, 305, s)] };
  },
  d: (s, m) => {
    const W = 0.64;
    return {
      w: W,
      c: [
        arcBand((W - s) / 2, m.xH / 2, (W - s) / 2 - s / 2, (m.xH - s) / 2, 0, 360, s),
        seg([W - s / 2, 0], [W - s / 2, m.asc], s),
      ],
    };
  },
  e: (s, m) => {
    const W = 0.6, cx = W / 2, cy = m.xH / 2, rx = (W - s) / 2, ry = (m.xH - s) / 2;
    return {
      w: W,
      c: [
        arcBand(cx, cy, rx, ry, 0, 320, s),
        seg([cx - rx, cy], [cx + rx, cy], s),
      ],
    };
  },
  h: (s, m) => {
    const W = 0.6, rx = (W - s) / 2, ry = rx, cy = m.xH - ry;
    return {
      w: W,
      c: [
        seg([s / 2, 0], [s / 2, m.asc], s),
        seg([W - s / 2, 0], [W - s / 2, cy], s),
        arcBand(W / 2, cy, rx, ry, 180, 0, s),
      ],
    };
  },
  i: (s, m) => ({
    w: 0.18,
    c: [seg([0.09, 0], [0.09, m.xH], s), disk(0.09, m.dot, s * 0.78)],
  }),
  k: (s, m) => {
    const W = 0.56;
    return {
      w: W,
      c: [
        seg([s / 2, 0], [s / 2, m.asc], s),
        seg([s / 2, m.xH * 0.42], [W - s / 2, m.xH], s),
        seg([s * 0.9, m.xH * 0.42], [W - s / 2, 0], s),
      ],
    };
  },
  n: (s, m) => {
    const W = 0.6, rx = (W - s) / 2, ry = rx, cy = m.xH - ry;
    return {
      w: W,
      c: [
        seg([s / 2, 0], [s / 2, m.xH], s),
        seg([W - s / 2, 0], [W - s / 2, cy], s),
        arcBand(W / 2, cy, rx, ry, 180, 0, s),
      ],
    };
  },
  o: (s, m) => {
    const W = 0.64;
    return { w: W, c: [arcBand(W / 2, m.xH / 2, (W - s) / 2, (m.xH - s) / 2, 0, 360, s)] };
  },
  p: (s, m) => {
    const W = 0.64;
    return {
      w: W,
      c: [
        seg([s / 2, m.desc], [s / 2, m.xH], s),
        arcBand(W / 2, m.xH / 2, (W - s) / 2, (m.xH - s) / 2, 0, 360, s),
      ],
    };
  },
  r: (s, m) => {
    const W = 0.42, rx = (W - s) / 2, ry = rx, cy = m.xH - ry;
    return {
      w: W,
      c: [
        seg([s / 2, 0], [s / 2, m.xH], s),
        arcBand(s / 2 + rx, cy, rx, ry, 180, 55, s),
      ],
    };
  },
  t: (s, m) => {
    const W = 0.4, cx = 0.2;
    return {
      w: W,
      c: [
        seg([cx, 0.02], [cx, m.xH + 0.2], s),
        seg([cx - 0.16, m.xH], [cx + 0.2, m.xH], s),
        seg([cx, 0.02], [cx + 0.16, 0.02], s),
      ],
    };
  },
  u: (s, m) => {
    const W = 0.6, rx = (W - s) / 2, rb = rx;
    return {
      w: W,
      c: [
        seg([s / 2, m.xH], [s / 2, rb], s),
        seg([W - s / 2, m.xH], [W - s / 2, 0], s),
        arcBand(W / 2, rb, rx, rb, 180, 360, s),
      ],
    };
  },

  // ---- Punctuation ---------------------------------------------------------
  "-": (s, m) => ({ w: 0.42, c: [seg([0.07, m.xH * 0.42], [0.35, m.xH * 0.42], s)] }),
  "·": (s, m) => ({ w: 0.3, c: [disk(0.15, m.xH * 0.5, s * 0.95)] }), // middot
  " ": () => ({ w: 0.34, c: [] }),
};

// ---------------------------------------------------------------------------
// Layout — lay a string out along x (em). Returns positioned contours, the
// total ink width, and each glyph's origin (so callers can anchor a period,
// pick a sample point, etc.).
// ---------------------------------------------------------------------------

const shiftX = (contour, dx) => contour.map((p) => [p[0] + dx, p[1]]);

export function layout(text, { s, m = METRICS, tracking = 0, sideBearing = 0 }) {
  let pen = 0;
  const contours = [];
  const glyphs = [];
  for (const ch of text) {
    const builder = GLYPHS[ch];
    if (!builder) throw new Error(`No glyph for ${JSON.stringify(ch)}`);
    const g = builder(s, m);
    const x = pen + sideBearing;
    for (const c of g.c) contours.push(pos(shiftX(c, x)));
    glyphs.push({ ch, x, w: g.w });
    pen += sideBearing + g.w + sideBearing + tracking;
  }
  const width = Math.max(0, pen - tracking);
  return { contours, width, glyphs };
}

// ---------------------------------------------------------------------------
// Place — map em contours (y up, baseline 0) into device pixels (y down).
//   X = originX + ex*scale ;  Y = baselineY - ey*scale
// ---------------------------------------------------------------------------

export function place(contours, { originX, baselineY, scale }) {
  return contours.map((c) =>
    c.map(([ex, ey]) => [originX + ex * scale, baselineY - ey * scale]),
  );
}
