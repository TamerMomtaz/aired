// The SET SCRIPT: the plan a DJ makes before touching the decks. Which song
// plays when, which part of it, for how long, how it comes in, what lines from
// the other songs get dropped on top of it, and what the DJ adds. The DJ brain
// (Claude, on the server) writes one; when the brain is off or unreachable,
// `rulesScript` writes one from the same analysis. Either way `fixScript` makes
// it safe before the engine plays it.
//
// Everything here is plain data. No audio, no secrets: the brain only ever sees
// numbers about the songs plus their public titles, makers and descriptors.

import { camelotDistance, shiftKey, type MusicalKey } from "./key";
import type { PhraseLabel } from "./structure";

export type Energy = "lounge" | "club" | "peak";
export type MixMinutes = 5 | 7 | 10;
// open   — the first part
// blend  — slow bass swap
// mashup — for 4 bars the old part keeps its beat and bass under the new top
// trade  — call and response: the two songs swap every 2 bars (1 at Peak)
//          for 8 bars before the new one takes over
// cut    — echo out, slam in
export type Move = "open" | "blend" | "mashup" | "trade" | "cut";
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

// A LINE lifted from another song (or this one) and dropped on top of a part:
// the linking between songs. Only its voice and melody range plays (no bass,
// no kick), on the beat grid, while the part underneath steps its mids back.
//   lift — the line as it is
//   chop — the line's first beat stuttered, then the line ("ha-ha-hey")
//   echo — the line once, thrown into an echo that rings over the next bars
export type LayerStyle = "lift" | "chop" | "echo";
export type Layer = {
  song: number;
  phrase: number;
  bar: number; // 0–7: where in that phrase the line starts
  len: 1 | 2 | 4; // bars
  at: number; // bar inside the part where it lands
  times: number; // how many times in a row (1–4)
  style: LayerStyle;
};

export type ScriptVisit = {
  song: number; // index into the songs
  phrase: number; // the phrase it starts on
  bars: Bars;
  move: Move; // how it comes in
  fx: Fx;
  layers?: Layer[];
  note?: string; // the DJ's reason, shown to the listener
};

export type SetScript = {
  title: string;
  story: string;
  visits: ScriptVisit[];
  by: "brain" | "rules";
  bpm?: number; // the set's tempo, fixed by fixScript
};

// What the planner knows about each song.
export type SongBrief = {
  title: string;
  makers: string[];
  descriptors: string[];
  bpm: number;
  key: MusicalKey;
  duration: number;
  phrases: {
    start: number;
    label: PhraseLabel;
    energy: number;
    bass: number;
    vocal: number; // 0–9 within the song: how much voice/hook is in it
    lines: number[]; // bar offsets of its best 2-bar lines
  }[];
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

// How each energy setting plays. These differ on purpose, so Lounge, Club and
// Peak are three different sets, not one set at three volumes.
export const STYLE: Record<
  Energy,
  { push: number; bars: Bars; blendBars: number; tradeEvery: number; layerBias: LayerStyle[] }
> = {
  // A touch slower, long 32-bar parts, 8-bar blends, lines floating in echo.
  lounge: { push: 0.96, bars: 32, blendBars: 8, tradeEvery: 2, layerBias: ["echo", "lift"] },
  // The opener's tempo, 16-bar parts, call and response, lines lifted across.
  club: { push: 1, bars: 16, blendBars: 8, tradeEvery: 2, layerBias: ["lift", "echo", "chop"] },
  // Pushed faster, 8-bar parts traded bar by bar, chopped vocals, drops.
  peak: { push: 1.04, bars: 8, blendBars: 4, tradeEvery: 1, layerBias: ["chop", "lift"] },
};

const MAX_NUDGE = 0.12;
export const POST_BARS = 8; // audio kept after a part, for trades and fades

export function masterBpm(openerBpm: number, energy: Energy): number {
  return openerBpm * STYLE[energy].push;
}

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
  return !!ph && ph.start + (bars + POST_BARS) * srcBar <= s.duration - 0.05;
}

function lineFits(s: SongBrief, l: Pick<Layer, "phrase" | "bar" | "len">, srcBar: number): boolean {
  const ph = s.phrases[l.phrase];
  return !!ph && ph.start + (l.bar + l.len + 1) * srcBar <= s.duration - 0.05;
}

// Make any script safe to play: real songs and phrases, sections that fit,
// moves the tempos allow, lines that fit inside their parts, effects that
// don't fight each other, and at least the asked-for length (topped up from
// the rules planner if short).
export function fixScript(
  script: SetScript,
  songs: SongBrief[],
  energy: Energy,
  minutes: MixMinutes,
): SetScript {
  if (script.visits.length === 0 || !songs[script.visits[0]?.song]) {
    return rulesScript(songs, energy, minutes);
  }
  const master = masterBpm(songs[script.visits[0].song].bpm, energy);
  const mBar = barSeconds(master);
  const rates = songs.map((s) => chooseRate(master, s.bpm));
  const out: ScriptVisit[] = [];
  let total = 0;

  const fixLayers = (raw: Layer[] | undefined, v: ScriptVisit): Layer[] => {
    if (!raw || !rates[v.song].synced) return [];
    const room = v.fx.loopBuild ? v.bars - 4 : v.bars;
    const outL: Layer[] = [];
    for (const l of raw.slice(0, 4)) {
      const s = songs[l?.song];
      if (!s || !rates[l.song].synced) continue;
      const len = (l.len === 1 || l.len === 4 ? l.len : 2) as 1 | 2 | 4;
      const phrase = Math.max(0, Math.min(s.phrases.length - 1, Math.round(l.phrase)));
      const bar = Math.max(0, Math.min(8 - len, Math.round(l.bar)));
      let times = Math.max(1, Math.min(4, Math.round(l.times || 1)));
      const at = Math.max(0, Math.round(l.at));
      while (times > 1 && at + len * times > room) times--;
      if (at + len * times > room) continue;
      let style: LayerStyle = l.style === "chop" || l.style === "echo" ? l.style : "lift";
      if (energy === "lounge" && style === "chop") style = "echo";
      const layer = { song: l.song, phrase, bar, len, at, times, style };
      if (!lineFits(s, layer, mBar * rates[l.song].rate)) continue;
      // Two lines never land on the same bars.
      if (outL.some((o) => at < o.at + o.len * o.times && o.at < at + len * times)) continue;
      outL.push(layer);
    }
    return outL;
  };

  for (const raw of script.visits.slice(0, 64)) {
    const s = songs[raw.song];
    if (!s) continue;
    const srcBar = mBar * rates[raw.song].rate;
    let bars: Bars = raw.bars === 8 || raw.bars === 32 ? raw.bars : 16;
    let phrase = Math.max(0, Math.min(s.phrases.length - 1, Math.round(raw.phrase)));
    while (bars > 8 && !fits(s, phrase, bars, srcBar)) bars = (bars / 2) as Bars;
    while (phrase > 0 && !fits(s, phrase, bars, srcBar)) phrase--;
    if (!fits(s, phrase, bars, srcBar)) continue;

    const prev = out[out.length - 1];
    let move: Move = ["blend", "mashup", "trade", "cut"].includes(raw.move) ? raw.move : "blend";
    if (!prev) move = "open";
    if (prev && (!rates[raw.song].synced || !rates[prev.song].synced)) move = "cut";
    // A loop build ends on a hard drop, so whatever follows it cuts in.
    if (prev?.fx.loopBuild) move = "cut";
    // Mash-ups and trades layer two songs' voices: only between keys that sit
    // together on the Camelot wheel.
    if (prev && (move === "mashup" || move === "trade")) {
      const ka = shiftKey(songs[prev.song].key, rates[prev.song].rate);
      const kb = shiftKey(s.key, rates[raw.song].rate);
      if (camelotDistance(ka, kb) >= 3) move = "blend";
    }
    // A trade swaps the same song with itself to no effect.
    if (move === "trade" && prev?.song === raw.song) move = "blend";
    const fx: Fx = { ...NO_FX, ...raw.fx };
    if (!rates[raw.song].synced) {
      fx.kick = fx.hats = fx.claps = fx.pump = false;
      fx.loopBuild = false;
    }
    if (fx.breakdown) {
      fx.kick = fx.pump = false;
      if (move === "mashup" || move === "trade") move = "blend";
    }
    if (energy === "lounge") {
      fx.claps = fx.loopBuild = fx.kick = fx.hats = fx.pump = false;
      if (move === "cut" && prev && rates[raw.song].synced && rates[prev.song].synced) move = "blend";
      if (move === "trade") move = "mashup";
    }
    const v: ScriptVisit = { song: raw.song, phrase, bars, move, fx, note: raw.note?.slice(0, 160) };
    v.layers = fixLayers(raw.layers, v);
    out.push(v);
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
      let move: Move =
        !rates[v.song].synced || !rates[prev.song].synced || prev.fx.loopBuild ? "cut" : v.move === "open" ? "blend" : v.move;
      if (move === "trade" && prev.song === v.song) move = "blend";
      out.push({ ...v, move });
      total += v.bars * mBar;
    }
  }
  // The last part never builds into nothing.
  const last = out[out.length - 1];
  last.fx = { ...last.fx, loopBuild: false, riser: false, drop: false };
  return { ...script, visits: out, bpm: master };
}

// Order songs so each next one sits close on the Camelot wheel, starting from
// the opener the listener picked. Songs that can't lock tempo go last.
function harmonicOrder(songs: SongBrief[], opener: number, master: number): number[] {
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

// A song's best line: the phrase with the most voice in it, and its top line.
function bestLine(s: SongBrief, skip = -1): { phrase: number; bar: number } {
  let best = 0;
  s.phrases.forEach((p, i) => {
    if (i !== skip && (best === skip || p.vocal > s.phrases[best].vocal)) best = i;
  });
  return { phrase: best, bar: s.phrases[best]?.lines[0] ?? 0 };
}

// The built-in planner. Harmonic song order; songs take turns, moving forward
// through each; an energy arc of warm-up, build, a breakdown, a loop build into
// the big drop, peak, outro. And the LINKING:
//   - teasers: a line from the song that's coming next floats over the one
//     playing now, before it arrives;
//   - the thread: the set's strongest line (the hook) comes back again and
//     again over the other songs, so the whole set feels like one piece;
//   - call and response: songs trade bars before one takes over.
// Lounge, Club and Peak each get their own tempo, part length, moves and
// kind of line (see STYLE).
export function rulesScript(
  songs: SongBrief[],
  energy: Energy,
  minutes: MixMinutes,
  opener = 0,
): SetScript {
  const st = STYLE[energy];
  const master = masterBpm(songs[opener].bpm, energy);
  const order = harmonicOrder(songs, opener, master);
  const mBar = barSeconds(master);
  const rate = (i: number) => chooseRate(master, songs[i].bpm);
  const n = Math.max(songs.length * 2, Math.ceil((minutes * 60) / (st.bars * mBar)));
  const per = order.map((_, i) => Math.floor(n / order.length) + (i < n % order.length ? 1 : 0));

  // Each song's parts, in its own order: the strongest phrase in each stretch.
  const parts = order.map((si, oi) => {
    const s = songs[si];
    const srcBar = mBar * rate(si).rate;
    let bars = st.bars;
    let cands = s.phrases.map((p, i) => ({ i, p })).filter(({ i }) => fits(s, i, bars, srcBar));
    while (cands.length === 0 && bars > 8) {
      bars = (bars / 2) as Bars;
      cands = s.phrases.map((p, i) => ({ i, p })).filter(({ i }) => fits(s, i, bars, srcBar));
    }
    const count = per[oi];
    const picks: number[] = [];
    if (cands.length === 0) return { bars, picks: Array(count).fill(0) as number[] };
    if (oi === 0) picks.push(cands[0].i);
    const rest = oi === 0 ? cands.slice(1) : cands;
    const want = count - picks.length;
    for (let k = 0; k < want && rest.length; k++) {
      const lo = Math.floor((k * rest.length) / want);
      const hi = Math.max(lo + 1, Math.floor(((k + 1) * rest.length) / want));
      const slice = rest.slice(lo, hi);
      slice.sort((a, b) => b.p.energy + b.p.vocal / 2 - (a.p.energy + a.p.vocal / 2));
      picks.push(slice[0].i);
    }
    while (picks.length < count) picks.push(picks[picks.length % Math.max(1, picks.length)] ?? 0);
    return { bars: bars as Bars, picks };
  });

  // The thread: the strongest line of the whole set.
  const synced = order.filter((i) => rate(i).synced);
  let thread: { song: number; phrase: number; bar: number } | null = null;
  for (const si of synced) {
    const l = bestLine(songs[si]);
    if (!thread || songs[si].phrases[l.phrase].vocal > songs[thread.song].phrases[thread.phrase].vocal) {
      thread = { song: si, ...l };
    }
  }

  const used = order.map(() => 0);
  const visits: ScriptVisit[] = [];
  const peakAt = Math.max(2, Math.round(n * 0.62));
  let ord = 0;
  for (let v = 0; v < n; v++) {
    // Peak plays two parts of a song before the next; others alternate.
    if (v > 0 && (energy !== "peak" || v % 2 === 0)) ord = (ord + 1) % order.length;
    let oi = ord;
    for (let k = 0; k < order.length && used[oi] >= parts[oi].picks.length; k++) oi = (oi + 1) % order.length;
    const song = order[oi];
    const phrase = parts[oi].picks[used[oi]++];
    const bars = parts[oi].bars;
    const f = n > 1 ? v / (n - 1) : 0;
    const stage = f < 0.14 ? "warm" : f < 0.34 ? "build" : f < 0.86 ? "peak" : "outro";
    const fx: Fx = { ...NO_FX };
    const notes: string[] = [];
    const drums = energy !== "lounge";
    if (stage === "build") {
      fx.kick = drums;
      fx.hats = drums;
      fx.pump = drums;
    } else if (stage === "peak") {
      fx.kick = drums;
      fx.hats = drums;
      fx.claps = energy === "peak";
      fx.pump = drums;
    }
    if (v === peakAt - 2 && energy !== "lounge") {
      fx.breakdown = true;
      fx.kick = fx.pump = fx.claps = false;
      notes.push("Breakdown: the bass steps out and the melody breathes.");
    }
    if (v === peakAt - 1 && energy !== "lounge") {
      fx.loopBuild = true;
      fx.riser = true;
      fx.drop = true;
      notes.push("Loop build into the drop.");
    }
    if (v === peakAt) notes.push("The drop: everything back in.");
    if (stage === "peak" && energy === "peak" && v % 4 === 3 && v !== peakAt - 1) {
      fx.loopBuild = true;
      fx.riser = true;
      fx.drop = true;
    }
    if (stage === "build" && v === Math.round(n * 0.3)) fx.filterRise = true;

    // How it comes in.
    let move: Move = "blend";
    const prev = visits[v - 1];
    if (v === 0) move = "open";
    else if (prev?.fx.loopBuild) move = "cut";
    else if (prev?.song === song) move = "blend";
    else if (energy === "lounge") move = v % 3 === 2 ? "mashup" : "blend";
    else if (energy === "club") move = stage === "warm" ? "blend" : (["trade", "mashup", "blend"] as const)[v % 3];
    else move = stage === "warm" ? "blend" : (["trade", "blend", "trade", "mashup"] as const)[v % 4];
    if (fx.breakdown && (move === "trade" || move === "mashup")) move = "blend";
    if (move === "trade") notes.push("Call and response: the two songs trade bars.");

    // The lines dropped on top.
    const layers: Layer[] = [];
    const room = fx.loopBuild ? bars - 4 : bars;
    if (rate(song).synced && stage !== "outro" && !fx.breakdown) {
      const style = st.layerBias[v % st.layerBias.length];
      // Teaser: a line from the next song in the order, before it arrives.
      const nextSong = order[(oi + 1) % order.length];
      if (nextSong !== song && rate(nextSong).synced && v < n - 1) {
        // The line comes from the very part of that song that plays next.
        const ni = order.indexOf(nextSong);
        const upcoming = parts[ni].picks[used[ni]] ?? bestLine(songs[nextSong]).phrase;
        const ph = songs[nextSong].phrases[upcoming];
        const l = { phrase: upcoming, bar: ph?.lines[v % Math.max(1, ph.lines.length)] ?? 0 };
        const len = energy === "lounge" ? 4 : 2;
        const times = energy === "peak" ? 2 : energy === "lounge" ? 1 : 2;
        const at = Math.max(0, room - len * times - (energy === "peak" ? 0 : 2));
        if (at >= 2 || energy === "peak") {
          layers.push({ song: nextSong, phrase: l.phrase, bar: l.bar, len, at, times, style });
          notes.push(`A line from "${songs[nextSong].title}" before it arrives.`);
        }
      }
      // The thread: the set's hook comes back over other songs.
      if (thread && thread.song !== song && v % 3 === 1 && room >= 8) {
        const len = energy === "peak" ? 1 : 2;
        const times = energy === "peak" ? 4 : 2;
        const at = energy === "lounge" ? 4 : 2;
        if (at + len * times <= (layers[0]?.at ?? room)) {
          layers.unshift({
            song: thread.song,
            phrase: thread.phrase,
            bar: thread.bar,
            len,
            at,
            times,
            style: energy === "peak" ? "chop" : energy === "lounge" ? "echo" : "lift",
          });
          notes.push(`The hook of "${songs[thread.song].title}" comes back on top.`);
        }
      }
    }
    visits.push({ song, phrase, bars, move, fx, layers, note: notes.join(" ") || undefined });
  }
  const story = {
    lounge: "Slow, warm and long: songs melt into each other over eight-bar blends while lines from one float over another in echo.",
    club: "Songs trade bars in call and response, lines from the next song arrive before it does, and the strongest hook keeps coming back.",
    peak: "Pushed faster and harder: short parts traded bar by bar, chopped vocal hooks, loop builds and drops.",
  }[energy];
  return {
    title: order.map((i) => songs[i].title).join(" × "),
    story,
    visits,
    by: "rules",
  };
}
