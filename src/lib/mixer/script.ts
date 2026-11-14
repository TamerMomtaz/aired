// The SET SCRIPT: the plan a DJ makes before touching the decks. Which song
// plays when, which part of it, for how long, how it comes in, what lines from
// the other songs get dropped on top of it, and what the DJ adds. The DJ brain
// (Claude, on the server) writes one; when the brain is off or unreachable,
// `rulesScript` writes one from the same analysis. Either way `fixScript` makes
// it safe before the engine plays it.
//
// Everything here is plain data. No audio, no secrets: the brain only ever sees
// numbers about the songs plus their public titles, makers and descriptors.

import { camelotDistance, keysClash, type MusicalKey } from "./key";
import type { Mood } from "./moods";
import type { PhraseLabel } from "./structure";

export type Energy = "lounge" | "club" | "peak";
export type MixMinutes = 5 | 7 | 10;
// open   — the first part
// blend  — slow bass swap
// mashup — for 4 bars the old part keeps its beat and bass under the new top
// trade  — call and response: the two songs swap every 2 bars (1 at Peak)
//          for 8 bars before the new one takes over
// cut    — echo out, slam in
// flow   — the same song playing straight on from where its last part ended
//          (set by fixScript, never by the planners: a song's back-to-back
//          parts are one stretch of it, not a jump or a mix into itself)
export type Move = "open" | "blend" | "mashup" | "trade" | "cut" | "flow";
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
  skip?: number; // source bars into that phrase where it starts (for "flow")
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
  // How many times the listener added this song (1–3): it gets that share of
  // the set and keeps coming back between the others.
  plays?: number;
  // Split into vocals / drums / bass / music by the worker: the engine can
  // swap basslines, lay voices over other songs' beats, strip to an acapella.
  stems?: boolean;
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

// The furthest a song is sped up or slowed down to lock. Key lock keeps the
// pitch. This was 8% (a DJ deck's narrow range), but then two songs at 100 and
// 122 BPM could never lock and Tee's two-song mix was nothing but hard cuts.
// With the set meeting songs halfway, 12% each way locks songs up to about a
// quarter apart (100 and 122 meet at 110), which is a wide deck's range.
export const MAX_NUDGE = 0.12;
export const POST_BARS = 8; // audio kept after a part, for trades and fades

// The set's tempo: the opener's (pushed for Peak, eased for Lounge), unless
// that leaves a song too far away to lock, or stretched more than 4%. Then the
// set moves toward the others, the way a DJ meets a slower record halfway: a
// 107 and a 122 BPM song both lock at about 114 instead of the 107 one being
// cut in cold.
//
// A mood with a tempo window (Deep House 118–125, Dabka Techno 124–130) pulls
// that starting point into its window; the search below then settles as close
// to it as the songs allow without losing their lock.
export function masterBpm(
  songs: { bpm: number }[],
  opener: number,
  energy: Energy,
  window?: [number, number],
): number {
  let base = songs[opener].bpm * STYLE[energy].push;
  if (window) {
    // Half or double time counts as in the window (a 62 BPM ballad plays as 124).
    const fit = [base, base * 2, base / 2].find((b) => b >= window[0] && b <= window[1]);
    base = fit ?? Math.max(window[0], Math.min(window[1], base));
  }
  let best = base;
  let bestCost = Infinity;
  for (let k = -60; k <= 60; k++) {
    const f = 1 + k * 0.0025;
    const m = base * f;
    let locked = 0;
    let worst = 0;
    for (const s of songs) {
      const r = chooseRate(m, s.bpm);
      if (!r.synced) continue;
      locked++;
      worst = Math.max(worst, Math.abs(r.rate - 1));
    }
    const cost = -locked * 1000 + Math.max(0, worst - 0.04) * 100 + Math.abs(f - 1) * 10;
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = m;
    }
  }
  return best;
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
  mood?: Mood,
): SetScript {
  if (script.visits.length === 0 || !songs[script.visits[0]?.song]) {
    return rulesScript(songs, energy, minutes, 0, mood);
  }
  const master = masterBpm(songs, script.visits[0].song, energy, mood?.bpm);
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
    const prev = out[out.length - 1];
    // The drop has to land on something. After a loop build or a drop the
    // next part is the song at full strength: a quiet phrase there (an intro, a
    // pause, a stripped verse) makes the whole build fall into a hole, which is
    // what Tee heard at 1:07 in a mix of 0063 and 0118.
    const landing = !!prev && (prev.fx.loopBuild || prev.fx.drop);
    if (landing) phrase = strongPhrase(s, phrase, bars, srcBar);
    while (bars > 8 && !fits(s, phrase, bars, srcBar)) bars = (bars / 2) as Bars;
    while (phrase > 0 && !fits(s, phrase, bars, srcBar)) phrase--;
    if (!fits(s, phrase, bars, srcBar)) continue;

    let move: Move = ["blend", "mashup", "trade", "cut"].includes(raw.move) ? raw.move : "blend";
    if (!prev) move = "open";
    if (prev && (!rates[raw.song].synced || !rates[prev.song].synced)) move = "cut";
    // A loop build ends on a hard drop, so whatever follows it cuts in.
    if (prev?.fx.loopBuild) move = "cut";
    // Mash-ups and trades layer two songs' voices: only between keys that sit
    // together on the Camelot wheel.
    // Keys 3+ steps apart on the wheel sound sour on top of each other, so
    // those songs never overlap: the old one echoes out and the new one lands
    // clean, the way a DJ gets between songs that don't share a key.
    const clash = !!prev && prev.song !== raw.song && keysClash(songs[prev.song].key, s.key);
    // On stems two clashing songs can still pass the beat: a short blend
    // where only the incoming drums and music ride in, the bass changes on the
    // one and the voice after (see the engine). Without stems they never
    // overlap.
    const bridge = clash && !!prev && !!songs[prev.song].stems && !!s.stems;
    if (clash && move !== "cut") move = bridge ? "blend" : "cut";
    // A trade of a part with itself does nothing.
    if (move === "trade" && prev?.song === raw.song && prev.phrase === phrase) move = "blend";
    const fx: Fx = { ...NO_FX, ...raw.fx };
    if (!rates[raw.song].synced) {
      fx.kick = fx.hats = fx.claps = fx.pump = false;
      fx.loopBuild = false;
    }
    // ...and never a breakdown: the bass comes back on the drop, not after it.
    if (landing) fx.breakdown = false;
    if (fx.breakdown) {
      fx.kick = fx.pump = false;
      if (move === "mashup" || move === "trade") move = "blend";
    }
    if (energy === "lounge") {
      fx.claps = fx.loopBuild = fx.kick = fx.hats = fx.pump = false;
      if (move === "cut" && prev && rates[raw.song].synced && rates[prev.song].synced && (!clash || bridge)) move = "blend";
      if (move === "trade") move = "mashup";
    }
    const v: ScriptVisit = { song: raw.song, phrase, bars, move, fx, note: raw.note?.slice(0, 160) };
    v.layers = fixLayers(raw.layers, v);
    out.push(v);
    total += bars * mBar;
  }
  if (out.length === 0) return rulesScript(songs, energy, minutes, 0, mood);

  // Top up a short script with more parts in the same spirit.
  if (total < minutes * 60) {
    const extra = rulesScript(songs, energy, minutes, out[0].song, mood).visits;
    const used = new Set(out.map((v) => `${v.song}:${v.phrase}`));
    for (const v of extra) {
      if (total >= minutes * 60) break;
      if (used.has(`${v.song}:${v.phrase}`) && extra.length > out.length) continue;
      const prev = out[out.length - 1];
      const clash = prev.song !== v.song && keysClash(songs[prev.song].key, songs[v.song].key);
      const bridge = clash && !!songs[prev.song].stems && !!songs[v.song].stems;
      let move: Move =
        !rates[v.song].synced || !rates[prev.song].synced || prev.fx.loopBuild || (clash && !bridge)
          ? "cut"
          : clash || v.move === "open"
            ? "blend"
            : v.move;
      if (move === "trade" && prev.song === v.song && prev.phrase === v.phrase) move = "blend";
      out.push({ ...v, move });
      total += v.bars * mBar;
    }
  }
  // A song's back-to-back parts play straight through. Jumping to another
  // spot in the same song on a cut, or blending a song into a copy of itself
  // that overlaps what just played, was most of the bumps Tee marked in a
  // three-song Peak set (0063 x 0119 x 0035). A remix (one song) is exempt:
  // there, rearranging the song's own parts is the point.
  if (songs.length > 1) {
    for (let i = 1; i < out.length; i++) {
      const prev = out[i - 1];
      const v = out[i];
      // After a loop build or a drop too: the build releases back into the
      // same song, like a DJ's loop roll.
      if (v.song !== prev.song) continue;
      const s = songs[v.song];
      const srcBar = mBar * rates[v.song].rate;
      const skip = (prev.skip ?? 0) + prev.bars;
      let bars = v.bars;
      while (bars > 8 && !fits(s, prev.phrase, skip + bars, srcBar)) bars = (bars / 2) as Bars;
      if (fits(s, prev.phrase, skip + bars, srcBar)) {
        out[i] = { ...v, phrase: prev.phrase, skip, bars, move: "flow" };
        out[i].layers = fixLayers(v.layers, out[i]);
      } else {
        // The song has run out: start it again elsewhere, cleanly.
        out[i] = { ...v, move: "cut" };
      }
    }
  }

  // The last part never builds into nothing.
  const last = out[out.length - 1];
  last.fx = { ...last.fx, loopBuild: false, riser: false, drop: false };
  return { ...script, visits: out, bpm: master };
}

// The phrase a drop lands on: the one asked for if it's among the song's
// strongest (energy and bass both at least 6 of 9), else the strongest that
// fits, nearest to it.
function strongPhrase(s: SongBrief, asked: number, bars: Bars, srcBar: number): number {
  const strong = (i: number) => s.phrases[i].energy >= 6 && s.phrases[i].bass >= 6;
  if (strong(asked)) return asked;
  let best = asked;
  let bestScore = -Infinity;
  s.phrases.forEach((p, i) => {
    if (!fits(s, i, Math.min(bars, 8) as Bars, srcBar)) return;
    const score = p.energy + p.bass - Math.abs(i - asked) * 0.25;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

// How well an order of songs flows, lower is better: the steps around the
// Camelot wheel from each song to the next (and from the last back to the
// first, since the set keeps cycling through them), after each song's tempo
// change has moved its key, plus a large cost for a song that can't lock.
function orderCost(songs: SongBrief[], order: number[], master: number): number {
  // Key lock: a song keeps its own key at any tempo.
  const keyOf = (i: number) => songs[i].key;
  let cost = 0;
  for (let k = 0; k < order.length; k++) {
    const a = order[k];
    if (!chooseRate(master, songs[a].bpm).synced) cost += 10;
    if (order.length > 1) cost += camelotDistance(keyOf(a), keyOf(order[(k + 1) % order.length])) * (k === order.length - 1 ? 0.5 : 1);
  }
  return cost;
}

function permutations(items: number[]): number[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((p) => [x, ...p]));
}

// The order that flows best from the given opener: every order is tried (at
// most 5! = 120 for six songs).
function harmonicOrder(songs: SongBrief[], opener: number, master: number): number[] {
  const rest = songs.map((_, i) => i).filter((i) => i !== opener);
  let best = [opener, ...rest];
  let bestCost = orderCost(songs, best, master);
  for (const p of permutations(rest)) {
    const o = [opener, ...p];
    const c = orderCost(songs, o, master);
    if (c < bestCost - 1e-9) {
      best = o;
      bestCost = c;
    }
  }
  return best;
}

// The song that makes the smoothest set as the opener (it sets the tempo):
// the best key flow from it, plus how far the others must be sped up or
// slowed down to lock (6% of stretch weighs about as much as a two-step key
// jump), since big stretches are heard as a pitch change.
export function bestOpener(songs: SongBrief[], energy: Energy, window?: [number, number]): number {
  let best = 0;
  let bestCost = Infinity;
  songs.forEach((_, i) => {
    const master = masterBpm(songs, i, energy, window);
    const order = harmonicOrder(songs, i, master);
    let cost = orderCost(songs, order, master);
    for (const t of songs) {
      const r = chooseRate(master, t.bpm);
      if (r.synced) cost += (Math.abs(r.rate - 1) * 100) / 3;
    }
    if (cost < bestCost - 1e-9) {
      best = i;
      bestCost = cost;
    }
  });
  return best;
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
  mood?: Mood,
): SetScript {
  const st = { ...STYLE[energy], layerBias: mood?.layerBias ?? STYLE[energy].layerBias };
  const master = masterBpm(songs, opener, energy, mood?.bpm);
  const order = harmonicOrder(songs, opener, master);
  const mBar = barSeconds(master);
  const rate = (i: number) => chooseRate(master, songs[i].bpm);
  const single = songs.length === 1;
  const weight = order.map((i) => Math.max(1, Math.min(3, Math.round(songs[i].plays ?? 1))));
  const W = weight.reduce((a, b) => a + b, 0);
  const n = Math.max(single ? 4 : W * 2, Math.ceil((minutes * 60) / (st.bars * mBar)));
  // Each song's share of the parts, by how many times it was added.
  const per = weight.map((w) => Math.floor((n * w) / W));
  for (let k = 0; per.reduce((a, b) => a + b, 0) < n; k++) {
    const frac = weight.map((w, i) => (n * w) / W - per[i]);
    per[frac.indexOf(Math.max(...frac))]++;
    if (k > 12) break;
  }
  // Who plays when: the opener first; then the song most owed its share,
  // never the same song twice in a row while another can go (Peak plays two
  // parts of a song back to back). A song added three times keeps coming back
  // between the others.
  const seq: number[] = [];
  {
    const left = [...per];
    const credit = weight.map(() => 0);
    for (let v = 0; v < n; v++) {
      const prev = seq[v - 1];
      let pick: number;
      // A song too far from the set's tempo to lock can only come and go on
      // cuts, so it plays in long runs (its share in two halves), not in and
      // out every part.
      let run = 0;
      for (let k = v - 1; k >= 0 && seq[k] === prev; k--) run++;
      if (v === 0) pick = 0;
      else if (!rate(order[prev]).synced && left[prev] > 0 && run < Math.ceil(per[prev] / 2)) pick = prev;
      else if (energy === "peak" && v % 2 === 1 && left[prev] > 0) pick = prev;
      else {
        const open = order.map((_, i) => i).filter((i) => left[i] > 0);
        if (open.length === 0) break;
        for (const i of open) credit[i] += weight[i];
        const pool = open.length > 1 ? open.filter((i) => i !== prev) : open;
        pick = pool.reduce((a, b) => (credit[b] > credit[a] ? b : a));
        credit[pick] -= W;
      }
      left[pick]--;
      seq.push(pick);
    }
  }

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
    const strength = (c: { p: SongBrief["phrases"][number] }) => c.p.energy + c.p.vocal / 2;
    if (want <= rest.length) {
      for (let k = 0; k < want; k++) {
        const lo = Math.floor((k * rest.length) / want);
        const hi = Math.max(lo + 1, Math.floor(((k + 1) * rest.length) / want));
        const slice = rest.slice(lo, hi);
        slice.sort((a, b) => strength(b) - strength(a));
        picks.push(slice[0].i);
      }
    } else if (rest.length) {
      // More parts than the song has (a remix, or a song added several
      // times): one pass through all of it, then passes through its strongest
      // half, each in song order, so the same part never plays twice in a row.
      const strong = [...rest].sort((a, b) => strength(b) - strength(a)).slice(0, Math.max(2, Math.ceil(rest.length / 2)));
      strong.sort((a, b) => a.i - b.i);
      const queue = [...rest.map((c) => c.i)];
      while (queue.length < want) queue.push(...strong.map((c) => c.i));
      for (let k = 0; k < want; k++) {
        if (picks.length && picks[picks.length - 1] === queue[k] && k + 1 < queue.length) {
          [queue[k], queue[k + 1]] = [queue[k + 1], queue[k]];
        }
        picks.push(queue[k]);
      }
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
  for (let v = 0; v < seq.length; v++) {
    const oi = seq[v];
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
    else if (prev?.song === song && !single) move = "blend";
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
      // (In a one-song remix, a line from its own next part.)
      const nextSong = v + 1 < seq.length ? order[seq[v + 1]] : song;
      const nextPart = parts[seq[v + 1] ?? oi]?.picks[used[seq[v + 1] ?? oi]];
      if (
        v + 1 < seq.length &&
        (nextSong !== song || (single && nextPart !== undefined && nextPart !== phrase)) &&
        rate(nextSong).synced
      ) {
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
      // A mood whose signature is the returning hook (eurodance, a wedding
      // chant, soulful house) brings it back every other part, not every third.
      const every = mood?.signature === "hookReturn" ? 2 : 3;
      if (thread && (thread.song !== song || (single && thread.phrase !== phrase)) && v % every === 1 && room >= 8) {
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
  const moodLine = mood && mood.family !== "classic" ? ` ${mood.label}: ${mood.note}` : "";
  return {
    title: single ? songs[0].title : order.map((i) => songs[i].title).join(" × "),
    story: (single
      ? {
          lounge: `A Lounge remix of "${songs[0].title}": slower and warm, its parts rearranged into long, melting stretches, its own lines floating back in echo.`,
          club: `A Club remix of "${songs[0].title}": its parts rearranged and traded in call and response, its hook coming back over the other parts, built for the floor.`,
          peak: `A Peak remix of "${songs[0].title}": pushed faster and harder, its parts chopped short, its hook stuttered into loop builds and drops.`,
        }[energy]
      : story) + moodLine,
    visits,
    by: "rules",
  };
}
