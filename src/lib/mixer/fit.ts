import { chooseRate } from "./script";

// TeeJay's ears on a suggestion: of the songs he picked (best first), keep the
// ones whose tempos can all meet at one set tempo, so no song in a suggested
// set is left to be cut in cold. Half and double time count (chooseRate).
//
// Every set tempo the songs could share is tried (each song's own tempo, and
// the mood's window, nudged in small steps); the one that locks the most songs
// wins, with TeeJay's earlier picks counting a little more. Returns indexes into
// `bpms`, in their original order, between `min` and `max` of them: if fewer
// than `min` can lock, the next picks fill in (the cut toolbox handles those).
export function keepMeeting(bpms: number[], window: [number, number] | undefined, max: number, min: number): number[] {
  const n = bpms.length;
  if (n <= min) return bpms.map((_, i) => i);
  const bases = [...bpms];
  if (window) bases.push((window[0] + window[1]) / 2);
  let best: number[] = [];
  let bestScore = -Infinity;
  for (const base of bases) {
    for (let k = -20; k <= 20; k++) {
      const m = base * (1 + k * 0.005);
      const locked: number[] = [];
      let score = 0;
      let stretch = 0;
      for (let i = 0; i < n; i++) {
        const r = chooseRate(m, bpms[i]);
        if (!r.synced) continue;
        locked.push(i);
        score += 1 + (n - i) * 0.05;
        stretch += Math.abs(r.rate - 1);
      }
      score -= stretch * 2;
      if (window && (m < window[0] * 0.95 || m > window[1] * 1.05)) score -= 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = locked;
      }
    }
  }
  const keep = best.slice(0, max);
  for (let i = 0; i < n && keep.length < min; i++) if (!keep.includes(i)) keep.push(i);
  return keep.sort((a, b) => a - b);
}
