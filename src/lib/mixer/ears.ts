// The Mixer's ears. Before anyone hears a mix, the Mixer listens to it the way
// Tee does, and repairs what a DJ would never let through:
//   cut    — the outgoing singer is cut off in the middle of a line
//   entry  — the incoming singer comes in halfway through a line
//   host   — a lifted line drops in (or out) while the singer under it is
//            mid-line, so the host's voice is chopped
//   empty  — a lifted line with no voice in it (on stems it would play silence)
//   hole   — the energy falls into a hole the plan didn't ask for
// The repairs are a DJ's: the voices hand over on a breath (the old singer
// finishes the line, the new one starts theirs) while the beat stays on the
// grid; a song that would come in mid-line comes in a phrase earlier or later;
// a line slides to where the host breathes; a hole is blended over or filled.
// Then it listens again. This is the check-and-repair loop from DJustify (Hsu
// et al., arXiv 2610.33434), built on the stems the worker already makes: the
// vocal stem says exactly where every voice is.

import {
  planTimes,
  prepareSongs,
  prepareStems,
  renderSet,
  type MixPlan,
  type PlannedVisit,
  type PreparedSong,
  type SongAnalysis,
} from "./engine";
import { decodeStemRange } from "./load";
import type { Mood } from "./moods";
import { barSeconds, fits, strongPhrase, type Energy, type SetScript, type SongBrief } from "./script";

export type IssueKind = "cut" | "entry" | "host" | "empty" | "hole";
export type Issue = { kind: IssueKind; visit: number; layer?: number; at: number; to?: number };

export type EarsReport = {
  switches: number; // song changes listened to
  lines: number; // lifted lines listened to
  found: number; // problems heard on the first listen
  fixed: number; // problems gone on the last listen
  left: number; // problems still there (no repair fit)
  heard: Issue[]; // the first listen, for the record
  still: Issue[]; // the last listen
};

// ---- hearing a voice ------------------------------------------------------

const FRAME = 0.04; // seconds per loudness frame
const FLOOR = 10 ** (-40 / 20); // quieter than this is never a voice (stem bleed)
const DIP = 10 ** (-10 / 20); // a breath: 10 dB under the singer's level
const BREATH = 3; // frames (0.12 s): the shortest gap that counts as a breath
const AROUND = 2; // frames (0.08 s) of voice on each side that make "mid-line"

// A stretch of a song's vocal stem, frame by frame: which frames have a voice
// (gaps shorter than a breath filled in), in source seconds from t0.
type Voice = { t0: number; on: Uint8Array };

class Ears {
  private cache = new Map<string, Promise<Voice | null>>();
  constructor(
    private songs: SongAnalysis[],
    private signal?: AbortSignal,
  ) {}

  // The voice over source seconds [a, b), read from the vocal stem.
  voice(song: number, a: number, b: number): Promise<Voice | null> {
    const src = this.songs[song].stems;
    if (!src) return Promise.resolve(null);
    a = Math.max(0, Math.floor(a / FRAME) * FRAME);
    b = Math.min(this.songs[song].duration, Math.ceil(b / FRAME) * FRAME);
    if (b - a < 4 * FRAME) return Promise.resolve(null);
    const key = `${song}:${a.toFixed(2)}:${b.toFixed(2)}`;
    let p = this.cache.get(key);
    if (!p) {
      p = decodeStemRange(src, "vocals", a, b - a, this.signal)
        .then((dec) => (dec ? frames(dec.buffer, dec.lead, a, b) : null))
        .catch((err) => {
          if ((err as Error)?.name === "AbortError") throw err;
          return null;
        });
      this.cache.set(key, p);
    }
    return p;
  }
}

function frames(buf: AudioBuffer, lead: number, a: number, b: number): Voice {
  const sr = buf.sampleRate;
  const n = Math.floor((b - a) / FRAME);
  const L = buf.getChannelData(0);
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const len = Math.round(FRAME * sr);
  const rms = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const i0 = Math.round((lead + f * FRAME) * sr);
    let sum = 0;
    let c = 0;
    for (let i = i0; i < i0 + len && i < L.length; i++) {
      const m = (L[i] + R[i]) / 2;
      sum += m * m;
      c++;
    }
    rms[f] = c ? Math.sqrt(sum / c) : 0;
  }
  // The singer's level here: the loud end of the stretch. A breath is a dip
  // well under it; echo and bleed in the gaps sit there too.
  const sorted = [...rms].sort((x, y) => x - y);
  const level = sorted[Math.floor(sorted.length * 0.8)] ?? 0;
  const thr = Math.max(FLOOR, level * DIP);
  const on = new Uint8Array(n);
  for (let f = 0; f < n; f++) on[f] = rms[f] >= thr ? 1 : 0;
  // Fill dips shorter than a breath (between syllables, a consonant).
  for (let f = 0; f < n; ) {
    if (on[f]) {
      f++;
      continue;
    }
    let g = f;
    while (g < n && !on[g]) g++;
    if (f > 0 && g < n && g - f < BREATH) on.fill(1, f, g);
    f = g;
  }
  return { t0: a, on };
}

const frameAt = (v: Voice, t: number) => Math.floor((t - v.t0) / FRAME);

// Is the singer in the middle of a line at source second t?
function midLine(v: Voice, t: number): boolean {
  const f = frameAt(v, t);
  if (f - AROUND < 0 || f + AROUND >= v.on.length) return false;
  for (let k = f - AROUND; k <= f + AROUND; k++) if (!v.on[k]) return false;
  return true;
}

// Where lines end (a breath starts) and begin (a breath ends), source seconds.
function breaths(v: Voice): { ends: number[]; starts: number[] } {
  const ends: number[] = [];
  const starts: number[] = [];
  for (let f = 1; f < v.on.length; f++) {
    if (v.on[f - 1] && !v.on[f]) ends.push(v.t0 + f * FRAME);
    if (!v.on[f - 1] && v.on[f]) starts.push(v.t0 + f * FRAME);
  }
  return { ends, starts };
}

function share(v: Voice, a: number, b: number): number {
  const f0 = Math.max(0, frameAt(v, a));
  const f1 = Math.min(v.on.length, frameAt(v, b));
  if (f1 <= f0) return 0;
  let s = 0;
  for (let f = f0; f < f1; f++) s += v.on[f];
  return s / (f1 - f0);
}

// ---- listening to a plan and handing the voices over ----------------------

type Ctx = {
  songs: SongAnalysis[];
  briefs: SongBrief[];
  ears: Ears;
  energy: Energy;
  // Hand-overs that made a hole when rendered (the voice held back where the
  // song has little music under it): left plain from then on.
  veto: Set<string>;
};

// Where a hand-over leaves no voice, by the hand-over's key.
type Gap = { key: string; from: number; to: number };

const span = (l: { len: number; times: number }) => l.len * l.times;
const nearest = (xs: number[], to: number) => [...xs].sort((a, b) => Math.abs(a - to) - Math.abs(b - to));

// A song's voice in output seconds around a part: read and map back and forth.
async function voiceOf(c: Ctx, plan: MixPlan, v: PlannedVisit, from: number, to: number) {
  const rate = plan.songs[v.song].rate;
  const src = (t: number) => v.sourceStart + (t - v.at) * rate;
  const out = (s: number) => v.at + (s - v.sourceStart) / rate;
  const voice = await c.ears.voice(v.song, src(from) - 0.3, src(to) + 0.3);
  if (!voice) return null;
  const b = breaths(voice);
  return {
    mid: (t: number) => midLine(voice, src(t)),
    ends: b.ends.map(out).filter((t) => t >= from && t <= to),
    starts: b.starts.map(out).filter((t) => t >= from && t <= to),
  };
}

// Listen to every switch and lifted line, and set the voices to hand over on
// a breath wherever the plain cue would chop one. Changes `plan` in place.
type Heard = { issues: Issue[]; handed: number; switches: number; lines: number; gaps: Gap[] };

async function listenAndHand(plan: MixPlan, c: Ctx): Promise<Heard> {
  const bar = barSeconds(plan.bpm);
  const beat = bar / 4;
  const blendBars = { lounge: 8, club: 4, peak: 2 }[c.energy];
  const issues: Issue[] = [];
  const gaps: Gap[] = [];
  let handed = 0; // chopped voices moved onto a breath
  let switches = 0;
  let lines = 0;
  for (let i = 0; i < plan.visits.length; i++) {
    const v = plan.visits[i];
    const prev = plan.visits[i - 1];
    delete v.voiceIn;
    if (prev && v.move !== "flow") {
      switches++;
      delete prev.voiceOut;
      const T = v.at;
      // Trades swap whole songs bar by bar; there's no single hand-over.
      if (v.move === "trade") continue;
      const stemsBoth = !!c.songs[prev.song].stems && !!c.songs[v.song].stems;
      // Where the old voice stops and the new one starts on a plain cue.
      const plainOut = v.move === "blend" ? T - beat / 2 : T;
      let outAt = plainOut;
      // A loop build is its own way out (the stutter), so only a plain exit
      // is listened to.
      const vo = prev.fx.loopBuild ? null : await voiceOf(c, plan, prev, T - 2 * bar, T + beat);
      if (vo?.mid(plainOut)) {
        // Stop the old singer on the nearest breath (up to 2 bars early, or
        // half a beat late while its music is still playing).
        const late = v.move === "cut" ? 0 : beat / 2;
        const at = nearest(
          vo.ends.filter((t) => t <= T + late),
          plainOut,
        )[0];
        if (at !== undefined && stemsBoth && !c.veto.has(`out:${i}`)) {
          prev.voiceOut = at - T;
          outAt = at;
          handed++;
        } else issues.push({ kind: "cut", visit: i, at: T });
      }
      if (prev.song === v.song) continue; // a remix: the same singer
      const lo = v.move === "blend" ? T - Math.min(blendBars * bar, bar) + 0.1 : T;
      const vi = await voiceOf(c, plan, v, Math.max(v.at - 2 * bar, lo - 0.5), T + 2 * bar);
      if (vi?.mid(T)) {
        // Bring the new singer in where a line starts: a pickup just before
        // the one, or the next line within 2 bars (the beat carries it).
        const at = nearest(
          vi.starts.filter((t) => t >= lo && t >= outAt - 0.05),
          T,
        )[0];
        if (at !== undefined && stemsBoth && !c.veto.has(`in:${i}`)) {
          v.voiceIn = at - T;
          handed++;
        } else issues.push({ kind: "entry", visit: i, at: T });
      } else if (vi && outAt > T) {
        // The old singer finishes after the one: hold the new one until then.
        const at = vi.starts.find((t) => t >= outAt - 0.05);
        if (at !== undefined) v.voiceIn = at - T;
        else {
          delete prev.voiceOut;
          outAt = plainOut;
          handed--;
          issues.push({ kind: "cut", visit: i, at: T });
        }
      }
      if (v.voiceIn !== undefined && v.voiceIn > 0) gaps.push({ key: `in:${i}`, from: T, to: T + v.voiceIn });
      if (prev.voiceOut !== undefined)
        gaps.push({ key: `out:${i}`, from: Math.min(outAt, plainOut), to: Math.max(T, T + (v.voiceIn ?? 0)) });
    }
    for (let k = 0; k < v.layers.length; k++) {
      const l = v.layers[k];
      lines++;
      delete l.duck;
      const ph = c.briefs[l.song].phrases[l.phrase];
      const lBar = bar * plan.songs[l.song].rate;
      if (ph && c.songs[l.song].stems) {
        const lv = await c.ears.voice(l.song, ph.start + l.bar * lBar - 0.3, ph.start + (l.bar + l.len) * lBar + 0.3);
        if (lv && share(lv, ph.start + l.bar * lBar, ph.start + (l.bar + l.len) * lBar) < 0.3) {
          issues.push({ kind: "empty", visit: i, layer: k, at: v.at + l.at * bar });
          continue;
        }
      }
      if (!c.songs[v.song].stems) continue;
      const w0 = v.at + l.at * bar;
      const w1 = w0 + span(l) * bar;
      const Tend = v.at + v.dur;
      const hv = await voiceOf(c, plan, v, Math.max(v.at, w0 - bar), Math.min(Tend, w1 + bar));
      if (!hv) continue;
      let d0 = 0;
      let d1 = 0;
      let ok = true;
      if (hv.mid(w0)) {
        // The host steps aside on its last breath before the line lands.
        const at = hv.ends.filter((t) => t <= w0).pop();
        if (at !== undefined) d0 = at - w0;
        else ok = false;
      }
      if (w1 < Tend - 0.1 && hv.mid(w1)) {
        // And comes back where its next line starts.
        const at = hv.starts.find((t) => t >= w1);
        if (at !== undefined) d1 = at - w1;
        else ok = false;
      }
      const key = `duck:${i}:${k}`;
      if ((d0 || d1) && c.veto.has(key)) ok = false;
      else if (d0 || d1) {
        l.duck = [d0, d1];
        handed++;
        if (d0) gaps.push({ key, from: w0 + d0, to: w0 });
        if (d1) gaps.push({ key, from: w1, to: w1 + d1 });
      }
      if (!ok) issues.push({ kind: "host", visit: i, layer: k, at: w0 });
    }
  }
  return { issues, handed, switches, lines, gaps };
}

// ---- repairs that change the plan ------------------------------------------

// What a breath can't fix: a song that comes in mid-line with no line start
// near the one comes in a phrase earlier or later; a lifted line with no voice
// is swapped for one with a voice (or dropped); a line whose host never
// breathes slides to where it does (or is dropped).
async function repair(script: SetScript, plan: MixPlan, issues: Issue[], c: Ctx): Promise<SetScript | null> {
  // The plan skips visits whose audio couldn't be cut; then indexes don't
  // line up with the script and it's safer to leave it alone.
  if (plan.visits.length !== script.visits.length) return null;
  const bar = barSeconds(plan.bpm);
  const rate = (song: number) => plan.songs[song].rate;
  const visits = script.visits.map((v) => ({ ...v, layers: v.layers ? [...v.layers] : undefined }));
  const moved = new Set<number>();
  let changed = false;

  for (const is of issues) {
    if (is.kind !== "entry") continue;
    const i = is.visit;
    const v = visits[i];
    const brief = c.briefs[v.song];
    const srcBar = bar * rate(v.song);
    // A song that plays on for several parts moves as a whole.
    let j = i;
    while (visits[j + 1]?.move === "flow" && visits[j + 1].song === v.song) j++;
    for (const d of [1, -1, 2, -2]) {
      const np = v.phrase + d;
      const ph = brief.phrases[np];
      if (!ph) continue;
      let ok = true;
      for (let k = i; k <= j && ok; k++) ok = fits(brief, np, (visits[k].skip ?? 0) + visits[k].bars, srcBar);
      if (!ok) continue;
      const at = ph.start + (v.skip ?? 0) * srcBar;
      const voice = await c.ears.voice(v.song, at - 1, at + 1);
      if (voice && !midLine(voice, at)) {
        for (let k = i; k <= j; k++) {
          visits[k] = { ...visits[k], phrase: np };
          moved.add(k);
        }
        changed = true;
        break;
      }
    }
  }

  for (const is of issues) {
    if (is.layer === undefined || moved.has(is.visit)) continue;
    const v = visits[is.visit];
    const p = plan.visits[is.visit];
    const l = v.layers?.[is.layer];
    if (!l || !v.layers) continue;
    if (is.kind === "empty") {
      const brief = c.briefs[l.song];
      const lBar = bar * rate(l.song);
      let swapped = false;
      for (const phrase of [l.phrase, l.phrase + 1, l.phrase - 1]) {
        const ph = brief.phrases[phrase];
        if (!ph) continue;
        const bars = [...new Set([...ph.lines, 0, 2, 4, 6])].filter((b) => b + l.len <= 8);
        for (const b of bars) {
          if (phrase === l.phrase && b === l.bar) continue;
          if (ph.start + (b + l.len + 1) * lBar > brief.duration - 0.05) continue;
          const a = ph.start + b * lBar;
          const lv = await c.ears.voice(l.song, a - 0.3, a + l.len * lBar + 0.3);
          if (lv && share(lv, a, a + l.len * lBar) >= 0.5) {
            v.layers[is.layer] = { ...l, phrase, bar: b };
            swapped = true;
            break;
          }
        }
        if (swapped) break;
      }
      if (!swapped) v.layers[is.layer] = { ...l, times: 0 };
      changed = true;
    } else if (is.kind === "host") {
      const room = v.bars - span(l);
      const hv = await voiceOf(c, plan, p, p.at, p.at + p.dur);
      if (!hv) continue;
      const tries = Array.from({ length: room + 1 }, (_, b) => b)
        .filter((b) => b !== l.at)
        .sort((x, y) => Math.abs(x - l.at) - Math.abs(y - l.at));
      const fine = (b: number) => {
        const w0 = p.at + b * bar;
        const w1 = w0 + span(l) * bar;
        const in0 = !hv.mid(w0) || hv.ends.some((t) => t <= w0 && t >= w0 - bar);
        const in1 = w1 >= p.at + p.dur - 0.1 || !hv.mid(w1) || hv.starts.some((t) => t >= w1 && t <= w1 + bar);
        return in0 && in1;
      };
      const b = tries.find(fine);
      v.layers[is.layer] = b === undefined ? { ...l, times: 0 } : { ...l, at: b };
      changed = true;
    }
  }
  for (const v of visits) if (v.layers) v.layers = v.layers.filter((l) => l.times > 0);
  return changed ? { ...script, visits } : null;
}

// ---- energy holes ---------------------------------------------------------

// Stretches of the rendered set much quieter than the set around them that
// the plan didn't ask for (a breakdown, a loop build or a solo is meant).
export function findHoles(buffer: AudioBuffer, plan: MixPlan): Issue[] {
  const sr = buffer.sampleRate;
  const win = 0.4;
  const hop = 0.2;
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  const n = Math.max(0, Math.floor((plan.end - win) / hop));
  const rms = new Float32Array(n);
  for (let w = 0; w < n; w++) {
    const i0 = Math.floor(w * hop * sr);
    const i1 = Math.min(L.length, i0 + Math.floor(win * sr));
    let sum = 0;
    let c = 0;
    for (let i = i0; i < i1; i += 4, c++) sum += (L[i] * L[i] + R[i] * R[i]) / 2;
    rms[w] = Math.sqrt(sum / Math.max(1, c));
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const thr = median * 10 ** (-14 / 20);
  const bar = barSeconds(plan.bpm);
  const meant = (t: number) =>
    plan.visits.some((v) => (v.fx.breakdown || v.fx.loopBuild) && t >= v.at - 0.5 && t <= v.at + v.dur + 0.5);
  const holes: Issue[] = [];
  let start = -1;
  for (let w = 0; w <= n; w++) {
    const t = w * hop;
    const low = w < n && t > bar && t < plan.end - bar && rms[w] < thr && !meant(t + win / 2);
    if (low && start < 0) start = t;
    if (!low && start >= 0) {
      if (t + win - start >= 0.6) {
        const visit = plan.visits.findIndex((v) => start >= v.at && start < v.at + v.dur);
        if (visit >= 0) holes.push({ kind: "hole", visit, at: start, to: t + win });
      }
      start = -1;
    }
  }
  return holes;
}

// A hole at a switch: blend the songs over it instead of cutting. A hole
// inside a part: lift it to a stronger phrase, or keep the Mixer's kick going
// through it.
function repairHoles(script: SetScript, plan: MixPlan, holes: Issue[], briefs: SongBrief[]): SetScript | null {
  if (plan.visits.length !== script.visits.length) return null;
  const bar = barSeconds(plan.bpm);
  const visits = script.visits.map((v) => ({ ...v, fx: { ...v.fx } }));
  const stems = (i: number) => !!briefs[visits[i].song].stems;
  for (const h of holes) {
    const p = plan.visits[h.visit];
    const v = visits[h.visit];
    const next = visits[h.visit + 1];
    const srcBar = bar * plan.songs[v.song].rate;
    const atStart = h.at - p.at < 1.5 * bar && h.visit > 0;
    const atEnd = p.at + p.dur - h.at < 1.5 * bar && !!next;
    if (atStart && v.move === "cut" && stems(h.visit) && stems(h.visit - 1)) v.move = "blend";
    else if (atEnd && next.move === "cut" && stems(h.visit) && stems(h.visit + 1)) next.move = "blend";
    else if (v.move !== "flow" && next?.move !== "flow" && h.visit > 0) {
      const np = strongPhrase(briefs[v.song], v.phrase, v.bars, srcBar);
      if (np !== v.phrase && fits(briefs[v.song], np, (v.skip ?? 0) + v.bars, srcBar)) v.phrase = np;
      else v.fx.kick = true;
    } else v.fx.kick = true;
  }
  return holes.length ? { ...script, visits } : null;
}

// ---- the whole loop -------------------------------------------------------

// Prepare, listen, repair and render a set: what the Mixer runs instead of a
// straight prepare → plan → stems → render.
export async function mixWithEars(o: {
  songs: SongAnalysis[];
  briefs: SongBrief[];
  script: SetScript;
  energy: Energy;
  mood: Mood;
  tag: AudioBuffer | null;
  show: (label: string, fraction: number) => void;
  signal?: AbortSignal;
}): Promise<{ plan: MixPlan; buffer: AudioBuffer; report: EarsReport; script: SetScript }> {
  const { songs, briefs, energy, mood, show } = o;
  const c: Ctx = { songs, briefs, ears: new Ears(songs, o.signal), energy, veto: new Set() };
  const stop = () => {
    if (o.signal?.aborted) throw new DOMException("Stopped", "AbortError");
  };

  show("Cueing up the parts", 0.7);
  let script = o.script;
  const prepared: PreparedSong[] = await prepareSongs(songs, script, (f) => show("Cueing up the parts", 0.7 + f * 0.06));
  stop();
  let plan = planTimes(script, songs, prepared);

  // 1. Listen to every switch and line, hand the voices over on breaths, and
  // repair what a breath can't fix; then listen again.
  show("Listening to every switch", 0.76);
  const first = await listenAndHand(plan, c);
  stop();
  let heard = first;
  if (heard.issues.length) {
    const fixed = await repair(script, plan, heard.issues, c);
    stop();
    if (fixed) {
      show("Fixing what it heard", 0.78);
      await prepareSongs(songs, fixed, undefined, prepared);
      stop();
      const nextPlan = planTimes(fixed, songs, prepared);
      const again = await listenAndHand(nextPlan, c);
      stop();
      if (again.issues.length < heard.issues.length) {
        script = fixed;
        plan = nextPlan;
        heard = again;
      } else {
        // Keep the first plan; hand its voices over again (the second listen
        // rewrote shared layer objects).
        heard = await listenAndHand(plan, c);
      }
    }
  }

  // 2. Render, then listen for holes in the energy.
  const render = async (p: MixPlan, label: string, f0: number) => {
    if (songs.some((s) => s.stems)) {
      for (const ps of prepared) for (const part of ps.parts.values()) part.windows = [];
      show("Splitting the moves into stems", f0);
      await prepareStems(songs, prepared, p, energy, (f) => show("Splitting the moves into stems", f0 + f * 0.04));
      stop();
    }
    show(label, f0 + 0.04);
    return renderSet(prepared, p, energy, o.tag, mood);
  };
  let buffer = await render(plan, "Mixing the set", 0.8);
  stop();
  show("Listening for holes in the energy", 0.88);
  const firstHoles = findHoles(buffer, plan);
  let holes = firstHoles;
  if (holes.length) {
    // A hole where a hand-over held a voice back: that hand-over goes back to
    // plain. Any other hole gets a hole repair.
    const near = (h: Issue, g: Gap) => h.at <= g.to + 0.3 && (h.to ?? h.at + 0.6) >= g.from - 0.3;
    const others: Issue[] = [];
    for (const h of holes) {
      const hit = heard.gaps.filter((g) => near(h, g));
      for (const g of hit) c.veto.add(g.key);
      if (!hit.length) others.push(h);
    }
    const fixed = others.length ? repairHoles(script, plan, others, briefs) : script;
    if (fixed) {
      await prepareSongs(songs, fixed, undefined, prepared);
      stop();
      const p2 = planTimes(fixed, songs, prepared);
      const h2heard = await listenAndHand(p2, c);
      stop();
      const b2 = await render(p2, "Mixing it again with the fixes", 0.89);
      stop();
      const h2 = findHoles(b2, p2);
      if (h2.length < holes.length) {
        buffer = b2;
        plan = p2;
        script = fixed;
        holes = h2;
        heard = h2heard;
      }
    }
  }

  const found = first.issues.length + first.handed + firstHoles.length;
  const left = heard.issues.length + holes.length;
  return {
    plan,
    buffer,
    script,
    report: {
      switches: first.switches,
      lines: first.lines,
      found,
      fixed: Math.max(0, found - left),
      left,
      heard: [...first.issues, ...firstHoles],
      still: [...heard.issues, ...holes],
    },
  };
}

// The line shown under a finished mix.
export function earsLine(r: EarsReport): string {
  const what = `${r.switches} switch${r.switches === 1 ? "" : "es"}${r.lines ? ` and ${r.lines} line${r.lines === 1 ? "" : "s"}` : ""}`;
  if (!r.found) return `The Mixer listened to ${what}: all clean.`;
  return `The Mixer listened to ${what} and fixed ${r.fixed}${r.left ? `; ${r.left} it couldn't fix` : ""}.`;
}
