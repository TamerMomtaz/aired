import Anthropic from "@anthropic-ai/sdk";

import {
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

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ timeout: 45_000, maxRetries: 1 });
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
- Tension tools: a breakdown part (fx.breakdown, bass stripped), a filter rise (fx.filter_rise) or a loop build (fx.loop_build: the last 4 bars stutter 1 bar, ½, ¼) with a riser, then a drop (fx.drop) into the next part. After a loop build the next part comes in with "cut".
- Moves between parts: "blend" (smooth bass swap), "mashup" (for 4 bars the outgoing song keeps only its beat and bass under the incoming song's vocals and melody: use it when keys match), "trade" (call and response: for the first 8 bars the two songs swap every 2 bars, every bar at peak energy, before the new one takes over: the songs talk to each other), "cut" (echo out, slam in: for big moments, or when a song's tempo can't be locked).

LINKING is what separates a real DJ from smooth blending, and it is the heart of your job. Blends alone sound like a playlist with crossfades. So in most parts, drop LINES on top: a line is 1, 2 or 4 bars lifted from any song (another song, or this one) and played over the current part, voice and melody only, on the beat, while the part underneath steps its mids back. Each phrase in the brief lists its vocal score v0-9 (how much voice or hook is in it) and its best lines as bar offsets (lines 2,6 = bars 2 and 6 of that phrase). Pick lines from high-v phrases. A layer is {song, phrase, bar, len, at, times, style}: "at" is the bar inside the current part where it lands, "times" repeats it back to back (1-4), and style is
  "lift" (the line as it is), "chop" (its first half-beat stuttered then the line: "ha-ha-hey", for energy), or "echo" (sung once and thrown into an echo that rings on).
Use lines to:
  - tease the next song: its best line floats over the current part a few bars before it arrives, so the arrival feels inevitable;
  - build a thread: choose the set's strongest hook and bring it back over other songs again and again, so the whole set is one story;
  - answer: a line from one song replying to a line in another (put them at alternating bars);
  - lift a build: a chopped line repeated 4× under a riser.
Keep lines out of breakdowns' last bars and loop builds' last 4 bars, never overlap two lines in one part, and use at most 3 per part. Only songs whose tempo locks can give or take lines.
- Additions (only on songs whose tempo locks to the opener): fx.kick, fx.hats, fx.claps, fx.pump. Use them to lift builds and peaks; leave intros, breakdowns and the outro clean.
- The first part's song sets the tempo for the whole set. Songs more than 12% away from it (after allowing half/double time) cannot blend: they must enter and leave with "cut" and get no additions.
- The energy setting must change the whole character of the set, not just the volume:
  "lounge" = the set runs 4% slower; long 32-bar parts, long blends and mashups, no added drums, no trades, no chops; lines float in "echo" or "lift", slow and spacious.
  "club" = the opener's tempo; 16-bar parts; trades and mashups; lifted lines, teasers and a recurring hook; a breakdown and a loop build before the main drop.
  "peak" = the set runs 4% faster; short 8-bar parts; trades every bar, cuts, chopped hooks repeated, a loop build and drop every 32 bars or so, kick, claps and pump almost throughout.
- Reach at least the requested length (sum of bars × seconds per bar). The set's BPM and seconds per bar are given in the request.

Writing:
- title: a short, evocative name for this set (no third-party artist names).
- story: two sentences on the journey you planned, in plain warm words.
- note on each part: one short line saying why (key match, the build, the drop…). Never name any real artist, DJ or band outside the songs' own makers: describe sounds instead.
- Write title, story and notes in the same language as the listener's vibe text when they gave one (Egyptian Arabic, English or a mix), otherwise English.`;

const FX_PROPS = {
  kick: { type: "boolean" },
  hats: { type: "boolean" },
  claps: { type: "boolean" },
  pump: { type: "boolean" },
  riser: { type: "boolean" },
  drop: { type: "boolean" },
  loop_build: { type: "boolean" },
  breakdown: { type: "boolean" },
  filter_rise: { type: "boolean" },
};

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
        required: ["song", "phrase", "bars", "move", "layers", "fx", "note"],
        properties: {
          song: { type: "integer" },
          phrase: { type: "integer" },
          bars: { type: "integer", description: "8, 16 or 32" },
          move: { type: "string", enum: ["open", "blend", "mashup", "trade", "cut"] },
          layers: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["song", "phrase", "bar", "len", "at", "times", "style"],
              properties: {
                song: { type: "integer" },
                phrase: { type: "integer" },
                bar: { type: "integer", description: "0-7, where the line starts in that phrase" },
                len: { type: "integer", description: "1, 2 or 4 bars" },
                at: { type: "integer", description: "bar inside this part where it lands" },
                times: { type: "integer", description: "1-4 repeats" },
                style: { type: "string", enum: ["lift", "chop", "echo"] },
              },
            },
          },
          fx: {
            type: "object",
            additionalProperties: false,
            required: Object.keys(FX_PROPS),
            properties: FX_PROPS,
          },
          note: { type: "string" },
        },
      },
    },
  },
};

function briefText(songs: SongBrief[], opener: number): string {
  const master = songs[opener].bpm;
  return songs
    .map((s, i) => {
      const lock = (() => {
        const ratio = master / s.bpm;
        const best = [ratio, ratio * 2, ratio / 2].reduce((a, b) => (Math.abs(b - 1) < Math.abs(a - 1) ? b : a));
        return Math.abs(best - 1) <= 0.12 ? `locks to the opener at ${((best - 1) * 100).toFixed(1)}%` : "CANNOT lock to the opener's tempo";
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
  song: number;
  phrase: number;
  bars: number;
  move: "open" | "blend" | "mashup" | "trade" | "cut";
  layers?: Layer[];
  fx: Record<keyof typeof FX_PROPS, boolean>;
  note: string;
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
    `If song 0 opens, the set runs at ${masterBpm(songs[0].bpm, energy).toFixed(1)} BPM, so one bar is ${(240 / masterBpm(songs[0].bpm, energy)).toFixed(2)} s (${STYLE[energy].push === 1 ? "the opener's own tempo" : `the opener's tempo ${STYLE[energy].push > 1 ? "+" : "-"}4%`}).`,
    songs.length === 1
      ? `This is a REMIX of one song: rebuild it in the ${energy} mood from its own parts. Rearrange its phrases into a new arc (not its original order), trade its verse against its chorus in call and response, drop its own best lines over its other parts, and use breakdowns, loop builds and drops. Never play two copies of the same phrase on top of each other.`
      : `Song 0 is the suggested opener, chosen because its key and tempo flow best into the others; you may choose another opener if it makes a better set (it then sets the tempo). Songs whose keys are 3 or more steps apart on the Camelot wheel must never overlap: go between them with a "cut" (echo out, slam in).`,
    vibe ? `The listener's vibe for this set: "${vibe}"` : "The listener gave no vibe; make the best club journey these songs allow.",
    "",
    briefText(songs, 0),
    "",
    "Plan the set.",
  ].join("\n");

  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    ...fallbackParams(),
  });
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
    .filter((p) => Number.isInteger(p?.song) && Number.isInteger(p?.phrase))
    .map((p) => ({
      song: p.song,
      phrase: p.phrase,
      bars: (p.bars === 8 || p.bars === 32 ? p.bars : 16) as 8 | 16 | 32,
      move: p.move,
      fx: {
        ...NO_FX,
        kick: !!p.fx?.kick,
        hats: !!p.fx?.hats,
        claps: !!p.fx?.claps,
        pump: !!p.fx?.pump,
        riser: !!p.fx?.riser,
        drop: !!p.fx?.drop,
        loopBuild: !!p.fx?.loop_build,
        breakdown: !!p.fx?.breakdown,
        filterRise: !!p.fx?.filter_rise,
      },
      layers: Array.isArray(p.layers) ? p.layers.filter((l) => Number.isInteger(l?.song)) : [],
      note: typeof p.note === "string" ? p.note : undefined,
    }));
  return {
    title: typeof out.title === "string" ? out.title.slice(0, 80) : "AIRED Set",
    story: typeof out.story === "string" ? out.story.slice(0, 400) : "",
    visits,
    by: "brain",
  };
}
