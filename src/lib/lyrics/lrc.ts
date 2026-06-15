// LRC is AIRED's single source of truth for lyrics — both the words and their
// timing (Phase 4, "the heard half"). A `work.lyrics` value is plain text, one
// lyric line per line. A line may carry a leading timestamp tag and be sung in
// sync ("[mm:ss.xx]line text"), or carry none and render static ("line text").
//
// These helpers are shared by the public synced display and the owner's tap-sync
// editor so the two never drift on how a line is parsed or serialized.

export type LrcLine = {
  text: string;
  // Seconds from the start of the track, or null for an un-timed line.
  t: number | null;
};

// A leading timestamp tag: [mm:ss], [mm:ss.xx] or [mm:ss.xxx]. Minutes may grow
// past 99 (no song-length cap — CLAUDE.md §1.4); seconds are 0–59 with optional
// fractional centi/milliseconds after a "." or ":".
const LEADING_TAG = /^\s*\[(\d{1,3}):([0-5]?\d(?:[.:]\d{1,3})?)\]/;

// Parse an LRC string into one entry per source line. The first timestamp on a
// line wins; any further leading tags are stripped. Lines without a valid tag
// come back un-timed (t === null) and are meant to render static.
export function parseLrc(lrc: string | null | undefined): LrcLine[] {
  if (!lrc) return [];
  return lrc.split(/\r?\n/).map((raw) => {
    let rest = raw;
    let t: number | null = null;
    for (let m = rest.match(LEADING_TAG); m; m = rest.match(LEADING_TAG)) {
      if (t === null) {
        const minutes = parseInt(m[1], 10);
        const seconds = parseFloat(m[2].replace(":", "."));
        if (Number.isFinite(minutes) && Number.isFinite(seconds)) {
          t = minutes * 60 + seconds;
        }
      }
      rest = rest.slice(m[0].length);
    }
    // Trim only the seam left by a stripped tag; an un-timed line keeps its text.
    return { text: t === null ? rest : rest.replace(/^\s+/, ""), t };
  });
}

// Format seconds as an LRC timestamp body: mm:ss.xx (centisecond precision).
export function formatLrcTimestamp(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60; // 0 ≤ rest < 60
  const ss = rest.toFixed(2).padStart(5, "0"); // "ss.xx", e.g. 3.4 → "03.40"
  return `${String(minutes).padStart(2, "0")}:${ss}`;
}

// Serialize lines back to an LRC string. Timed lines get a leading tag; un-timed
// lines are written verbatim. Inverse of parseLrc for our own output.
export function toLrc(lines: LrcLine[]): string {
  return lines
    .map(({ text, t }) =>
      t === null ? text : `[${formatLrcTimestamp(t)}]${text}`,
    )
    .join("\n");
}
