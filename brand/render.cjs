// Render AIRED brand assets from the self-contained HTML to exact-size PNGs.
// Each inline <svg> is extracted by its ASSET markers and screenshotted 1:1.
const fs = require("fs");
const path = require("path");

let pw;
try {
  pw = require("playwright");
} catch {
  pw = require("/opt/node22/lib/node_modules/playwright"); // global fallback
}
const { chromium } = pw;

const htmlPath = path.join(__dirname, "aired-brand-kit.html");
const html = fs.readFileSync(htmlPath, "utf8");

const ASSETS = [
  { id: "profile", w: 1080, h: 1080, out: "png/aired-profile-1080.png" },
  { id: "cover", w: 1640, h: 856, out: "png/aired-cover-1640x856.png" },
  { id: "icon", w: 512, h: 512, out: "png/aired-icon-512.png" },
];

function extract(id) {
  const open = `<!--ASSET:${id}-->`;
  const close = `<!--/ASSET:${id}-->`;
  const a = html.indexOf(open);
  const b = html.indexOf(close);
  if (a < 0 || b < 0) throw new Error(`markers not found for ${id}`);
  return html.slice(a + open.length, b).trim();
}

(async () => {
  fs.mkdirSync(path.join(__dirname, "png"), { recursive: true });
  fs.mkdirSync(path.join(__dirname, "svg"), { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  let allOk = true;

  for (const a of ASSETS) {
    const svg = extract(a.id);
    // also emit a standalone, scalable SVG source file
    fs.writeFileSync(
      path.join(__dirname, "svg", `aired-${a.id}.svg`),
      `<?xml version="1.0" encoding="UTF-8"?>\n${svg}\n`
    );
    const page = await ctx.newPage();
    await page.setViewportSize({ width: a.w, height: a.h });
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>
         *{margin:0;padding:0;box-sizing:border-box}
         html,body{width:${a.w}px;height:${a.h}px;background:#0a0a0a;overflow:hidden}
         svg{display:block}
       </style></head><body>${svg}</body></html>`,
      { waitUntil: "networkidle" }
    );
    await page.evaluate(() => (document.fonts && document.fonts.ready) || true);
    const outPath = path.join(__dirname, a.out);
    await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: a.w, height: a.h } });
    await page.close();

    const buf = fs.readFileSync(outPath);
    const W = buf.readUInt32BE(16);
    const H = buf.readUInt32BE(20); // PNG IHDR width/height
    const ok = W === a.w && H === a.h;
    allOk = allOk && ok;
    console.log(
      `${ok ? "OK " : "ERR"}  ${a.id.padEnd(8)} ${String(W).padStart(4)}x${String(H).padStart(4)}  ${(buf.length / 1024).toFixed(1)} KB  -> ${a.out}`
    );
  }

  await browser.close();
  if (!allOk) process.exit(2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
