import Anthropic from "@anthropic-ai/sdk";

import type { CatalogSong } from "./catalog";
import type { Hit } from "./score";

// The "understand what I meant" half of voice search, powered by Claude.
//
// Two small calls, both optional:
//   1. expandQuery  — turn what the listener said (Egyptian Arabic, English, or
//      both mixed) into the words a lyric or title would actually contain:
//      Arabic script AND Franco/Latin spellings AND English, plus synonyms.
//   2. pickSongs    — given the few songs keyword search found (with the lines
//      that matched), decide which one the listener meant, and say why in a few
//      words in the listener's own language.
//
// When ANTHROPIC_API_KEY is not set, or a call fails, search falls back to plain
// keyword matching and still works. Nothing here is stored: the spoken query is
// used for this one request and dropped. Only public song text (title, lyrics,
// makers, descriptors) is sent — the same text anyone can read on the song page.

const MODEL = process.env.AIRED_VOICE_MODEL || "claude-opus-5-5";

let client: Anthropic | null = null;
export function voiceAiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ timeout: 15_000, maxRetries: 1 });
  return client;
}

// Server-side fallback routing applies to the 5-series models; other models get
// a plain request.
function fallbackParams(): { betas?: string[]; fallbacks?: "default" } {
  return /^claude-(opus-5|fable-5|sonnet-5-5)/.test(MODEL)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
    : {};
}

async function askJson<T>(
  system: string,
  user: string,
  schema: Record<string, unknown>,
  maxTokens: number,
): Promise<T | null> {
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema },
    },
    ...fallbackParams(),
  });
  if (response.stop_reason === "refusal") return null;
  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export type Expansion = {
  intent: "play" | "find";
  keywords: string[];
  phrases: string[];
  catalogNumber: number | null;
};

const EXPAND_SYSTEM = `You help a music app understand a listener who is looking for a song by voice.
The listener may speak Egyptian Arabic, English, or a mix, and speech-to-text may have misheard words.
They may describe the song by a lyric they remember, a word or name sung in it, its title, who made it, its mood, or what it is about.

Return:
- intent: "play" if they want it played now ("play", "شغل", "اسمع", "حط"), otherwise "find".
- keywords: 6 to 20 single words that would likely appear in the song's title or lyrics. Include each idea in Arabic script (Egyptian spelling), in Latin/Franco-Arabic spelling (e.g. "habibi", "7abibi"), and in English when it has an English form. Include likely correct forms of words that sound misheard. Leave out filler words like "song", "play", "اغنية", "شغل".
- phrases: up to 3 short multi-word lyric fragments the listener seems to be quoting, in the script they would be written in. Empty if none.
- catalogNumber: the number if they said a catalog id like "AIRED 12" or "song number 12", else null.`;

const EXPAND_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["play", "find"] },
    keywords: { type: "array", items: { type: "string" } },
    phrases: { type: "array", items: { type: "string" } },
    catalogNumber: { type: ["integer", "null"] },
  },
  required: ["intent", "keywords", "phrases", "catalogNumber"],
  additionalProperties: false,
};

export async function expandQuery(query: string): Promise<Expansion | null> {
  const out = await askJson<Expansion>(
    EXPAND_SYSTEM,
    `The listener said: ${JSON.stringify(query)}`,
    EXPAND_SCHEMA,
    1024,
  );
  if (!out || !Array.isArray(out.keywords)) return null;
  return {
    intent: out.intent === "play" ? "play" : "find",
    keywords: out.keywords.filter((k) => typeof k === "string").slice(0, 30),
    phrases: (out.phrases ?? [])
      .filter((p) => typeof p === "string")
      .slice(0, 3),
    catalogNumber:
      typeof out.catalogNumber === "number" && out.catalogNumber > 0
        ? out.catalogNumber
        : null,
  };
}

export type Pick = { id: number; confidence: number; reason: string };

const PICK_SYSTEM = `You help a music app pick the song a listener asked for by voice.
You get what they said and a numbered list of candidate songs from the catalog, each with its title, makers, descriptors, opening lines, and the lyric lines that matched their words.
Choose the songs that fit what they described — by meaning, not just shared words. Speech-to-text may have misheard them, and they may describe a song in one language whose lyrics are in another.

Return picks: the best matches first, at most 5, only songs that plausibly fit (an empty list is fine).
For each: the song id, a confidence from 0 to 1 that this is the song they meant, and a reason of at most 12 words, written in the same language the listener used.`;

const PICK_SCHEMA = {
  type: "object",
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          confidence: { type: "number" },
          reason: { type: "string" },
        },
        required: ["id", "confidence", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["picks"],
  additionalProperties: false,
};

function describe(song: CatalogSong, matched: string[]): string {
  const parts = [
    `id: ${song.id}`,
    `title: ${song.title}`,
    song.contributors.length
      ? `made by: ${song.contributors.map((c) => c.name).join(", ")}`
      : "",
    song.artist ? `artist: ${song.artist}` : "",
    song.album ? `album: ${song.album}` : "",
    song.descriptors.length ? `sound: ${song.descriptors.join(", ")}` : "",
    song.lines.length ? `opens with: ${song.lines.slice(0, 4).join(" / ")}` : "",
    matched.length ? `matched lines: ${matched.join(" / ")}` : "",
  ];
  return parts.filter(Boolean).join("\n");
}

// When keyword search finds little, the AI looks at a short card for every song
// instead, so a purely descriptive ask ("the sad one about the sea") can still
// land. Cards are title + makers + descriptors + the first lines only.
export function cardsForWholeCatalog(songs: CatalogSong[]): Hit[] {
  return songs.map((song) => ({ song, score: 0, matchedLines: [] }));
}

export async function pickSongs(
  query: string,
  candidates: Hit[],
): Promise<Pick[] | null> {
  if (candidates.length === 0) return [];
  const list = candidates
    .map((h, i) => `[${i + 1}]\n${describe(h.song, h.matchedLines)}`)
    .join("\n\n");
  const out = await askJson<{ picks: Pick[] }>(
    PICK_SYSTEM,
    `Candidate songs:\n\n${list}\n\nThe listener said: ${JSON.stringify(query)}`,
    PICK_SCHEMA,
    2048,
  );
  if (!out || !Array.isArray(out.picks)) return null;
  const allowed = new Set(candidates.map((c) => c.song.id));
  return out.picks
    .filter((p) => allowed.has(p.id))
    .map((p) => ({
      id: p.id,
      confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0)),
      reason: String(p.reason ?? "").slice(0, 160),
    }))
    .slice(0, 5);
}
