// The SET SCRIPT: the plan a DJ makes before touching the decks. Which song
// plays when, which part of it, for how long, how it comes in, and what the
// DJ adds on top. The DJ brain (Claude, on the server) writes one; when the
// brain is off or unreachable, `rulesScript` writes one from the same
// analysis. Either way `fixScript` makes it safe before the engine plays it.
//
// Everything here is plain data. No audio, no secrets: the brain only ever sees
// numbers about the songs plus their public titles, makers and descriptors.

import { camelotDistance, shiftKey, type MusicalKey } from "./key";
import type { PhraseLabel } from "./structure";

export type Energy = "lounge" | "club" | "peak";
export type MixMinutes = 5 | 7 | 10;
export type Move = "open" | "blend" | "mashup" | "cut";
export type Bars = 8 | 16 | 32;

export type Fx = {
  kick: boolean; // add a four-on-the-floor kick
  hats: boolean; // off-beat hats
  claps: boolean; // claps on 2 and 4
  pump: boolean; // sidechain pumping on the music
  riser: boolean; // noise riser over the last bars, into the next part
  drop: boolean; // sub boom + crash on the next part's first beat
  loopBuild: boolean; // stutter the last 4 bars: 1 bar, ½, ¼ loops
  breakdown: boolean; // strip the bass out of this part
  filterRise: boolean; // high-pass climb over the last 8 bars
};

export type ScriptVisit = {
  song: number; // index into the songs
  phrase: number; // the phrase it starts on
  bars: Bars;
  move: Move; // how it comes in
  fx: Fx;
  note?: string; // the DJ's reason, shown to the listener
};

export type SetScript = {
  title: string;
  story: string;
  visits: ScriptVisit[];
  by: "brain" | "rules";
};

// What the planner knows about each song.
export type SongBrief = {
  title: string;
  makers: string[];
  descriptors: string[];
  bpm: number;
  key: MusicalKey;
  duration: number;
  phrases: { start: number; label: PhraseLabel; energy: number; bass: number }[];
};

export const NO_FX: Fx = {
  kick: false,
  hats: false,
  claps: false,
  pump: false,
  riser: false,
  drop: false,
  loopBuild: false,
  breakdown: false,
  filterRise: false,
};

const MAX_NUDGE = 0.12;

export function chooseRate(master: number, bpm: number): { rate: number; synced: boolean } {
  const ratio = master / bpm;
  let best = ratio;
  for (const c of [ratio * 2, ratio / 2]) if (Math.abs(c - 1) < Math.abs(best - 1)) best = c;
  if (Math.abs(best - 1) <= MAX_NUDGE) return { rate: best, synced: true };
  return { rate: 1, synced: false };
}

export function barSeconds(bpm: number): number {
  return (4 * 60) / bpm;
}

// Can phrase `p` of song `s` play for `bars` output bars at this rate?
function fits(s: SongBrief, p: number, bars: number, srcBar: number): boolean {
  const ph = s.phrases[p];
  return !!ph && ph.start + (bars + 4) * srcBar <= s.duration - 0.05;
}

// Make any script safe to play: real songs and phrases, sections that fit,
// moves the tempos allow, effects that don't fight each other, and at least the
// asked-for length (topped up from the rules planner if short).
export function fixScript(
  script: SetScript,
  songs: SongBrief[],
  energy: Energy,
  minutes: MixMinutes,
): SetScript {
  if (script.visits.length === 0 || !songs[script.visits[0]?.song]) {
    return rulesScript(songs, energy, minutes);
  }
  const master = songs[script.visits[0].song].bpm;
  const mBar = barSeconds(master);
  const rates = songs.map((s) => chooseRate(master, s.bpm));
  const out: ScriptVisit[] = [];
  let total = 0;

  for (const raw of script.visits.slice(0, 48)) {
    const s = songs[raw.song];
    if (!s) continue;
    const srcBar = mBar * rates[raw.song].rate;
    let bars: Bars = raw.bars === 8 || raw.bars === 32 ? raw.bars : 16;
    let phrase = Math.max(0, Math.min(s.phrases.length - 1, Math.round(raw.phrase)));
    while (bars > 8 && !fits(s, phrase, bars, srcBar)) bars = (bars / 2) as Bars;
    while (phrase > 0 && !fits(s, phrase, bars, srcBar)) phrase--;
    if (!fits(s, phrase, bars, srcBar)) continue;

    const prev = out[out.length - 1];
    let move: Move = raw.move;
    if (!prev) move = "open";
    else if (move === "open") move = "blend";
    if (prev && (!rates[raw.song].synced || !rates[prev.song].synced)) move = "cut";
    // A loop build ends on a hard drop, so whatever follows it cuts in.
    if (prev?.fx.loopBuild) move = "cut";
    const fx: Fx = { ...NO_FX, ...raw.fx };
    if (!rates[raw.song].synced) {
      fx.kick = fx.hats = fx.claps = fx.pump = false;
      fx.loopBuild = false;
    }
    if (fx.breakdown) {
      fx.kick = fx.pump = false;
      if (move === "mashup") move = "blend";
    }
    if (bars < 8) fx.loopBuild = false;
    if (energy === "lounge") {
      fx.claps = fx.loopBuild = false;
      if (move === "cut" && prev && rates[raw.song].synced && rates[prev.song].synced) move = "blend";
    }
    out.push({ song: raw.song, phrase, bars, move, fx, note: raw.note?.slice(0, 160) });
    total += bars * mBar;
  }
  if (out.length === 0) return rulesScript(songs, energy, minutes);

  // Top up a short script with more parts in the same spirit.
  if (total < minutes * 60) {
    const extra = rulesScript(songs, energy, minutes, out[0].song).visits;
    const used = new Set(out.map((v) => `${v.song}:${v.phrase}`));
    for (const v of extra) {
      if (total >= minutes * 60) break;
      if (used.has(`${v.song}:${v.phrase}`) && extra.length > out.length) continue;
      const prev = out[out.length - 1];
      const move: Move =
        !rates[v.song].synced || !rates[prev.song].synced || prev.fx.loopBuild ? "cut" : v.move === "open" ? "blend" : v.move;
      out.push({ ...v, move });
      total += v.bars * mBar;
    }
  }
  // The last part never builds into nothing.
  const last = out[out.length - 1];
  last.fx = { ...last.fx, loopBuild: false, riser: false, drop: false };
  return { ...script, visits: out };
}

// Order songs so each next one sits close on the Camelot wheel, starting from
// the opener the listener picked. Songs that can't lock tempo go last.
function harmonicOrder(songs: SongBrief[], opener: number): number[] {
  const master = songs[opener].bpm;
  const left = songs.map((_, i) => i).filter((i) => i !== opener);
  const order = [opener];
  while (left.length) {
    const cur = songs[order[order.length - 1]];
    const curKey = shiftKey(cur.key, chooseRate(master, cur.bpm).rate);
    let best = 0;
    let bestScore = Infinity;
    left.forEach((i, k) => {
      const r = chooseRate(master, songs[i].bpm);
      const key = shiftKey(songs[i].key, r.rate);
      const score = camelotDistance(curKey, key) + (r.synced ? 0 : 10) + k * 0.01;
      if (score < bestScore) {
        bestScore = score;
        best = k;
      }
    });
    order.push(left.splice(best, 1)[0]);
  }
  return order;
}

// The built-in planner: harmonic song order, songs taking turns in 16-bar
// parts that move forward through each song, and an energy arc of warm-up,
// build, a breakdown, a loop build into the big drop, peak, outro.
export function rulesScript(
  songs: SongBrief[],
  energy: Energy,
  minutes: MixMinutes,
  opener = 0,
): SetScript {
  const order = harmonicOrder(songs, opener);
  const master = songs[opener].bpm;
  const mBar = barSeconds(master);
  const n = Math.max(songs.length * 2, Math.ceil((minutes * 60) / (16 * mBar)));
  const per = order.map((_, i) => Math.floor(n / order.length) + (i < n % order.length ? 1 : 0));

  // Each song's parts, in its own order: the strongest phrase in each stretch.
  const parts = order.map((si, oi) => {
    const s = songs[si];
    const srcBar = mBar * chooseRate(master, s.bpm).rate;
    const cands = s.phrases.map((p, i) => ({ i, p })).filter(({ i }) => fits(s, i, 16, srcBar));
    const count = per[oi];
    const picks: number[] = [];
    if (cands.length === 0) return Array(count).fill(0);
    if (oi === 0) picks.push(cands[0].i);
    const rest = oi === 0 ? cands.slice(1) : cands;
    const want = count - picks.length;
    for (let k = 0; k < want && rest.length; k++) {
      const lo = Math.floor((k * rest.length) / want);
      const hi = Math.max(lo + 1, Math.floor(((k + 1) * rest.length) / want));
      const slice = rest.slice(lo, hi);
      slice.sort((a, b) => b.p.energy - a.p.energy);
      picks.push(slice[0].i);
    }
    while (picks.length < count) picks.push(picks[picks.length % Math.max(1, picks.length)] ?? 0);
    return picks;
  });

  const used = order.map(() => 0);
  const visits: ScriptVisit[] = [];
  const peakAt = Math.max(2, Math.round(n * 0.62));
  for (let v = 0; v < n; v++) {
    let oi = v % order.length;
    for (let k = 0; k < order.length && used[oi] >= parts[oi].length; k++) oi = (oi + 1) % order.length;
    const song = order[oi];
    const phrase = parts[oi][used[oi]++];
    const f = n > 1 ? v / (n - 1) : 0;
    const stage = f < 0.14 ? "warm" : f < 0.34 ? "build" : f < 0.86 ? "peak" : "outro";
    const fx: Fx = { ...NO_FX };
    let note: string | undefined;
    const drums = energy !== "lounge";
    if (stage === "build") {
      fx.kick = drums;
      fx.hats = drums;
      fx.pump = true;
    } else if (stage === "peak") {
      fx.kick = drums;
      fx.hats = drums;
      fx.claps = energy === "peak";
      fx.pump = true;
    }
    if (v === peakAt - 2 && energy !== "lounge") {
      fx.breakdown = true;
      fx.kick = fx.pump = fx.claps = false;
      note = "Breakdown: strip the bass and let the melody breathe before the big moment.";
    }
    if (v === peakAt - 1 && energy !== "lounge") {
      fx.loopBuild = true;
      fx.riser = true;
      fx.drop = true;
      note = "Loop build: the last bars stutter tighter and tighter into the drop.";
    }
    if (v === peakAt) note = "The drop: everything back in at full power.";
    if (stage !== "warm" && stage !== "outro" && energy === "peak" && v % 4 === 3) {
      fx.riser = true;
      fx.drop = true;
    }
    if (stage === "build" && v === Math.round(n * 0.3)) fx.filterRise = true;
    const move: Move =
      v === 0 ? "open" : energy !== "lounge" && stage !== "warm" && v % 3 === 2 ? "mashup" : "blend";
    visits.push({ song, phrase, bars: 16, move, fx, note });
  }
  return {
    title: order.map((i) => songs[i].title).join(" × "),
    story: "Songs ordered so their keys sit next to each other, trading 16-bar parts, building to one big drop.",
    visits,
    by: "rules",
  };
}
