import Anthropic from "@anthropic-ai/sdk";

import { NO_FX, type Energy, type MixMinutes, type SetScript, type SongBrief } from "./script";

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
- Moves between parts: "blend" (smooth bass swap, the default), "mashup" (for 4 bars the outgoing song keeps only its beat and bass under the incoming song's vocals and melody: use it when keys match, it is your signature move), "cut" (echo out, slam in: for big moments, or when a song's tempo can't be locked).
- Additions (only on songs whose tempo locks to the opener): fx.kick, fx.hats, fx.claps, fx.pump. Use them to lift builds and peaks; leave intros, breakdowns and the outro clean.
- The first part's song sets the tempo for the whole set. Songs more than 12% away from it (after allowing half/double time) cannot blend: they must enter and leave with "cut" and get no additions.
- Respect the listener's energy setting: "lounge" = smooth, few additions, no claps or loop builds; "club" = balanced; "peak" = harder, more drops and additions.
- Reach at least the requested length (sum of bars × seconds per bar). Seconds per bar = 240 / opener BPM.

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
        required: ["song", "phrase", "bars", "move", "fx", "note"],
        properties: {
          song: { type: "integer" },
          phrase: { type: "integer" },
          bars: { type: "integer", description: "8, 16 or 32" },
          move: { type: "string", enum: ["open", "blend", "mashup", "cut"] },
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
        .map((p, k) => `${k}@${Math.round(p.start)}s ${p.label} e${p.energy} b${p.bass}`)
        .join(" | ");
      return [
        `Song ${i}: "${s.title}"${s.makers.length ? ` by ${s.makers.join(", ")}` : ""}`,
        s.descriptors.length ? `  sound: ${s.descriptors.join(", ")}` : null,
        `  ${Math.round(s.bpm)} BPM (${lock}) · key ${s.key.name} (${s.key.camelot}${s.key.confidence < 0.3 ? ", uncertain" : ""}) · ${Math.round(s.duration)}s`,
        `  phrases (index@start label energy0-9 bass0-9): ${phrases}`,
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
  move: "open" | "blend" | "mashup" | "cut";
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
    `The listener's suggested opener is song 0; you may choose another opener if it makes a better set (it then sets the tempo).`,
    vibe ? `The listener's vibe for this set: "${vibe}"` : "The listener gave no vibe; make the best club journey these songs allow.",
    "",
    briefText(songs, 0),
    "",
    "Plan the set.",
  ].join("\n");

  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
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
      note: typeof p.note === "string" ? p.note : undefined,
    }));
  return {
    title: typeof out.title === "string" ? out.title.slice(0, 80) : "AIRED Set",
    story: typeof out.story === "string" ? out.story.slice(0, 400) : "",
    visits,
    by: "brain",
  };
}
