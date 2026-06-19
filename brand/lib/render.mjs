// render.mjs — a tiny, zero-dependency 2D renderer for the AIRED brand kit.
//
// Why hand-rolled: this environment has no SVG rasterizer (no sharp / resvg /
// canvas / chromium) and no network for fonts. So we draw the brand mark as
// geometric vector CONTOURS (closed polygons, in device pixels) and render the
// SAME contours two ways that agree pixel-for-pixel:
//   - SVG  : each contour becomes a <path> (vector output).
//   - PNG  : a nonzero-winding scanline rasterizer fills the contours into an
//            RGB pixel buffer, encoded to PNG with Node's built-in zlib.
//
// A "contour" is an array of [x, y] points (implicitly closed). A "shape" is an
// array of contours filled together with the nonzero rule — so overlapping
// solid strokes union cleanly and ring contours (outer + reversed inner) keep
// their counters open. All geometry is authored elsewhere; this file only
// renders.

import zlib from "node:zlib";

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

/** "#rrggbb" -> [r, g, b] (0-255). */
export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

// ---------------------------------------------------------------------------
// Canvas — an RGB pixel buffer + the renderer
// ---------------------------------------------------------------------------

export class Canvas {
  constructor(width, height, bgHex) {
    this.w = width;
    this.h = height;
    this.buf = new Uint8ClampedArray(width * height * 3);
    const [r, g, b] = hexToRgb(bgHex);
    for (let i = 0; i < width * height; i++) {
      this.buf[i * 3] = r;
      this.buf[i * 3 + 1] = g;
      this.buf[i * 3 + 2] = b;
    }
  }

  /** Alpha-composite a colour onto one pixel. */
  _blend(x, y, rgb, a) {
    if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    if (a > 1) a = 1;
    const i = (y * this.w + x) * 3;
    const ia = 1 - a;
    this.buf[i] = rgb[0] * a + this.buf[i] * ia;
    this.buf[i + 1] = rgb[1] * a + this.buf[i + 1] * ia;
    this.buf[i + 2] = rgb[2] * a + this.buf[i + 2] * ia;
  }

  /**
   * Compute per-pixel coverage (0..1) for a shape (array of contours) using
   * nonzero winding, with `ss` vertical sub-scanlines and analytic horizontal
   * coverage. Returns a Float32Array(w*h). Cheap because it only walks the
   * shape's bounding rows.
   */
  coverage(contours, ss = 5) {
    const cov = new Float32Array(this.w * this.h);
    const edges = [];
    let minY = Infinity;
    let maxY = -Infinity;
    for (const pts of contours) {
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        if (a[1] === b[1]) continue; // skip horizontal edges
        edges.push(a[1] < b[1] ? [a[0], a[1], b[0], b[1], 1] : [b[0], b[1], a[0], a[1], -1]);
        minY = Math.min(minY, a[1], b[1]);
        maxY = Math.max(maxY, a[1], b[1]);
      }
    }
    if (!edges.length) return cov;
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.h - 1, Math.ceil(maxY));
    const xs = [];
    for (let py = y0; py <= y1; py++) {
      const rowOff = py * this.w;
      for (let k = 0; k < ss; k++) {
        const yc = py + (k + 0.5) / ss;
        xs.length = 0;
        for (const e of edges) {
          // edge stored low-y -> high-y; include [ylo, yhi)
          if (yc >= e[1] && yc < e[3]) {
            const t = (yc - e[1]) / (e[3] - e[1]);
            xs.push([e[0] + t * (e[2] - e[0]), e[4]]);
          }
        }
        if (xs.length < 2) continue;
        xs.sort((p, q) => p[0] - q[0]);
        let wind = 0;
        for (let i = 0; i < xs.length - 1; i++) {
          wind += xs[i][1];
          if (wind !== 0) this._span(cov, rowOff, xs[i][0], xs[i + 1][0], 1 / ss);
        }
      }
    }
    return cov;
  }

  /** Add weighted horizontal coverage over [xa, xb) into a row of `cov`. */
  _span(cov, rowOff, xa, xb, wt) {
    if (xb <= xa) return;
    xa = Math.max(0, xa);
    xb = Math.min(this.w, xb);
    if (xb <= xa) return;
    const i0 = Math.floor(xa);
    const i1 = Math.floor(xb - 1e-9);
    if (i0 === i1) {
      cov[rowOff + i0] += (xb - xa) * wt;
      return;
    }
    cov[rowOff + i0] += (i0 + 1 - xa) * wt;
    for (let x = i0 + 1; x < i1; x++) cov[rowOff + x] += wt;
    cov[rowOff + i1] += (xb - i1) * wt;
  }

  /** Fill a shape (contours) with a solid colour. */
  fill(contours, rgb, { ss = 5, alpha = 1 } = {}) {
    const cov = this.coverage(contours, ss);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = cov[y * this.w + x];
        if (c > 0) this._blend(x, y, rgb, Math.min(1, c) * alpha);
      }
    }
  }

  /**
   * Soft glow: blur a shape's coverage and composite the colour at a low
   * intensity. Used for the Red Line's halo — drawn before the sharp line.
   */
  glow(contours, rgb, { radius = 10, intensity = 0.5, passes = 3 } = {}) {
    let cov = this.coverage(contours, 4);
    for (let p = 0; p < passes; p++) cov = boxBlur(cov, this.w, this.h, radius);
    let peak = 0;
    for (let i = 0; i < cov.length; i++) if (cov[i] > peak) peak = cov[i];
    if (peak <= 0) return;
    const norm = intensity / peak;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const a = cov[y * this.w + x] * norm;
        if (a > 0.002) this._blend(x, y, rgb, a);
      }
    }
  }

  /** Encode the buffer as an 8-bit truecolour PNG (Buffer). */
  toPNG() {
    return encodePNG(this.w, this.h, this.buf);
  }

  /**
   * Box-downscale to a smaller PNG — used to preview how the icon reads at
   * small sizes (e.g. 48px) without any external tooling.
   */
  downscalePNG(tw, th) {
    const out = new Uint8ClampedArray(tw * th * 3);
    const sx = this.w / tw;
    const sy = this.h / th;
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        let r = 0, g = 0, b = 0, n = 0;
        const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
        const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
        for (let yy = y0; yy < y1; yy++) {
          for (let xx = x0; xx < x1; xx++) {
            const i = (yy * this.w + xx) * 3;
            r += this.buf[i]; g += this.buf[i + 1]; b += this.buf[i + 2]; n++;
          }
        }
        const o = (y * tw + x) * 3;
        out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
      }
    }
    return encodePNG(tw, th, out);
  }

  /** Sample one pixel as [r,g,b] — used by the pixel-verification step. */
  pixel(x, y) {
    const i = (Math.round(y) * this.w + Math.round(x)) * 3;
    return [this.buf[i], this.buf[i + 1], this.buf[i + 2]];
  }
}

// Separable box blur on a single-channel Float32 buffer.
function boxBlur(src, w, h, radius) {
  const r = Math.max(1, Math.round(radius));
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = r * 2 + 1;
  // horizontal
  for (let y = 0; y < h; y++) {
    const off = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[off + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[off + x] = acc / win;
      const xout = x - r, xin = x + r + 1;
      acc += src[off + Math.min(w - 1, Math.max(0, xin))];
      acc -= src[off + Math.min(w - 1, Math.max(0, xout))];
    }
  }
  // vertical
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win;
      const yout = y - r, yin = y + r + 1;
      acc += tmp[Math.min(h - 1, Math.max(0, yin)) * w + x];
      acc -= tmp[Math.min(h - 1, Math.max(0, yout)) * w + x];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// PNG encoder (truecolour, 8-bit, single IDAT) — Node zlib + a CRC table.
// ---------------------------------------------------------------------------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(w, h, rgb) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // filtered scanlines (filter 0 = none)
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < stride; x++) raw[y * (stride + 1) + 1 + x] = rgb[y * stride + x];
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// SVG helpers — emit the same contours as <path> data.
// ---------------------------------------------------------------------------

const r2 = (n) => Math.round(n * 100) / 100;

/** One shape (array of contours) -> a single path "d" string. */
export function contoursToPath(contours) {
  return contours
    .map((pts) => "M" + pts.map((p) => `${r2(p[0])} ${r2(p[1])}`).join("L") + "Z")
    .join(" ");
}
