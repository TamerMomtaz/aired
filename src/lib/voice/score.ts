import type { CatalogSong } from "./catalog";
import { consonantSkeleton, foldText, isArabicScript } from "./normalize";

// Keyword scoring over the voice catalog. This is the part that works with no
// AI at all: it finds songs whose title, makers, or lyrics contain the words the
// listener said. When an AI key is configured, the AI widens the words first
// (translations, transliterations, synonyms) and then picks among what this
// finds — but this stays the engine, so search never depends on a paid call.

export type Hit = {
  song: CatalogSong;
  score: number;
  // Lyric lines that matched, in song order (at most a few).
  matchedLines: string[];
};

// "الشمس" and "شمس", "والقمر" and "قمر": drop a leading Arabic article or
// conjunction+article so a word matches with or without it.
function stem(word: string): string {
  const m = word.match(/^(?:وال|بال|فال|كال|لل|ال)(.{2,})$/);
  return m ? m[1] : word;
}

type Tok = { w: string; ar: boolean; sk: string };

function skeletonUsable(word: string, sk: string): boolean {
  return sk.length >= 3 || (sk.length === 2 && word.length >= 5);
}

function makeTok(w: string): Tok {
  const sk = consonantSkeleton(w);
  return { w, ar: isArabicScript(w), sk: skeletonUsable(w, sk) ? sk : "" };
}

function tokens(folded: string): Tok[] {
  return folded.split(" ").filter(Boolean).map((w) => makeTok(stem(w)));
}

// How well one query term matches one token: exact beats prefix beats a
// cross-script sound-alike beats nothing. Prefix matching forgives a speech
// recognizer's wrong ending ("dancing" for "dance"), but only for terms long
// enough that a prefix still means something. The sound-alike only bridges
// Arabic script and Latin letters ("فرافيش" ↔ "farafeesh"), never within one
// script, where it would be too loose.
function termMatch(term: Tok, token: Tok): number {
  if (term.w === token.w) return 1;
  if (term.w.length >= 4 && token.w.length >= 4) {
    if (token.w.startsWith(term.w) || term.w.startsWith(token.w)) return 0.6;
  }
  if (term.ar !== token.ar && term.sk && term.sk === token.sk) {
    return term.sk.length >= 3 ? 0.7 : 0.5;
  }
  return 0;
}

function bestIn(term: Tok, toks: Tok[]): number {
  let best = 0;
  for (const t of toks) {
    const m = termMatch(term, t);
    if (m > best) best = m;
    if (best === 1) break;
  }
  return best;
}

// Tokenizing a song's lyrics is the costly part, and the catalog object is
// reused across requests for minutes at a time, so tokens are memoized per song.
type SongToks = { title: Tok[]; meta: Tok[]; lines: Tok[][] };
const songToks = new WeakMap<CatalogSong, SongToks>();
function tokensFor(song: CatalogSong): SongToks {
  let t = songToks.get(song);
  if (!t) {
    t = {
      title: tokens(song.foldedTitle),
      meta: tokens(song.foldedMeta),
      lines: song.foldedLines.map(tokens),
    };
    songToks.set(song, t);
  }
  return t;
}

export function scoreCatalog(
  songs: CatalogSong[],
  rawTerms: string[],
  phrases: string[] = [],
  limit = 12,
): Hit[] {
  const terms = Array.from(
    new Set(rawTerms.flatMap((t) => foldText(t).split(" ")).map(stem)),
  )
    .filter((t) => t.length >= 2)
    .map(makeTok);
  const foldedPhrases = phrases
    .map(foldText)
    .filter((p) => p.split(" ").length >= 2);
  if (terms.length === 0 && foldedPhrases.length === 0) return [];

  const hits: Hit[] = [];
  for (const song of songs) {
    const {
      title: titleToks,
      meta: metaToks,
      lines: lineToks,
    } = tokensFor(song);

    let score = 0;
    const lineScore = new Array<number>(lineToks.length).fill(0);
    let termsFound = 0;

    for (const term of terms) {
      const inTitle = bestIn(term, titleToks);
      const inMeta = bestIn(term, metaToks);
      let inLyrics = 0;
      for (let i = 0; i < lineToks.length; i++) {
        const m = bestIn(term, lineToks[i]);
        if (m > 0) {
          lineScore[i] += m;
          if (m > inLyrics) inLyrics = m;
        }
      }
      const best = Math.max(inTitle * 4, inMeta * 2.5, inLyrics * 1.5);
      if (best > 0) termsFound++;
      score += best;
    }

    // A whole remembered phrase ("ana add haaly") sung in one line is a strong
    // signal — stronger than its words scattered across the song.
    for (const phrase of foldedPhrases) {
      if (song.foldedTitle.includes(phrase)) score += 6;
      for (let i = 0; i < song.foldedLines.length; i++) {
        if (song.foldedLines[i].includes(phrase)) {
          lineScore[i] += 3;
          score += 4;
          break;
        }
      }
    }

    if (score <= 0) continue;
    // Reward songs that contain MORE of the distinct words said, so a song with
    // three of the listener's words beats one that repeats a single common word.
    if (terms.length > 1) score *= 0.5 + termsFound / terms.length;

    const matchedLines = lineScore
      .map((s, i) => ({ s, i }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .slice(0, 4)
      .sort((a, b) => a.i - b.i)
      .map((x) => song.lines[x.i]);

    hits.push({ song, score, matchedLines });
  }

  hits.sort((a, b) => b.score - a.score || a.song.id - b.song.id);
  return hits.slice(0, limit);
}
