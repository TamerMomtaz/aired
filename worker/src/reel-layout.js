// REEL LAYOUT — one tuned geometry per shape. Tee's call (2026-09-30): do NOT
// reuse one lyric layout across ratios; 9:16, 1:1 and 16:9 each get their own
// type size, row budget and safe margins so the big lyrics sit right in every
// frame. Everything the typesetter (reel-ass.js) and the background pass
// (ffmpeg.js) place is read from here — no coordinate lives in two files.
//
// Units are output pixels (the ASS script's PlayRes is the frame size, 1:1).
// Font sizes are libass Fontsize: one row of text is exactly `fontSize` tall
// (measured for Geist, Tajawal and Noto Sans CJK alike), and a capital letter is
// ~0.525 × fontSize tall.
//
//   margin   the text column. Lyrics, the title card, the Red Line and the
//            caption all hang off these two edges (LTR flush left, RTL flush
//            right). 9:16 keeps a wider right margin: Reels / TikTok stack their
//            like / comment / share rail there.
//   lockup   the corner AIRED lockup, by its cap height (brand/generate_social.py
//            ratios). Top-left, inside the platform header's safe zone.
//   lyric    ONE lyric line per card: its vertical centre, its starting size,
//            the floor it may shrink to, and the most rows it may wrap into
//            before it has to shrink (the per-shape "line-count").
//   card     the title card shown whenever no lyric is on screen (intro,
//            instrumental breaks, outro, or a song without synced lyrics).
//   bar      the Red Line — the reel's progress bar, the platform's signature.
//   caption  the small persistent credit block under the Red Line:
//            AIRED-#### · "Title", the makers by name, the address.
//   scrim    how the artwork is dimmed so off-white type always reads: an
//            overall dim plus soft darker bands behind the lyric + caption zones.

export const REEL_SHAPES = {
  // 9:16 — Reels / TikTok / Shorts / Stories. Bottom ~22% belongs to the
  // platform's own caption + buttons, so the credit block ends above it.
  vertical: {
    width: 1080,
    height: 1920,
    ratio: "9:16",
    fileTag: "9x16",
    margin: { left: 84, right: 150 },
    lockup: { x: 84, capTop: 196, cap: 34 },
    lyric: { cy: 800, fontSize: 116, minFontSize: 70, maxRows: 4 },
    card: {
      eyebrowSize: 30,
      titleSize: 96,
      titleMaxRows: 3,
      labelSize: 22,
      namesSize: 40,
      namesMaxRows: 2,
      gap: 26,
    },
    bar: { y: 1300, height: 6 },
    caption: {
      titleY: 1330,
      titleSize: 36,
      namesY: 1378,
      namesSize: 30,
      addressY: 1422,
      addressSize: 26,
      addressAlign: "left",
    },
    scrim: {
      dim: 0.62,
      bands: [
        { cy: 800, sigma: 560, strength: 0.38 },
        { cy: 1390, sigma: 230, strength: 0.3 },
      ],
    },
  },

  // 1:1 — the Instagram / Facebook feed. Few overlays; even margins.
  square: {
    width: 1080,
    height: 1080,
    ratio: "1:1",
    fileTag: "1x1",
    margin: { left: 72, right: 72 },
    lockup: { x: 72, capTop: 66, cap: 28 },
    lyric: { cy: 470, fontSize: 96, minFontSize: 60, maxRows: 3 },
    card: {
      eyebrowSize: 24,
      titleSize: 80,
      titleMaxRows: 2,
      labelSize: 18,
      namesSize: 32,
      namesMaxRows: 2,
      gap: 20,
    },
    bar: { y: 858, height: 5 },
    caption: {
      titleY: 882,
      titleSize: 30,
      namesY: 922,
      namesSize: 25,
      addressY: 960,
      addressSize: 22,
      addressAlign: "left",
    },
    scrim: {
      dim: 0.62,
      bands: [
        { cy: 470, sigma: 330, strength: 0.38 },
        { cy: 930, sigma: 150, strength: 0.3 },
      ],
    },
  },

  // 16:9 — YouTube. A 6–12 minute lyric video is a YouTube-shaped deliverable:
  // wide column, two rows max, the address on the right of the caption row.
  landscape: {
    width: 1920,
    height: 1080,
    ratio: "16:9",
    fileTag: "16x9",
    margin: { left: 132, right: 132 },
    lockup: { x: 132, capTop: 78, cap: 30 },
    lyric: { cy: 470, fontSize: 124, minFontSize: 80, maxRows: 2 },
    card: {
      eyebrowSize: 28,
      titleSize: 104,
      titleMaxRows: 2,
      labelSize: 20,
      namesSize: 38,
      namesMaxRows: 1,
      gap: 22,
    },
    bar: { y: 884, height: 5 },
    caption: {
      titleY: 910,
      titleSize: 32,
      namesY: 954,
      namesSize: 27,
      addressY: 912,
      addressSize: 26,
      addressAlign: "right",
    },
    scrim: {
      dim: 0.62,
      bands: [
        { cy: 470, sigma: 330, strength: 0.38 },
        { cy: 940, sigma: 150, strength: 0.3 },
      ],
    },
  },
};

export const REEL_SHAPE_NAMES = new Set(Object.keys(REEL_SHAPES));

// The artwork is prepared this much wider than the frame so the slow Ken-Burns
// drift has room to travel. The drift is HORIZONTAL only: the scrim is a
// function of y alone, so baking it into the wider still keeps the dark bands
// exactly behind the lyric + caption zones for the whole pan.
export const REEL_OVERSCAN = 0.08;

// One full left→right→left drift of the artwork, in seconds.
export const REEL_PAN_PERIOD = 90;

// The column the text hangs in, for a shape.
export function textColumn(shape) {
  const { width, margin } = shape;
  return {
    left: margin.left,
    right: width - margin.right,
    width: width - margin.left - margin.right,
  };
}
