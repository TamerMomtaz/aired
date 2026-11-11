import { NextResponse } from "next/server";

import { hostAiEnabled, hostReply, type Turn } from "@/lib/host/brain";
import {
  CRISIS_WORDS,
  MOOD_TERMS,
  crisisLine,
  detectMood,
  moodLine,
  notSureLine,
  timeOfDay,
  type HostLang,
  type Mood,
} from "@/lib/host/persona";
import { getVoiceCatalog, type CatalogSong } from "@/lib/voice/catalog";
import { queryTerms } from "@/lib/voice/normalize";
import { scoreCatalog } from "@/lib/voice/score";

// POST /api/host — one turn of the talking host.
//
// Body: { turns: [{ role: "listener" | "host", text }], name?, lang: "ar" | "en",
//         hour: 0-23 (the listener's local hour), nowPlaying?: string }
// Reply: { say, lang, mood, play, ai, songs: [{ id, title, … }] }
//
// With ANTHROPIC_API_KEY the host is Claude (lib/host/brain). Without it, or if
// that call fails, a simpler host answers from lib/host/persona. Nothing the
// listener says is stored or logged.

export const runtime = "nodejs";

const MAX_TURNS = 12;
const MAX_TEXT = 400;

// Light per-instance guard against a looping client running up AI cost. Not a
// security boundary (same honest caveat as /api/voice-search).
const WINDOW_MS = 60_000;
const LIMIT = 15;
const hitsByIp = new Map<string, { start: number; count: number }>();
function allow(ip: string): boolean {
  const now = Date.now();
  const w = hitsByIp.get(ip);
  if (!w || now - w.start > WINDOW_MS) {
    if (hitsByIp.size > 1000) hitsByIp.clear();
    hitsByIp.set(ip, { start: now, count: 1 });
    return true;
  }
  w.count++;
  return w.count <= LIMIT;
}

type Song = {
  id: number;
  title: string;
  artworkUrl: string | null;
  durationSeconds: number | null;
  hlsPlaylistKey: string | null;
  contributors: { name: string; profile_slug: string | null }[];
};

function toSong(s: CatalogSong): Song {
  return {
    id: s.id,
    title: s.title,
    artworkUrl: s.artworkUrl,
    durationSeconds: s.durationSeconds,
    hlsPlaylistKey: s.hlsPlaylistKey,
    contributors: s.contributors,
  };
}

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Songs for a mood with no AI: the best keyword matches for the mood's words,
// lightly shuffled so the same mood doesn't always start the same way, topped
// up with random songs when the catalog's words don't say much.
function songsForMood(songs: CatalogSong[], mood: Mood): CatalogSong[] {
  const playable = songs.filter((s) => s.hlsPlaylistKey);
  const hits = scoreCatalog(playable, MOOD_TERMS[mood], [], 10).map((h) => h.song);
  const picked = shuffle(hits.slice(0, 6)).slice(0, 5);
  const rest = shuffle(playable.filter((s) => !picked.includes(s)));
  return [...picked, ...rest].slice(0, 5);
}

function parseTurns(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (t): t is { role: string; text: string } =>
        !!t &&
        typeof t === "object" &&
        typeof (t as { text?: unknown }).text === "string" &&
        ((t as { role?: unknown }).role === "listener" ||
          (t as { role?: unknown }).role === "host"),
    )
    .map((t) => ({
      role: t.role as Turn["role"],
      text: t.text.trim().slice(0, MAX_TEXT),
    }))
    .filter((t) => t.text)
    .slice(-MAX_TURNS);
}

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allow(ip)) {
    return NextResponse.json(
      { error: "Too many messages in a minute. Give me a second." },
      { status: 429 },
    );
  }

  let body: {
    turns?: unknown;
    name?: unknown;
    lang?: unknown;
    hour?: unknown;
    nowPlaying?: unknown;
  } = {};
  try {
    body = await request.json();
  } catch {
    // fall through to validation
  }
  const turns = parseTurns(body.turns);
  const last = [...turns].reverse().find((t) => t.role === "listener");
  if (!last) {
    return NextResponse.json({ error: "Say something first." }, { status: 400 });
  }
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 40)
      : null;
  const hour =
    typeof body.hour === "number" && body.hour >= 0 && body.hour < 24
      ? Math.floor(body.hour)
      : (new Date().getUTCHours() + 2) % 24; // Cairo, as a fallback
  const nowPlaying =
    typeof body.nowPlaying === "string" ? body.nowPlaying.slice(0, 120) : null;
  // Answer in the language they spoke: Arabic script means Arabic, otherwise
  // the phone's listening language decides.
  const lang: HostLang = /[؀-ۿ]/.test(last.text)
    ? "ar"
    : body.lang === "ar"
      ? "ar"
      : "en";

  // Care first, with or without AI.
  if (CRISIS_WORDS.test(last.text)) {
    return NextResponse.json({
      say: crisisLine(lang),
      lang,
      mood: "care",
      play: false,
      ai: false,
      songs: [],
    });
  }

  let songs: CatalogSong[];
  try {
    songs = await getVoiceCatalog();
  } catch {
    return NextResponse.json(
      { error: "I can't reach the catalog right now." },
      { status: 503 },
    );
  }
  const byId = new Map(songs.map((s) => [s.id, s]));

  if (hostAiEnabled()) {
    try {
      const reply = await hostReply({
        songs,
        turns,
        name,
        lang,
        timeOfDay: timeOfDay(hour),
        nowPlaying,
      });
      if (reply) {
        return NextResponse.json({
          say: reply.say,
          lang: reply.lang,
          mood: reply.mood,
          play: reply.play,
          ai: true,
          songs: reply.songIds.map((id) => toSong(byId.get(id)!)),
        });
      }
    } catch {
      // fall through to the simpler host
    }
  }

  // The simpler host.
  const mood = detectMood(last.text);
  const prevHost = [...turns].reverse().find((t) => t.role === "host")?.text ?? "";
  const listenerTurns = turns.filter((t) => t.role === "listener").length;

  if (mood === "sad" && !/(نفرفش|drama|دراما|cheer up)/i.test(prevHost)) {
    return NextResponse.json({
      say: moodLine("sad", lang, "ask"),
      lang,
      mood,
      play: false,
      ai: false,
      songs: [],
    });
  }

  if (mood) {
    const picks = songsForMood(songs, mood);
    const line = moodLine(mood, lang, "play") ?? "";
    const first = picks[0];
    const intro = first
      ? lang === "ar"
        ? ` نبدأ بـ "${first.title}".`
        : ` Starting with "${first.title}".`
      : "";
    return NextResponse.json({
      say: line + intro,
      lang,
      mood,
      play: picks.length > 0,
      ai: false,
      songs: picks.map(toSong),
    });
  }

  // No mood: maybe they named a song or a lyric.
  const hits = scoreCatalog(
    songs.filter((s) => s.hlsPlaylistKey),
    queryTerms(last.text),
    [last.text],
    5,
  );
  if (hits.length > 0 && hits[0].score >= 2) {
    const first = hits[0].song;
    return NextResponse.json({
      say:
        lang === "ar"
          ? `لقيتها! "${first.title}". اتفضل.`
          : `Found it! "${first.title}". Here you go.`,
      lang,
      mood: "request",
      play: true,
      ai: false,
      songs: hits.map((h) => toSong(h.song)),
    });
  }

  // Still not sure after a couple of tries: surprise them.
  if (listenerTurns >= 2) {
    const picks = shuffle(songs.filter((s) => s.hlsPlaylistKey)).slice(0, 5);
    return NextResponse.json({
      say:
        lang === "ar"
          ? `طب سيبهالي! هفاجئك، نبدأ بـ "${picks[0]?.title ?? ""}".`
          : `Leave it to me then! A surprise, starting with "${picks[0]?.title ?? ""}".`,
      lang,
      mood: "surprise",
      play: picks.length > 0,
      ai: false,
      songs: picks.map(toSong),
    });
  }

  return NextResponse.json({
    say: notSureLine(lang),
    lang,
    mood: "",
    play: false,
    ai: false,
    songs: [],
  });
}
