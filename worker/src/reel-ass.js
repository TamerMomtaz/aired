// REEL ASS — writes the whole on-screen layer of a reel as one ASS subtitle
// script, which ffmpeg burns in with libass (HarfBuzz shaping, FriBidi order).
// Everything that is TEXT or a crisp brand shape lives here; the artwork and its
// slow drift live in the background pass (ffmpeg.js). One script per render:
//
//   • LYRICS — one lyric line per card (Tee: "one line per screen, no auto-
//     scroll"), BIG, swapped in time with the song. Two highlight styles:
//       karaoke — the card appears dim and each word fills in as it is sung
//       line    — the card fades in whole, clean
//     Word timing is interpolated inside the line's window (the tap-sync editor
//     records line timestamps, not word timestamps).
//   • TITLE CARD — whenever no lyric is up (the intro, a long instrumental
//     break, the outro, or a song with no synced lyrics): AIRED-####, the title,
//     and the makers BY NAME (CLAUDE.md §3a).
//   • CAPTION — small, persistent: AIRED-#### · "Title", the makers, the address.
//   • THE RED LINE — the reel's progress bar, filling across the text column.
//   • THE LOCKUP — AIRED + the red square period + the Red Line beneath, in the
//     top-left corner, never over the lyrics. Off-white; ink on a bright cover.
//
// Identity & authorship only — never a style descriptor, never resemblance
// (CLAUDE.md §2, §3). Direction rule for every block: text hangs from its
// READING edge — LTR flush left, RTL (Arabic-first) flush right.

import { textColumn } from "./reel-layout.js";
import {
  FONT_LATIN,
  baseDirection,
  fitText,
  rowsToAss,
  singleRowAss,
  textWidth,
} from "./reel-text.js";

// ASS colours are &HBBGGRR (override tags) / &HAABBGGRR (styles), AA = 00 opaque.
const FG = "&HEDEDED&"; // #ededed off-white
const INK = "&H0A0A0A&"; // #0a0a0a near-black
const RED = "&H2D2DFF&"; // #ff2d2d cert-red

// A lyric line stays up at most this long without a new timestamp (an LRC with
// no blank "clear" line before a long instrumental would otherwise hold it).
const MAX_HOLD = 12;
// Anything shorter than this isn't worth flashing on screen.
const MIN_SHOW = 0.35;
// The title card fills gaps between lyric cards at least this long.
const CARD_LEAD_MIN = 1;
const CARD_GAP_MIN = 4;
const CARD_TAIL_MIN = 1;

const r = (n) => Math.round(n);
const r1 = (n) => Math.round(n * 10) / 10;
const pad2 = (n) => String(n).padStart(2, "0");

// Seconds → ASS time (h:mm:ss.cc).
function ts(sec) {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${pad2(m)}:${pad2(s)}.${pad2(cs % 100)}`;
}

function dialogue(layer, from, to, style, text) {
  return `Dialogue: ${layer},${ts(from)},${ts(to)},${style},,0,0,0,,${text}`;
}

// A filled rectangle as an ASS drawing, anchored by its top-left corner.
function rect(x, y, w, h, tags = "") {
  const W = Math.max(1, r(w));
  const H = Math.max(1, r(h));
  return `{\\an7\\pos(${r(x)},${r(y)})\\bord0\\shad0\\p1${tags}}m 0 0 l ${W} 0 ${W} ${H} 0 ${H}{\\p0}`;
}

// ── Timing ────────────────────────────────────────────────────────────────

// Timed lyric lines → cards on the reel's own clock (0 = the reel's first
// frame). `lines` are { t, text } (t in song seconds, null = un-timed, which a
// reel cannot place and skips). A blank timed line is a "clear" marker: it ends
// the line before it. Lines sharing a timestamp share a card.
export function lyricCards(lines, windowStart, windowSeconds) {
  const timed = (lines ?? [])
    .filter((l) => typeof l?.t === "number" && Number.isFinite(l.t))
    .map((l) => ({ t: l.t, text: String(l.text ?? "").trim() }))
    .sort((a, b) => a.t - b.t);

  const groups = [];
  for (const l of timed) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last.t - l.t) < 0.01) {
      if (l.text) last.texts.push(l.text);
    } else {
      groups.push({ t: l.t, texts: l.text ? [l.text] : [] });
    }
  }

  const windowEnd = windowStart + windowSeconds;
  const cards = [];
  groups.forEach((g, i) => {
    if (g.texts.length === 0) return;
    const next = groups[i + 1];
    const end = Math.min(next ? next.t : Infinity, g.t + MAX_HOLD);
    const from = Math.max(g.t, windowStart);
    const to = Math.min(end, windowEnd);
    if (to - from < MIN_SHOW) return;
    cards.push({
      texts: g.texts,
      lineStart: g.t - windowStart, // may be < 0: the line began before the window
      lineEnd: end - windowStart,
      from: from - windowStart,
      to: to - windowStart,
    });
  });
  return cards;
}

// The stretches where no lyric is up and the title card shows instead.
function titleCardSpans(cards, duration) {
  const spans = [];
  let cursor = 0;
  cards.forEach((c, i) => {
    if (c.from - cursor >= (i === 0 ? CARD_LEAD_MIN : CARD_GAP_MIN)) {
      spans.push({ from: cursor, to: c.from });
    }
    cursor = Math.max(cursor, c.to);
  });
  if (duration - cursor >= (cards.length ? CARD_TAIL_MIN : 0.01)) {
    spans.push({ from: cursor, to: duration });
  }
  return spans;
}

// Karaoke beats (centiseconds per unit, relative to the card's first frame).
// The line is "sung" across 90% of its window — capped at a natural pace so a
// line held for 12s doesn't crawl — and each unit gets a share by its weight.
// Units already sung before the card appears (a line clipped by the snippet
// window) get zero-length beats, so they show lit from the first frame.
function karaokeBeats(units, card) {
  const total = units.reduce((s, u) => s + u.weight, 0) || 1;
  const span = card.lineEnd - card.lineStart;
  const sung = Math.min(span * 0.9, Math.max(1, total * 0.55));
  let acc = 0;
  const starts = units.map((u) => {
    const s = card.lineStart + (sung * acc) / total;
    acc += u.weight;
    return Math.round(Math.max(0, s - card.from) * 100);
  });
  const endCs = Math.max(
    starts[starts.length - 1] + 1,
    Math.round((card.lineStart + sung - card.from) * 100),
  );
  return starts.map((s, i) => (i + 1 < starts.length ? starts[i + 1] : endCs) - s);
}

// ── Blocks ────────────────────────────────────────────────────────────────

// Where a block hangs: LTR from the column's left edge, RTL from its right.
function anchor(col, dir, an) {
  const rtl = dir === "rtl";
  // an: "mid" → vertically centred on y; "top" → top edge at y.
  const code = an === "mid" ? (rtl ? 6 : 4) : rtl ? 9 : 7;
  return { x: rtl ? col.right : col.left, code };
}

function lyricEvents(shape, cards, highlight) {
  const col = textColumn(shape);
  const { cy, fontSize, minFontSize, maxRows } = shape.lyric;
  return cards.map((card) => {
    const fit = fitText(card.texts, {
      width: col.width,
      fontSize,
      minFontSize,
      maxRows,
    });
    const dir = baseDirection(card.texts.join(" "));
    const { x, code } = anchor(col, dir, "mid");
    const fs = fit.fontSize;
    const beats = highlight === "karaoke" ? karaokeBeats(fit.units, card) : null;
    const lead = card.from > 0.05 ? 160 : 0; // no fade on a card the reel opens mid-line
    const head =
      `{\\an${code}\\pos(${x},${cy})\\fs${fs}` +
      `\\bord${r1(fs * 0.04)}\\blur${r1(fs * 0.07)}\\fad(${lead},140)}`;
    return dialogue(2, card.from, card.to, "Lyric", head + rowsToAss(fit.rows, { beats }));
  });
}

// "Tee Momtaz  ·  Claude  ·  Suno" with each name held together (no-break
// spaces) so a row only ever breaks BETWEEN makers.
function namesText(names) {
  return names.map((n) => n.trim().replace(/\s+/g, " ")).join("  ·  ");
}

// The same, capped to one row with a "+N" tail (the share cards' rule).
function namesRow(names, maxWidthEm) {
  for (let n = names.length; n >= 1; n--) {
    const head = names.slice(0, n).join("  ·  ");
    const text = n < names.length ? `${head}  +${names.length - n}` : head;
    if (textWidth(text) * 1.05 <= maxWidthEm) return text;
  }
  return names.length > 1 ? `${names[0]}  +${names.length - 1}` : (names[0] ?? "");
}

function titleCardEvents(shape, manifest, spans) {
  if (spans.length === 0) return [];
  const col = textColumn(shape);
  const c = shape.card;
  const titleText = `“${manifest.title}”`;
  const dir = baseDirection(manifest.title);
  const { x, code } = anchor(col, dir, "top");

  const title = fitText([titleText], {
    width: col.width,
    fontSize: c.titleSize,
    minFontSize: Math.round(c.titleSize * 0.6),
    maxRows: c.titleMaxRows,
  });
  const names = manifest.names?.length
    ? fitText([namesText(manifest.names)], {
        width: col.width,
        fontSize: c.namesSize,
        minFontSize: Math.round(c.namesSize * 0.75),
        maxRows: c.namesMaxRows,
      })
    : null;

  // Stack eyebrow · title · label · names, centred as a block on the lyric line.
  const titleH = title.rows.length * title.fontSize;
  const namesH = names ? names.rows.length * names.fontSize : 0;
  const total =
    c.eyebrowSize +
    c.gap +
    titleH +
    (names ? c.gap * 1.4 + c.labelSize + c.gap * 0.5 + namesH : 0);
  let y = shape.lyric.cy - total / 2;

  const blocks = [];
  const eyebrow =
    `{\\an${code}\\pos(${x},${r(y)})\\fs${c.eyebrowSize}\\fsp${r1(c.eyebrowSize * 0.3)}\\alpha&H26&}` +
    `{\\fn${FONT_LATIN}}${manifest.catalogId}` +
    (manifest.certified ? `  ·  {\\c${RED}\\alpha&H00&}RED LINE` : "");
  blocks.push(eyebrow);
  y += c.eyebrowSize + c.gap;

  blocks.push(
    `{\\an${code}\\pos(${x},${r(y)})\\fs${title.fontSize}` +
      `\\bord${r1(title.fontSize * 0.04)}\\blur${r1(title.fontSize * 0.07)}}` +
      rowsToAss(title.rows),
  );
  y += titleH;

  if (names) {
    y += c.gap * 1.4;
    blocks.push(
      `{\\an${code}\\pos(${x},${r(y)})\\fs${c.labelSize}\\fsp${r1(c.labelSize * 0.3)}\\alpha&H59&}` +
        `{\\fn${FONT_LATIN}}CREDITED, BY NAME`,
    );
    y += c.labelSize + c.gap * 0.5;
    blocks.push(
      `{\\an${code}\\pos(${x},${r(y)})\\fs${names.fontSize}\\alpha&H14&}` +
        rowsToAss(names.rows),
    );
  }

  return spans.flatMap((s) =>
    blocks.map((b) =>
      dialogue(2, s.from, s.to, "Card", `{\\fad(${s.from > 0 ? 300 : 0},300)}${b}`),
    ),
  );
}

function captionEvents(shape, manifest, duration) {
  const col = textColumn(shape);
  const cap = shape.caption;
  const events = [];
  // Row 1 — AIRED-#### · "Title" (identity: the number anchors, the title sings).
  events.push(
    dialogue(
      3,
      0,
      duration,
      "Caption",
      `{\\an7\\pos(${col.left},${cap.titleY})\\fs${cap.titleSize}}` +
        singleRowAss(
          `${manifest.catalogId} · “${manifest.title}”`,
          (cap.addressAlign === "right" ? col.width * 0.66 : col.width) / cap.titleSize,
        ),
    ),
  );
  // Row 2 — the makers, by name.
  if (manifest.names?.length) {
    events.push(
      dialogue(
        3,
        0,
        duration,
        "Caption",
        `{\\an7\\pos(${col.left},${cap.namesY})\\fs${cap.namesSize}\\b0\\alpha&H33&}` +
          singleRowAss(namesRow(manifest.names, col.width / cap.namesSize), col.width / cap.namesSize),
      ),
    );
  }
  // The address — where the song lives.
  const right = cap.addressAlign === "right";
  events.push(
    dialogue(
      3,
      0,
      duration,
      "Caption",
      `{\\an${right ? 9 : 7}\\pos(${right ? col.right : col.left},${cap.addressY})` +
        `\\fs${cap.addressSize}\\b0\\alpha&H59&}{\\fn${FONT_LATIN}}${manifest.address}`,
    ),
  );
  return events;
}

// The Red Line: a faint track across the column, a cert-red fill sweeping
// left → right over the reel's length, and a soft glow under the fill.
function redLineEvents(shape, duration) {
  const col = textColumn(shape);
  const { y, height } = shape.bar;
  const ms = Math.round(duration * 1000);
  const clip0 = `\\clip(${col.left},${y - 30},${col.left},${y + height + 30})`;
  const clip1 = `\\clip(${col.left},${y - 30},${col.right},${y + height + 30})`;
  const sweep = `${clip0}\\t(0,${ms},${clip1})`;
  return [
    dialogue(4, 0, duration, "Shape", rect(col.left, y, col.width, height, `\\c${FG}\\alpha&HCC&`)),
    dialogue(
      4,
      0,
      duration,
      "Shape",
      rect(col.left, y, col.width, height, `\\c${RED}\\3c${RED}\\bord${height}\\blur${height * 2}\\alpha&H80&${sweep}`),
    ),
    dialogue(5, 0, duration, "Shape", rect(col.left, y, col.width, height, `\\c${RED}${sweep}`)),
  ];
}

// The AIRED lockup, to brand/generate_social.py's ratios: tracking 0.12 cap,
// the red square period 0.26 cap sitting on the baseline, the Red Line 0.6 of
// the lockup's width, 0.42 cap below the baseline. libass geometry for Geist at
// Fontsize F (measured): cap height 0.525F, cap top 0.28F below the \an7 point,
// left bearing 0.02F, "AIRED" ink 2.21F wide before tracking.
function lockupEvents(shape, duration, ink) {
  const { x, capTop, cap } = shape.lockup;
  const F = cap / 0.525;
  const tracking = cap * 0.12;
  const inkW = 2.21 * F + 4 * tracking;
  const baseline = capTop + cap;
  const sq = cap * 0.26;
  const gapDot = tracking * 1.15;
  const totalW = inkW + gapDot + sq;
  const lineW = totalW * 0.6;
  const lineH = Math.max(2, cap * 0.05);
  const lineX = x + (totalW - lineW) / 2;
  const lineY = baseline + cap * 0.42;
  return [
    dialogue(
      6,
      0,
      duration,
      "Mark",
      `{\\an7\\pos(${r1(x - 0.02 * F)},${r1(capTop - 0.28 * F)})\\fs${r1(F)}\\fsp${r1(tracking)}` +
        `\\c${ink ? INK : FG}}AIRED`,
    ),
    dialogue(6, 0, duration, "Shape", rect(x + inkW + gapDot, baseline - sq, sq, sq, `\\c${RED}`)),
    dialogue(
      6,
      0,
      duration,
      "Shape",
      rect(lineX, lineY, lineW, lineH, `\\c${RED}\\3c${RED}\\bord${r1(lineH)}\\blur${r1(lineH * 2)}\\alpha&H66&`),
    ),
    dialogue(7, 0, duration, "Shape", rect(lineX, lineY, lineW, lineH, `\\c${RED}`)),
  ];
}

// The rectangle the lockup occupies (for the ink-vs-off-white luminance check).
export function lockupBox(shape) {
  const { x, capTop, cap } = shape.lockup;
  const F = cap / 0.525;
  const w = 2.21 * F + 4 * cap * 0.12 + cap * 0.12 * 1.15 + cap * 0.26;
  return { x, y: capTop, w, h: cap * 1.47 + Math.max(2, cap * 0.05) };
}

// ── The script ────────────────────────────────────────────────────────────

// shape      a REEL_SHAPES entry
// manifest   { catalogId, title, names[], certified, address, lines[{t,text}] }
// window     { start, seconds } — the slice of the song this reel plays
// highlight  "karaoke" | "line"
// ink        true → draw the lockup's wordmark in ink (a bright cover)
export function buildReelAss({ shape, manifest, window, highlight, ink }) {
  const duration = window.seconds;
  const cards = lyricCards(manifest.lines, window.start, duration);
  const spans = titleCardSpans(cards, duration);
  const col = textColumn(shape);

  const style = (name, size, primary, secondary, outline, align, bold = -1) =>
    `Style: ${name},${FONT_LATIN},${size},${primary},${secondary},${outline},&H00000000,` +
    `${bold},0,0,0,100,100,0,0,1,0,0,${align},${col.left},${shape.width - col.right},0,-1`;

  return [
    "[Script Info]",
    "; AIRED reel — generated by worker/src/reel-ass.js",
    "ScriptType: v4.00+",
    `PlayResX: ${shape.width}`,
    `PlayResY: ${shape.height}`,
    "WrapStyle: 1",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: None",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // Lyric: sung = off-white; not-yet-sung (karaoke) = off-white at ~40%; a
    // soft dark halo (outline + blur, set per event) keeps it legible on art.
    style("Lyric", shape.lyric.fontSize, "&H00EDEDED", "&H90EDEDED", "&H70000000", 4),
    style("Card", shape.card.titleSize, "&H00EDEDED", "&H00EDEDED", "&H70000000", 7),
    style("Caption", shape.caption.titleSize, "&H00EDEDED", "&H00EDEDED", "&H90000000", 7),
    style("Mark", 40, "&H00EDEDED", "&H00EDEDED", "&H00000000", 7),
    style("Shape", 20, "&H00EDEDED", "&H00EDEDED", "&H00000000", 7),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...lockupEvents(shape, duration, ink),
    ...redLineEvents(shape, duration),
    ...captionEvents(shape, manifest, duration),
    ...titleCardEvents(shape, manifest, spans),
    ...lyricEvents(shape, cards, highlight),
    "",
  ].join("\n");
}
