// Dependency-free PNG decoder — verifies exact dimensions and exact brand colors.
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

function decodePNG(file) {
  const buf = fs.readFileSync(file);
  let off = 8,
    width,
    height,
    bitDepth,
    colorType;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const bpp = channels * (bitDepth / 8);
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const ft = raw[p++];
    const line = raw.subarray(p, p + stride);
    p += stride;
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (ft === 1) v = (v + a) & 255;
      else if (ft === 2) v = (v + b) & 255;
      else if (ft === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (ft === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a),
          pb = Math.abs(pp - b),
          pc = Math.abs(pp - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[i] = v;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  const hex = (x, y) => {
    const o = y * stride + x * bpp;
    return "#" + [out[o], out[o + 1], out[o + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
  };
  return { width, height, hex };
}

const CHECKS = [
  {
    file: "png/aired-profile-1080.png",
    w: 1080,
    h: 1080,
    points: [
      { label: "bg corner", x: 20, y: 20, expect: "#0a0a0a" },
      { label: "red lacquer core", x: 540, y: 662, expect: "#e10600" },
      { label: "steel base #ededed", x: 396, y: 475, expect: "#ededed" },
    ],
  },
  {
    file: "png/aired-cover-1640x856.png",
    w: 1640,
    h: 856,
    points: [
      { label: "bg lower area", x: 820, y: 760, expect: "#0a0a0a" },
      { label: "red lacquer core", x: 820, y: 387, expect: "#e10600" },
      { label: "steel base #ededed", x: 321, y: 327, expect: "#ededed" },
    ],
  },
  {
    file: "png/aired-icon-512.png",
    w: 512,
    h: 512,
    points: [
      { label: "bg corner", x: 18, y: 18, expect: "#0a0a0a" },
      { label: "red lacquer core", x: 256, y: 256, expect: "#e10600" },
    ],
  },
];

let pass = true;
for (const c of CHECKS) {
  const img = decodePNG(path.join(__dirname, c.file));
  const dimOk = img.width === c.w && img.height === c.h;
  pass = pass && dimOk;
  console.log(`\n${c.file}  ${img.width}x${img.height}  ${dimOk ? "OK" : "DIM MISMATCH"}`);
  for (const pt of c.points) {
    const got = img.hex(pt.x, pt.y);
    const ok = got === pt.expect;
    pass = pass && ok;
    console.log(`  ${ok ? "✓" : "✗"} ${pt.label.padEnd(18)} (${pt.x},${pt.y}) = ${got}  expect ${pt.expect}`);
  }
}
console.log(`\n${pass ? "ALL EXACT ✓" : "MISMATCH ✗"}`);
process.exit(pass ? 0 : 1);
