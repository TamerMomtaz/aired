import Anthropic from "@anthropic-ai/sdk";

import {
  chooseRate,
  masterBpm,
  NO_FX,
  STYLE,
  type Energy,
  type Layer,
  type MixMinutes,
  type SetScript,
  type SongBrief,
} from "./script";

// The DJ brain: Claude plans the set the way a headline DJ plans a show.
//
// It never hears the audio. The browser analyses each song (tempo, key,
// phrase by phrase energy and bass, what each phrase is doing) and sends only
// those numbers, plus each song's public title, makers and sound descriptors.
// The brain answers with a SET SCRIPT (script.ts): the order, which part of
// each song plays, for how long, how each comes in, and what to add on top,
// with a one-line reason for each choice. The browser checks it (fixScript)
// and plays it. Nothing is stored: the listener's vibe text is used for this
// one request and dropped.

const MODEL =
  process.env.AIRED_MIX_MODEL ||
  process.env.AIRED_VOICE_MODEL ||
  "claude-opus-5-5";

// The route has 60 seconds in all. The plan must arrive well inside that, so
// the browser still has time to fall back to its own rules if it doesn't.
export const BRAIN_DEADLINE_MS = 48_000;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ timeout: BRAIN_DEADLINE_MS, maxRetries: 0 });
  return client;
}

export function mixBrainEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

function fallbackParams(): { betas?: string[]; fallbacks?: "default" } {
  return /^claude-(opus-5|fable-5|sonnet-5-5)/.test(MODEL)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
    : {};
}

const SYSTEM = `You are the DJ brain inside AIRED's Mixer. You plan a continuous club set from the listener's songs, the way the world's best headline DJs do. The audio engine plays exactly what you plan.

What great DJs do, and what you must do:
- Tell a story with energy: warm up, build, release, peak, land. Never stay flat; never peak too early. One or two big moments, earned by tension before them.
- Mix harmonically: put parts next to each other whose Camelot keys are the same or one step apart (same number, or ±1 on the same letter, or same number on the other letter). Avoid jumps of 3+ steps on a blend; if you must, use a "cut" with a drop.
- Phrase-match: every part starts on a phrase line (you choose phrases by index) and lasts 8, 16 or 32 bars.
- Trade parts between songs. Never play one song for more than 32 bars in a row, and never play half of one song and then half of another. Each time a song returns, move forward through it (later phrase indices) unless replaying its best hook on purpose.
- Use the phrase labels: start on an intro, place breakdowns before big moments, land drops on the beat of a "drop" phrase, close on an outro or a calm phrase.
- Tension tools: a breakdown part (breakdown: bass stripped), a filter rise (filter_rise) or a loop build (loop_build: the last 4 bars stutter 1 bar, ½, ¼) with a riser, then a drop (drop) into the next part. After a loop build the next part comes in with "cut".
- Moves between parts: "blend" (smooth bass swap), "mashup" (for 4 bars the outgoing song keeps only its beat and bass under the incoming song's vocals and melody: use it when keys match), "trade" (call and response: for the first 8 bars the two songs swap every 2 bars, every bar at peak energy, before the new one takes over: the songs talk to each other), "cut" (echo out, slam in: for big moments, or when a song's tempo can't be locked).

LINKING is what separates a real DJ from smooth blending, and it is the heart of your job. Blends alone sound like a playlist with crossfades. So in most parts, drop LINES on top: a line is 1, 2 or 4 bars lifted from any song (another song, or this one) and played over the current part, voice and melody only, on the beat, while the part underneath steps its mids back. Each phrase in the brief lists its vocal score v0-9 (how much voice or hook is in it) and its best lines as bar offsets (lines 2,6 = bars 2 and 6 of that phrase). Pick lines from high-v phrases. A line names its song, phrase, starting bar (0-7) and length (1, 2 or 4 bars); "at" is the bar inside the current part where it lands, "times" repeats it back to back (1-4), and style is
  "lift" (the line as it is), "chop" (its first half-beat stuttered then the line: "ha-ha-hey", for energy), or "echo" (sung once and thrown into an echo that rings on).
Use lines to:
  - tease the next song: its best line floats over the current part a few bars before it arrives, so the arrival feels inevitable;
  - build a thread: choose the set's strongest hook and bring it back over other songs again and again, so the whole set is one story;
  - answer: a line from one song replying to a line in another (put them at alternating bars);
  - lift a build: a chopped line repeated 4× under a riser.
Keep lines out of breakdowns' last bars and loop builds' last 4 bars, never overlap two lines in one part, and use at most 3 per part. Only songs whose tempo locks can give or take lines.
- Additions (only on songs whose tempo locks to the opener): kick, hats, claps, pump. Use them to lift builds and peaks; leave intros, breakdowns and the outro clean.
- The first part's song sets the tempo for the whole set. Songs more than 12% away from it (after allowing half/double time) cannot blend: they must enter and leave with "cut" and get no additions.
- The energy setting must change the whole character of the set, not just the volume:
  "lounge" = the set runs 4% slower; long 32-bar parts, long blends and mashups, no added drums, no trades, no chops; lines float in "echo" or "lift", slow and spacious.
  "club" = the opener's tempo; 16-bar parts; trades and mashups; lifted lines, teasers and a recurring hook; a breakdown and a loop build before the main drop.
  "peak" = the set runs 4% faster; short 8-bar parts; trades every bar, cuts, chopped hooks repeated, a loop build and drop every 32 bars or so, kick, claps and pump almost throughout.
- Reach at least the requested length (sum of bars × seconds per bar). The set's BPM and seconds per bar are given in the request.

THE LISTENER'S VIBE IS YOUR BRIEF. When they wrote one, it outranks every default above: if they ask for slow, dark, dubby, stripped, a long build, lots of chops, the hook all the time, an Arabic-night feel, a sunrise ending, plan exactly that and let the energy setting only set the tempo. Read the vibe for mood, pace, density, which song or line they love, and how it should end. Your story must say how you followed it.

How you answer (keep it compact: the set must reach the browser in seconds):
- title: a short, evocative name for this set (no third-party artist names).
- story: two sentences on the journey you planned, in plain warm words.
- parts: one object per part: s = song index, p = phrase index, b = bars (8, 16 or 32), m = move, fx = list of the effects switched on in this part (leave it empty for none), l = list of lines dropped on top, n = a few words on why (at most 8).
- each line in l is one string "song.phrase.bar.len.at.times.style", for example "1.4.2.2.0.2.chop" = song 1, phrase 4, from bar 2, 2 bars long, landing at bar 0 of this part, played twice, chopped.
- Never name any real artist, DJ or band outside the songs' own makers: describe sounds instead.
- Write title, story and notes in the same language as the listener's vibe text when they gave one (Egyptian Arabic, English or a mix), otherwise English.`;

const FX = ["kick", "hats", "claps", "pump", "riser", "drop", "loop_build", "breakdown", "filter_rise"] as const;
type FxName = (typeof FX)[number];

// Short keys and a one-string line format: the set comes back in a fraction of
// the tokens, so even a 10 minute peak set arrives in seconds.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "story", "parts"],
  properties: {
    title: { type: "string" },
    story: { type: "string" },
    parts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["s", "p", "b", "m", "fx", "l", "n"],
        properties: {
          s: { type: "integer" },
          p: { type: "integer" },
          b: { type: "integer" },
          m: { type: "string", enum: ["open", "blend", "mashup", "trade", "cut"] },
          fx: { type: "array", items: { type: "string", enum: [...FX] } },
          l: { type: "array", items: { type: "string" } },
          n: { type: "string" },
        },
      },
    },
  },
};

// "song.phrase.bar.len.at.times.style" → a layer, or null when it doesn't parse.
function parseLine(x: unknown): Layer | null {
  if (typeof x !== "string") return null;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\.(\d+)\.(\d+)\.(lift|chop|echo)$/.exec(x.trim());
  if (!m) return null;
  const [song, phrase, bar, len, at, times] = m.slice(1, 7).map(Number);
  return { song, phrase, bar, len, at, times, style: m[7] as Layer["style"] } as Layer;
}

function briefText(songs: SongBrief[], opener: number, energy: Energy): string {
  const master = masterBpm(songs, opener, energy);
  return songs
    .map((s, i) => {
      const lock = (() => {
        const r = chooseRate(master, s.bpm);
        return r.synced ? `locks to the set tempo at ${((r.rate - 1) * 100).toFixed(1)}%` : "CANNOT lock to the set tempo";
      })();
      const phrases = s.phrases
        .map((p, k) => `${k}@${Math.round(p.start)}s ${p.label} e${p.energy} b${p.bass} v${p.vocal} lines ${p.lines.join(",")}`)
        .join(" | ");
      return [
        `Song ${i}: "${s.title}"${s.makers.length ? ` by ${s.makers.join(", ")}` : ""}${(s.plays ?? 1) > 1 ? ` · the listener added it ${s.plays} times: give it about ${s.plays} shares of the set and bring it back between the other songs` : ""}`,
        s.descriptors.length ? `  sound: ${s.descriptors.join(", ")}` : null,
        `  ${Math.round(s.bpm)} BPM (${lock}) · key ${s.key.name} (${s.key.camelot}${s.key.confidence < 0.3 ? ", uncertain" : ""}) · ${Math.round(s.duration)}s`,
        `  phrases (index@start label energy0-9 bass0-9 vocal0-9 best-line-bars): ${phrases}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

type RawPart = {
  s: number;
  p: number;
  b: number;
  m: "open" | "blend" | "mashup" | "trade" | "cut";
  fx?: string[];
  l?: string[];
  n?: string;
};

export async function planWithBrain(input: {
  songs: SongBrief[];
  energy: Energy;
  minutes: MixMinutes;
  vibe: string;
}): Promise<SetScript | null> {
  const { songs, energy, minutes, vibe } = input;
  const user = [
    `Energy setting: ${energy}. Minimum length: ${minutes} minutes.`,
    `If song 0 opens, the set runs at ${masterBpm(songs, 0, energy).toFixed(1)} BPM, so one bar is ${(240 / masterBpm(songs, 0, energy)).toFixed(2)} s (set from the opener's tempo${STYLE[energy].push === 1 ? "" : ` ${STYLE[energy].push > 1 ? "+" : "-"}4%`}, moved toward the other songs when they are far from it, so they all lock).`,
    songs.length === 1
      ? `This is a REMIX of one song: rebuild it in the ${energy} mood from its own parts, the way a remixer would, not a DJ playing it through. Rearrange its phrases into a new arc (not its original order). Pick one remix idea that fits the vibe (or the mood if no vibe) and commit to it: an extended club version (long intro of beat and bass, the hook teased in echo, a long build, one huge drop); a dub version (stripped parts, breakdowns, lines thrown into echo, long spaces); a hook-chop version (the hook chopped and repeated over the other parts, again and again, under risers); a breakdown-first version (open on the calmest part, the full chorus only at the end); or call and response (its verse traded against its chorus bar by bar). Drop its own best lines over its other parts, and use breakdowns, loop builds and drops. Never play two copies of the same phrase on top of each other. Say in the story which idea you chose.`
      : `Song 0 is the suggested opener, chosen because its key and tempo flow best into the others; you may choose another opener if it makes a better set (it then sets the tempo). Songs whose keys are 3 or more steps apart on the Camelot wheel must never overlap: go between them with a "cut" (echo out, slam in).`,
    vibe ? `The listener's vibe for this set: "${vibe}"` : "The listener gave no vibe; make the best club journey these songs allow.",
    "",
    briefText(songs, 0, energy),
    "",
    "Plan the set.",
  ].join("\n");

  const stream = getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: 6000,
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    ...fallbackParams(),
  });
  const timer = setTimeout(() => stream.abort(), BRAIN_DEADLINE_MS);
  let response;
  try {
    response = await stream.finalMessage();
  } finally {
    clearTimeout(timer);
  }
  if (response.stop_reason === "refusal") return null;
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  let out: { title?: unknown; story?: unknown; parts?: unknown };
  try {
    out = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(out.parts)) return null;
  const visits = (out.parts as RawPart[])
    .filter((p) => Number.isInteger(p?.s) && Number.isInteger(p?.p))
    .map((p) => {
      const on = new Set((Array.isArray(p.fx) ? p.fx : []).filter((f): f is FxName => FX.includes(f as FxName)));
      return {
        song: p.s,
        phrase: p.p,
        bars: (p.b === 8 || p.b === 32 ? p.b : 16) as 8 | 16 | 32,
        move: p.m,
        fx: {
          ...NO_FX,
          kick: on.has("kick"),
          hats: on.has("hats"),
          claps: on.has("claps"),
          pump: on.has("pump"),
          riser: on.has("riser"),
          drop: on.has("drop"),
          loopBuild: on.has("loop_build"),
          breakdown: on.has("breakdown"),
          filterRise: on.has("filter_rise"),
        },
        layers: (Array.isArray(p.l) ? p.l : []).map(parseLine).filter((l): l is Layer => l !== null),
        note: typeof p.n === "string" ? p.n : undefined,
      };
    });
  return {
    title: typeof out.title === "string" ? out.title.slice(0, 80) : "AIRED Set",
    story: typeof out.story === "string" ? out.story.slice(0, 400) : "",
    visits,
    by: "brain",
  };
}
