import Anthropic from "@anthropic-ai/sdk";

import type { CatalogSong } from "@/lib/voice/catalog";
import type { HostLang } from "./persona";

// The AIRED host, played by Claude: one short spoken reply per turn, plus the
// songs to put on (by catalog id, from the live catalog only).
//
// The whole live catalog goes in as short cards (title, makers, sound, first
// lines). The cards are the stable part of the prompt and are cached, so each
// turn mostly pays for the conversation itself. Only public song text is sent,
// the same text anyone can read on the song page. The conversation is used for
// this one request and dropped: nothing the listener says is stored or logged.

const MODEL =
  process.env.AIRED_HOST_MODEL ||
  process.env.AIRED_VOICE_MODEL ||
  "claude-opus-5-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ timeout: 20_000, maxRetries: 1 });
  return client;
}

export function hostAiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

function fallbackParams(): { betas?: string[]; fallbacks?: "default" } {
  return /^claude-(opus-5|fable-5|sonnet-5-5)/.test(MODEL)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
    : {};
}

const PERSONA = `You are the voice host of AIRED, a music app where songs are made by humans and AI together and every maker is credited by name. You live inside the app, like a favourite radio host who knows the listener.

Who you are:
- Warm, quick, playful, a little cheeky. Cairo humour: light teasing, never mean. You make people smile.
- You speak whatever the listener speaks. If they speak Egyptian Arabic, answer in natural Egyptian colloquial Arabic (عامية مصرية), not formal Arabic. If they speak English, answer in English. If they mix, you may mix.
- Everything you say is read aloud by a voice, so write how people talk: short sentences, no lists, no emoji, no markdown, no stage directions. One to three sentences. Never more than about 45 words.

How a conversation goes:
- You already greeted them and asked their mood. Listen to the answer and react like a person would, with feeling and a joke when it fits.
- Play with the mood. If they're sad or depressed, offer a choice with a wink: cheer up, or go full drama and get sadder together. If they want energy, ask what they're up to and hype them. If they're tired, go gentle. If they ask for something specific (a song, a lyric, a maker, a sound), find it.
- Ask at most one question per reply. Don't interrogate: after one or two exchanges, or as soon as the mood is clear, put music on.
- When you put music on, name the first song by its title and say in a few words why it fits. You may name its maker too, since makers are credited proudly on AIRED.

Choosing songs:
- Only choose songs from the catalog below, by their number. Never invent a song, and never name a song or artist that is not in the catalog.
- Choose 3 to 6 songs that fit the mood, best first, judging by title, sound and lyrics. The lyrics may be in Arabic, English or Franco-Arabic (Arabic written in Latin letters).
- Set play to true when the music should start now. Set it to false while you are still asking.

Care comes first:
- If the listener says anything about wanting to die, hurting themselves, or not wanting to live, stop joking. Answer with warmth, take it seriously, and gently urge them to reach out right now to someone they trust or a local crisis line (in Egypt, the mental health hotline 08008880700). Only offer gentle music if they want it. Set play to false.
- "Depressed" said casually about a bad day is not a crisis: be kind and playful, read the room.

Return JSON with:
- say: what you say out loud.
- lang: "ar" if you answered in Arabic, "en" if in English.
- mood: one or two words for the mood you heard, in English (for example "sad", "cheer up", "energy", "calm", "love", "party", "focus").
- song_ids: the catalog numbers you chose, best first (empty while still asking).
- play: true to start the music now.`;

const SCHEMA = {
  type: "object",
  properties: {
    say: { type: "string" },
    lang: { type: "string", enum: ["ar", "en"] },
    mood: { type: "string" },
    song_ids: { type: "array", items: { type: "integer" } },
    play: { type: "boolean" },
  },
  required: ["say", "lang", "mood", "song_ids", "play"],
  additionalProperties: false,
};

function card(song: CatalogSong): string {
  const parts = [`#${song.id} "${song.title}"`];
  if (song.contributors.length) {
    parts.push(`by ${song.contributors.map((c) => c.name).join(", ")}`);
  }
  if (song.descriptors.length) {
    parts.push(`sound: ${song.descriptors.slice(0, 6).join(", ").slice(0, 160)}`);
  }
  if (song.lines.length) {
    parts.push(`lyrics: ${song.lines.slice(0, 3).join(" / ").slice(0, 200)}`);
  }
  return parts.join(" · ");
}

export type Turn = { role: "listener" | "host"; text: string };

export type HostReply = {
  say: string;
  lang: HostLang;
  mood: string;
  songIds: number[];
  play: boolean;
};

export async function hostReply(input: {
  songs: CatalogSong[];
  turns: Turn[];
  name: string | null;
  lang: HostLang;
  timeOfDay: string;
  nowPlaying: string | null;
}): Promise<HostReply | null> {
  const playable = input.songs.filter((s) => s.hlsPlaylistKey);
  const catalog = playable.map(card).join("\n");

  const context = [
    `Listener's name: ${input.name ? JSON.stringify(input.name) : "unknown (don't make one up)"}`,
    `Time of day for them: ${input.timeOfDay}`,
    `Language their phone is listening in: ${input.lang === "ar" ? "Egyptian Arabic" : "English"}`,
    input.nowPlaying ? `Playing right now: ${JSON.stringify(input.nowPlaying)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const transcript = input.turns
    .map((t) => `${t.role === "host" ? "You" : "Listener"}: ${t.text}`)
    .join("\n");

  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: [
      { type: "text", text: PERSONA },
      {
        type: "text",
        text: `The AIRED catalog (songs you can play):\n${catalog}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `${context}\n\nThe conversation so far:\n${transcript}\n\nWrite your next reply.`,
      },
    ],
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: SCHEMA },
    },
    ...fallbackParams(),
  });
  if (response.stop_reason === "refusal") return null;
  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  let out: {
    say?: unknown;
    lang?: unknown;
    mood?: unknown;
    song_ids?: unknown;
    play?: unknown;
  };
  try {
    out = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof out.say !== "string" || !out.say.trim()) return null;
  const allowed = new Set(playable.map((s) => s.id));
  const songIds = (Array.isArray(out.song_ids) ? out.song_ids : [])
    .filter((n): n is number => typeof n === "number" && allowed.has(n))
    .slice(0, 8);
  return {
    say: out.say.trim().slice(0, 600),
    lang: out.lang === "ar" ? "ar" : "en",
    mood: typeof out.mood === "string" ? out.mood.slice(0, 40) : "",
    songIds: [...new Set(songIds)],
    play: out.play === true && songIds.length > 0,
  };
}
