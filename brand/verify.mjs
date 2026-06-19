// Verifies the brand kit: exact PNG dimensions, core palette present in each
// standalone SVG, and the palette actually rendered into pixels.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
const CORE = ["#0a0a0a", "#e10600", "#ededed"]; // bg · signal red · wordmark base
const marks = [
  { name: "aired-icon-512", w: 512, h: 512 },
  { name: "aired-profile-1080", w: 1080, h: 1080 },
  { name: "aired-cover-1640x856", w: 1640, h: 856 },
];

function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

let ok = true;
const fail = (m) => { ok = false; console.log("  ✗ " + m); };

for (const { name, w, h } of marks) {
  console.log(`\n${name}`);
  const svg = fs.readFileSync(path.join(OUT, `${name}.svg`), "utf8");
  const png = fs.readFileSync(path.join(OUT, `${name}.png`));

  // 1. PNG dimensions exact
  const ps = pngSize(png);
  ps.w === w && ps.h === h ? console.log(`  ✓ PNG ${ps.w}×${ps.h}`) : fail(`PNG ${ps.w}×${ps.h}, expected ${w}×${h}`);

  // 2. SVG declares exact size
  svg.includes(`width="${w}"`) && svg.includes(`height="${h}"`)
    ? console.log(`  ✓ SVG declares ${w}×${h}`) : fail("SVG size attrs missing/wrong");

  // 3. core palette literally present in the SVG
  for (const hex of CORE) svg.includes(hex) ? console.log(`  ✓ palette ${hex} present`) : fail(`palette ${hex} MISSING`);

  // 4. palette actually rendered into pixels
  const img = new Resvg(svg, { fitTo: { mode: "width", value: w } }).render();
  if (img.width !== w || img.height !== h) fail(`rendered ${img.width}×${img.height}`);
  const px = img.pixels; // RGBA
  let matte = 0, red = 0, brightMetal = 0, bronze = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    if (r <= 16 && g <= 16 && b <= 16) matte++;
    if (r > 175 && g < 70 && b < 70) red++;
    if (r > 235 && g > 235 && b > 235) brightMetal++;
    if (r > 120 && r < 225 && g > 85 && g < 185 && b > 35 && b < 135 && r > g && g > b) bronze++;
  }
  const total = (px.length / 4);
  const pct = (n) => ((n / total) * 100).toFixed(2) + "%";
  matte / total > 0.4 ? console.log(`  ✓ matte-black field ${pct(matte)}`) : fail(`matte field only ${pct(matte)}`);
  red > 200 ? console.log(`  ✓ red lacquer rendered (${red}px)`) : fail(`red pixels ${red}`);
  brightMetal > 200 ? console.log(`  ✓ bright metal highlight rendered (${brightMetal}px)`) : fail(`bright metal ${brightMetal}`);
  bronze > 150 ? console.log(`  ✓ bronze inlay rendered (${bronze}px)`) : fail(`bronze ${bronze}`);
}

console.log(ok ? "\nALL CHECKS PASSED ✓" : "\nSOME CHECKS FAILED ✗");
process.exit(ok ? 0 : 1);
