import Anthropic from "@anthropic-ai/sdk";

import type { CatalogSong } from "@/lib/voice/catalog";
import { catalogCards } from "@/lib/voice/understand";

import { SUGGEST_PICKS, type Feeling, type Suggestion } from "./feelings";
import { MOODS } from "./moods";

// TeeJay picks a set from the whole live catalog for one feeling.
//
// Claude reads the same public song cards voice search uses (title, makers,
// sound descriptors, opening and repeated lines; nothing private), cached in
// the system prompt, and chooses songs the way a DJ would: they fit the
// feeling AND each other (sound, language, tempo feel, energy), with the set's
// arc in mind. The newest songs are named so a new upload gets its chance.
// The page then listens to every pick and drops any whose tempo can't meet the
// rest, so a guess about tempo from the descriptors never ends in a collision.
//
// Without ANTHROPIC_API_KEY, or if the call fails, a rules pick scores the
// descriptors against the feeling's words and shuffles among the best.

const MODEL = process.env.AIRED_MIX_MODEL || process.env.AIRED_VOICE_MODEL || "claude-opus-5-5";

let client: Anthropic | null = null;
export function teejayEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ timeout: 30_000, maxRetries: 1 });
  return client;
}
function fallbackParams(): { betas?: string[]; fallbacks?: "default" } {
  return /^claude-(opus-5|fable-5|sonnet-5-5)/.test(MODEL)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
    : {};
}

const INSTRUCTIONS = `You are TeeJay, the resident DJ of AIRED, a music platform where every song is made by humans and AI together. A listener has pressed one button to say how they want to feel, and you choose a set for them from the whole catalog.

Choose like a great DJ, not like a search engine:
- Every song must fit the feeling.
- The songs must fit EACH OTHER: compatible sound and energy, a similar tempo feel (a 70 BPM ballad and a 128 BPM club track will not blend), languages and colours that flow. Avoid pairs that would collide.
- Think of the arc: an opener that sets the scene, a build, a peak, a landing. Return the songs in the order you would play them.
- Be creative. Surprise the listener with a pairing they would not have thought of, while staying true to the feeling. Do not always pick the same songs: a list of songs to avoid this time may be given.
- Give newer songs a fair chance. The newest uploads are listed; include at least one of them when it fits the feeling.

Return:
- ids: exactly ${SUGGEST_PICKS} song ids from the catalog, in playing order (the Mixer will drop any that cannot meet the others' tempo, so order them by how much you want each).
- mood: one mood id from the allowed list for this feeling, the one that suits these songs best.
- title: a short name for the set (2 to 5 words), in the listener's language for the feeling (Arabic for an Arabic feeling).
- why: one line of at most 20 words, in TeeJay's warm voice, saying why these songs belong together. Name the sound, never a third-party artist.

Never name or compare to any artist outside the catalog. The full catalog follows; each card shows the song's id, title, makers, sound, opening lines and its most repeated lines.`;

const SCHEMA = {
  type: "object",
  properties: {
    ids: { type: "array", items: { type: "integer" } },
    mood: { type: "string" },
    title: { type: "string" },
    why: { type: "string" },
  },
  required: ["ids", "mood", "title", "why"],
  additionalProperties: false,
};

function moodLine(id: string): string {
  const m = MOODS.find((x) => x.id === id);
  return m ? `${m.id} (${m.label}): ${m.note}` : id;
}

export async function teejayPick(
  feeling: Feeling,
  songs: CatalogSong[],
  avoid: number[],
): Promise<Suggestion | null> {
  const newest = [...songs].sort((a, b) => b.id - a.id).slice(0, 8);
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: [
      { type: "text", text: INSTRUCTIONS },
      { type: "text", text: catalogCards(songs), cache_control: { type: "ephemeral" } },
    ],
    messages: [
      {
        role: "user",
        content: [
          `Feeling: ${feeling.emoji} ${feeling.label}`,
          `What it means: ${feeling.brief}`,
          `Allowed moods (the Mixer plays these grooves itself):\n${feeling.moods.map(moodLine).join("\n")}`,
          `Newest songs: ${newest.map((s) => `#${s.id} ${s.title}`).join(", ")}`,
          avoid.length ? `Avoid these songs this time (the listener just heard them): ${avoid.map((i) => `#${i}`).join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    ...fallbackParams(),
  });
  if (response.stop_reason === "refusal") return null;
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  let out: { ids?: unknown; mood?: unknown; title?: unknown; why?: unknown };
  try {
    out = JSON.parse(text);
  } catch {
    return null;
  }
  const live = new Set(songs.map((s) => s.id));
  const ids = Array.isArray(out.ids)
    ? [...new Set(out.ids.filter((x): x is number => typeof x === "number" && live.has(x)))].slice(0, SUGGEST_PICKS)
    : [];
  if (ids.length < 2) return null;
  const mood = typeof out.mood === "string" && feeling.moods.includes(out.mood) ? out.mood : feeling.moods[0];
  return {
    ids,
    mood,
    minutes: feeling.minutes,
    title: String(out.title ?? "").trim().slice(0, 60) || `TeeJay · ${feeling.label}`,
    why: String(out.why ?? "").trim().slice(0, 200),
    by: "teejay",
  };
}

// No Claude: score each song's descriptors against the feeling's words, then
// draw from the best (weighted, so each press differs), with one of the
// newest songs given a seat when it scores at all.
export function rulesPick(feeling: Feeling, songs: CatalogSong[], avoid: number[]): Suggestion | null {
  const avoidSet = new Set(avoid);
  const score = (s: CatalogSong) => {
    const text = `${s.descriptors.join(" ")} ${s.title}`.toLowerCase();
    return feeling.words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
  };
  const scored = songs
    .filter((s) => !avoidSet.has(s.id))
    .map((s) => ({ s, k: score(s) + Math.random() * 0.9 }))
    .sort((a, b) => b.k - a.k);
  if (scored.length < 2) return null;
  const pool = scored.slice(0, Math.max(SUGGEST_PICKS * 3, 12));
  const ids: number[] = [];
  const newest = [...pool].sort((a, b) => b.s.id - a.s.id)[0];
  if (newest && score(newest.s) > 0) ids.push(newest.s.id);
  for (const p of pool) {
    if (ids.length >= SUGGEST_PICKS) break;
    if (!ids.includes(p.s.id) && Math.random() < 0.7) ids.push(p.s.id);
  }
  for (const p of pool) if (ids.length < SUGGEST_PICKS && !ids.includes(p.s.id)) ids.push(p.s.id);
  const mood = feeling.moods[Math.floor(Math.random() * Math.min(3, feeling.moods.length))];
  return {
    ids,
    mood,
    minutes: feeling.minutes,
    title: `TeeJay · ${feeling.label}`,
    why: feeling.note,
    by: "rules",
  };
}
