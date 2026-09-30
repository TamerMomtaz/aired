// REEL TEXT — the lyric typesetter's measuring tape. Our songs carry Chinese,
// Arabic and English in ONE line, and a lyric card has to wrap and size that
// line before libass ever sees it, because:
//   • libass does not break CJK runs (no spaces → no wrap → the row runs off the
//     frame), so we place every row break ourselves; and
//   • "big and legible" means choosing a type size per line: start big, step
//     down only when the line would need more rows than the shape allows.
//
// Three faces, chosen PER SCRIPT RUN (never left to fontconfig fallback, which
// picks whatever Arabic face the system happens to have):
//   Latin → Geist (the brand face) · Arabic → Tajawal (the face the share cards
//   already use) · CJK → Noto Sans CJK SC (Han, kana and Hangul in one face).
// libass then shapes each run with HarfBuzz (Arabic joining + diacritics) and
// orders it with FriBidi, so a mixed line reads correctly in either direction.
//
// Widths are ESTIMATES in em of libass Fontsize, calibrated against libass's
// own output (Geist renders ~0.75 of its em metrics, a CJK ideograph ~0.69 of
// Fontsize, Tajawal ~0.34 per character). They lean slightly wide on purpose —
// a row that is estimated long just wraps a word early; a row estimated short
// would overflow the margin. libass's own end-of-line wrap is the last net.

export const FONT_LATIN = "Geist";
export const FONT_ARABIC = "Tajawal";
export const FONT_CJK = "Noto Sans CJK SC";

const ARABIC =
  /[؀-ۿݐ-ݿࡰ-࢟ࢠ-ࣿﭐ-﷿ﹰ-﻿]/u;
const HEBREW = /[֐-׿יִ-ﭏ]/u;
const CJK =
  /[⺀-⿟　-〿぀-ヿ㄀-ㄯ㄰-㆏㆐-ㇿ㈀-㏿㐀-䶿一-鿿ꥠ-꥿가-힯豈-﫿︰-﹏＀-￯\u{20000}-\u{2FA1F}]/u;
// Zero-width: combining marks (Arabic harakat included) and format controls.
const ZERO_WIDTH = /[\p{M}​-‏‪-‮⁠-⁩﻿]/u;
const LETTER = /\p{L}/u;
// Breaking spaces only — a no-break space (U+00A0, U+202F) holds a name together.
const SPACE = /[\t\n\v\f\r \u1680\u2000-\u200A\u2028\u2029\u205F\u3000]/u;
const NBSP = /[\u00A0\u202F]/u;
// Characters that must never START a row — they cling to what precedes them
// (CJK closing punctuation, and the Latin closers that sometimes follow CJK).
const NO_ROW_START =
  /[、。，．！？：；」』）】〉》〕｝〙〗〛％～…‥・ー,.!?:;)\]}»”’]/u;

// Estimated width of one character, in em of Fontsize.
function charWidth(ch) {
  if (ZERO_WIDTH.test(ch)) return 0;
  if (SPACE.test(ch) || NBSP.test(ch)) return 0.19;
  if (CJK.test(ch)) return 0.7;
  if (ARABIC.test(ch)) return 0.36;
  if (ch >= "A" && ch <= "Z") return 0.54;
  if (ch >= "a" && ch <= "z") return 0.44;
  if (ch >= "0" && ch <= "9") return 0.48;
  if (LETTER.test(ch)) return 0.48;
  return 0.34; // punctuation & symbols
}

export function textWidth(text) {
  let w = 0;
  for (const ch of text) w += charWidth(ch);
  return w;
}

// Which face a character belongs to; null for neutrals (spaces, digits,
// punctuation, marks), which simply continue the run they sit in.
function faceOf(ch) {
  if (ARABIC.test(ch)) return FONT_ARABIC;
  if (CJK.test(ch)) return FONT_CJK;
  if (LETTER.test(ch) && !ZERO_WIDTH.test(ch)) return FONT_LATIN;
  return null;
}

// The line's base direction, by its first strong character — the same rule
// libass applies with Encoding -1 (FriBidi's auto base direction), so the side
// we align to always matches the way libass orders the line.
export function baseDirection(text) {
  for (const ch of text) {
    if (ARABIC.test(ch) || HEBREW.test(ch)) return "rtl";
    if (LETTER.test(ch)) return "ltr";
  }
  return "ltr";
}

// The face a line opens in (its first strong character's face).
function openingFace(text) {
  for (const ch of text) {
    const f = faceOf(ch);
    if (f) return f;
  }
  return FONT_LATIN;
}

// Split a line into UNITS — the smallest pieces that never break: a word (with
// the spaces that follow it), or a single CJK character (with any closing
// punctuation that may not start a row). A unit is also the karaoke beat: in
// word-by-word mode each unit lights up on its own.
export function tokenize(text) {
  const units = [];
  let cur = null;
  const open = (ch, cjk) => {
    cur = { text: ch, trail: "", cjk };
    units.push(cur);
  };
  for (const ch of text) {
    if (SPACE.test(ch)) {
      if (cur) cur.trail += " ";
      continue;
    }
    const cjk = CJK.test(ch);
    if (!cur || cur.trail) {
      open(ch, cjk);
    } else if (NO_ROW_START.test(ch) || ZERO_WIDTH.test(ch)) {
      cur.text += ch; // cling to the previous unit
    } else if (cjk || cur.cjk) {
      open(ch, cjk); // a row may break before/after any ideograph
    } else {
      cur.text += ch;
    }
  }
  for (const u of units) {
    u.width = textWidth(u.text);
    u.trailWidth = textWidth(u.trail);
    let letters = 0;
    for (const ch of u.text) if (LETTER.test(ch)) letters++;
    // Karaoke weight: roughly how long the unit takes to sing. One beat per
    // ideograph; a word grows with its length.
    u.weight = u.cjk ? 1 : 0.6 + 0.12 * letters;
    u.rtl = ARABIC.test(u.text) || HEBREW.test(u.text);
  }
  return units;
}

// Greedy fill of units into rows no wider than `limit` (em).
function greedyRows(units, limit) {
  const rows = [];
  let row = [];
  let width = 0;
  for (const u of units) {
    if (row.length === 0) {
      row = [u];
      width = u.width;
      continue;
    }
    const next = width + row[row.length - 1].trailWidth + u.width;
    if (next > limit) {
      rows.push(row);
      row = [u];
      width = u.width;
    } else {
      row.push(u);
      width = next;
    }
  }
  if (row.length) rows.push(row);
  return rows;
}

// Balanced wrap: the fewest rows that fit `limit`, then the narrowest limit that
// still yields that many rows — so a two-row line splits near the middle rather
// than leaving one word stranded on the second row.
function balancedRows(units, limit) {
  if (units.length === 0) return [];
  const fewest = greedyRows(units, limit).length;
  let lo = Math.max(...units.map((u) => u.width));
  let hi = limit;
  if (lo >= hi) return greedyRows(units, limit);
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (greedyRows(units, mid).length <= fewest) hi = mid;
    else lo = mid;
  }
  return greedyRows(units, hi);
}

// Last resort for a single word wider than the whole column even at the floor
// size (a URL, a 60-letter coinage): cut it into column-wide pieces, the spaces
// after it riding on the last piece. Its karaoke weight is shared by length.
function splitOversized(units, limit) {
  return units.flatMap((u) => {
    if (u.width <= limit) return [u];
    const pieces = [];
    let text = "";
    let width = 0;
    for (const ch of u.text) {
      const w = charWidth(ch);
      if (text && width + w > limit) {
        pieces.push({ text, width });
        text = "";
        width = 0;
      }
      text += ch;
      width += w;
    }
    if (text) pieces.push({ text, width });
    return pieces.map((p, i) => ({
      ...u,
      text: p.text,
      width: p.width,
      trail: i === pieces.length - 1 ? u.trail : "",
      trailWidth: i === pieces.length - 1 ? u.trailWidth : 0,
      weight: (u.weight * p.width) / (u.width || 1),
    }));
  });
}

// Wrap and size text for a column. `paragraphs` are hard-separated (each starts
// a new row); the size steps down ~6% at a time until every paragraph fits in
// `maxRows` rows in total AND its widest word fits the column, never below
// `minFontSize` (a line that still needs more rows at the floor keeps them —
// lyrics are never cut; a word still too wide at the floor is split).
const SAFETY = 1.05;

export function fitText(paragraphs, { width, fontSize, minFontSize, maxRows }) {
  const tokenized = paragraphs.map((p) => tokenize(p)).filter((u) => u.length);
  const widest = Math.max(0, ...tokenized.flat().map((u) => u.width));
  let size = fontSize;
  for (;;) {
    const limit = width / (size * SAFETY);
    const fits = widest <= limit;
    const rows = tokenized.flatMap((units) => balancedRows(units, limit));
    if ((fits && rows.length <= maxRows) || size <= minFontSize) {
      if (fits) return { fontSize: size, rows, units: tokenized.flat() };
      const split = tokenized.map((units) => splitOversized(units, limit));
      return {
        fontSize: size,
        rows: split.flatMap((units) => balancedRows(units, limit)),
        units: split.flat(),
      };
    }
    size = Math.max(minFontSize, Math.floor(size * 0.94));
  }
}

// ASS text escaping: braces open override blocks and a backslash starts a tag,
// so lyrics can never carry either through verbatim. Swap in their full-width
// look-alikes (visually the same idea, inert to libass).
export function escapeAss(text) {
  return text.replace(/\\/g, "＼").replace(/\{/g, "｛").replace(/\}/g, "｝");
}

// Render rows of units to ASS text: `\N` between rows, a `\fn` tag whenever the
// script (and so the face) changes, and — when `beats` is given — a karaoke tag
// before each unit (`beats[i]` centiseconds for unit i, in unit order).
//
// The karaoke tag is chosen per unit: `\kf` sweeps a word's fill across it, but
// libass sweeps left → right in screen space, which runs BACKWARDS through an
// Arabic word. So RTL words take `\k` — lit whole on their beat — while the
// words still light in reading order, right to left.
export function rowsToAss(rows, { beats = null } = {}) {
  const allText = rows.flat().map((u) => u.text + u.trail).join("");
  let face = openingFace(allText);
  let out = `{\\fn${face}}`;
  let unitIndex = 0;
  rows.forEach((row, r) => {
    if (r > 0) out += "\\N";
    row.forEach((u, i) => {
      if (beats) out += `{${u.rtl ? "\\k" : "\\kf"}${beats[unitIndex]}}`;
      unitIndex++;
      const isRowEnd = i === row.length - 1;
      const piece = isRowEnd ? u.text : u.text + u.trail;
      for (const ch of piece) {
        const f = faceOf(ch);
        if (f && f !== face) {
          face = f;
          out += `{\\fn${face}}`;
        }
        out += escapeAss(ch);
      }
    });
  });
  return out;
}

// Plain single-row text with per-script faces (the caption, the eyebrow), cut
// with an ellipsis if it would run past `maxWidthEm`.
export function singleRowAss(text, maxWidthEm) {
  let t = text.trim();
  if (textWidth(t) * SAFETY > maxWidthEm) {
    const chars = Array.from(t);
    while (chars.length > 1 && (textWidth(chars.join("")) + 0.4) * SAFETY > maxWidthEm) {
      chars.pop();
    }
    t = chars.join("").trimEnd() + "…";
  }
  return rowsToAss([[{ text: t, trail: "", width: 0, trailWidth: 0 }]]);
}
