// Small display helpers shared across pages.

// Render a duration as m:ss (or h:mm:ss past an hour). There is no length cap on
// AIRED works (CLAUDE.md §1.4), so this grows into hours naturally.
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (
    totalSeconds == null ||
    !Number.isFinite(totalSeconds) ||
    totalSeconds < 0
  ) {
    return "—";
  }
  const s = Math.round(totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Coerce any count-ish value to a non-negative whole number.
function asCount(count: number | null | undefined): number {
  return typeof count === "number" && Number.isFinite(count) && count > 0
    ? Math.floor(count)
    : 0;
}

// Compact play count for tight spots (work cards, lists): 942, 1.2K, 12K, 3.4M.
// The catalog has no ceiling, so this folds into K/M rather than ever wrapping.
export function formatPlayCount(count: number | null | undefined): string {
  const n = asCount(count);
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}K`;
  }
  const m = n / 1_000_000;
  return `${m < 10 ? m.toFixed(1).replace(/\.0$/, "") : Math.round(m)}M`;
}

// Spelled-out play count for the song page and accessible labels:
// "1,234 plays", "1 play", or a warm "No plays yet" at zero.
export function formatPlays(count: number | null | undefined): string {
  const n = asCount(count);
  if (n === 0) return "No plays yet";
  return `${n.toLocaleString("en-US")} play${n === 1 ? "" : "s"}`;
}
