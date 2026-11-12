import Anthropic from "@anthropic-ai/sdk";

import type { CatalogSong } from "./catalog";
import type { Hit } from "./score";

// The "understand what I meant" half of voice search, powered by Claude.
//
// One call per search. Claude sees a short card for EVERY live song (title,
// makers, sound, opening lines and the most repeated lines, which are usually
// the chorus) plus the songs whose words matched what the listener said, and
// picks the song they meant: by a lyric, by what the song is about, by its
// mood, or by who made it. Matching words are a hint, never the answer, so a
// song that only SOUNDS like the query does not win over one that fits it.
//
// The catalog cards sit in the system prompt behind a cache breakpoint and are
// built in a fixed order, so repeated searches read them from the prompt cache
// instead of paying for them each time.
//
// When ANTHROPIC_API_KEY is not set, or the call fails, search falls back to
// plain keyword matching. Nothing here is stored: the spoken query is used for
// this one request and dropped. Only public song text is sent, the same text
// anyone can read on the song page.

const MODEL = process.env.AIRED_VOICE_MODEL || "claude-opus-5-5";

let client: Anthropic | null = null;
export function voiceAiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ timeout: 20_000, maxRetries: 1 });
  return client;
}

// Server-side fallback routing applies to the 5-series models; other models get
// a plain request.
function fallbackParams(): { betas?: string[]; fallbacks?: "default" } {
  return /^claude-(opus-5|fable-5|sonnet-5-5)/.test(MODEL)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
    : {};
}

const INSTRUCTIONS = `You are the song finder inside AIRED, a music app. A listener asks for a song by voice, in Egyptian Arabic, English, or a mix. Speech-to-text may have misheard them.

They may describe the song in any way:
- a lyric or a word they remember (the catalog's lyrics are often Egyptian Arabic written in Latin letters, like "ehna el farafeesh", while the listener's words may be in Arabic script, or the other way round);
- what the song is about, its story, or who it is for;
- its mood or feel ("something calm", "the angry one", "حاجة تفرّح");
- its title, its number (AIRED-0012), or who made it.

Pick by MEANING. Words that merely sound alike are weak evidence: a song that only shares a sound with the request must not beat a song that fits what they described. If nothing fits, return no picks.

Return:
- intent: "play" if they want it played now ("play", "شغل", "اسمع", "حط", "put on"), otherwise "find". A bare description with no verb counts as "play".
- picks: at most 5 songs, best first. For each: its id, a confidence from 0 to 1 that it is the song they meant, and a reason of at most 12 words in the listener's language that says why it fits (the theme, the line, or the mood), never just "the words match".

The full catalog follows. Each card shows the song's id, title, makers, sound, opening lines and its most repeated lines.`;

const PICK_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["play", "find"] },
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
  required: ["intent", "picks"],
  additionalProperties: false,
};

const LINE_CHARS = 90;
const clip = (s: string) =>
  s.length > LINE_CHARS ? `${s.slice(0, LINE_CHARS - 1)}…` : s;

// The lines a song repeats most are usually its chorus, the part people
// remember and the part that says what the song is about.
function mostRepeated(lines: string[], n: number): string[] {
  const counts = new Map<string, { line: string; count: number; first: number }>();
  lines.forEach((line, i) => {
    const key = line.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
    if (key.length < 6) return;
    const entry = counts.get(key);
    if (entry) entry.count++;
    else counts.set(key, { line, count: 1, first: i });
  });
  return Array.from(counts.values())
    .filter((e) => e.count >= 2)
    .sort((a, b) => b.count - a.count || a.first - b.first)
    .slice(0, n)
    .map((e) => e.line);
}

function card(song: CatalogSong): string {
  const opening = Array.from(new Set(song.lines.slice(0, 8).map(clip))).slice(0, 5);
  const chorus = mostRepeated(song.lines, 3)
    .map(clip)
    .filter((l) => !opening.includes(l));
  return [
    `#${song.id} ${song.title}`,
    song.contributors.length
      ? `made by: ${song.contributors.map((c) => c.name).join(", ")}`
      : "",
    song.artist ? `artist: ${song.artist}` : "",
    song.album ? `album: ${song.album}` : "",
    song.descriptors.length ? `sound: ${song.descriptors.join(", ")}` : "",
    opening.length ? `opens: ${opening.join(" / ")}` : "",
    chorus.length ? `repeats: ${chorus.join(" / ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// The cards text is memoized per catalog array (the catalog module hands back
// the same array until its cache refreshes), and is built in id order, so the
// cached prompt prefix stays byte-identical between searches.
const cardsCache = new WeakMap<CatalogSong[], string>();
export function catalogCards(songs: CatalogSong[]): string {
  let text = cardsCache.get(songs);
  if (!text) {
    text = [...songs]
      .sort((a, b) => a.id - b.id)
      .map(card)
      .join("\n\n");
    cardsCache.set(songs, text);
  }
  return text;
}

export type Pick = { id: number; confidence: number; reason: string };
export type Understanding = { intent: "play" | "find"; picks: Pick[] };

export async function understandAndPick(
  query: string,
  songs: CatalogSong[],
  wordHits: Hit[],
): Promise<Understanding | null> {
  const hints = wordHits.length
    ? wordHits
        .slice(0, 8)
        .map(
          (h) =>
            `#${h.song.id} ${h.song.title}${
              h.matchedLines.length
                ? `: ${h.matchedLines.slice(0, 3).map(clip).join(" / ")}`
                : ""
            }`,
        )
        .join("\n")
    : "(none)";

  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: [
      { type: "text", text: INSTRUCTIONS },
      {
        type: "text",
        text: catalogCards(songs),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Songs whose words overlap with what the listener said (a hint only, may be sound-alikes):\n${hints}\n\nThe listener said: ${JSON.stringify(query)}`,
      },
    ],
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: PICK_SCHEMA },
    },
    ...fallbackParams(),
  });
  if (response.stop_reason === "refusal") return null;

  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  let out: { intent?: string; picks?: Pick[] };
  try {
    out = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(out.picks)) return null;
  const allowed = new Set(songs.map((s) => s.id));
  return {
    intent: out.intent === "find" ? "find" : "play",
    picks: out.picks
      .filter((p) => allowed.has(p.id))
      .map((p) => ({
        id: p.id,
        confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0)),
        reason: String(p.reason ?? "").slice(0, 160),
      }))
      .slice(0, 5),
  };
}
