// TEEJAY SUGGESTS: one tap, one feeling, a whole set.
//
// The listener picks how they want to feel; TeeJay (the AIRED DJ, Tee's tag)
// reads the whole live catalog and picks the songs, the mood and the length.
// Each feeling names the moods TeeJay may choose from, so a feeling always
// lands on a real Mixer recipe (moods.ts), never an invented one.
//
// Shared by the server (which asks Claude) and the page (which shows the
// buttons), so it imports nothing.

export type FeelingId = "dance" | "romance" | "hype" | "wahda";

export type Feeling = {
  id: FeelingId;
  label: string;
  emoji: string;
  note: string; // what the button promises, in one line
  moods: string[]; // mood ids TeeJay may use; the first is the default
  minutes: 5 | 7 | 10;
  // What TeeJay is told this feeling means.
  brief: string;
  // Words in a song's sound descriptors that suit this feeling (rules fallback).
  words: string[];
};

export const FEELINGS: Feeling[] = [
  {
    id: "dance",
    label: "Dance",
    emoji: "💃",
    note: "House and club grooves with strong beats and the drops kept in.",
    moods: ["club", "deep-house", "afro-house", "disco-house", "soulful-house", "melodic-house", "tech-house", "oriental-house", "euro-chorus"],
    minutes: 7,
    brief:
      "Make people dance. Groove-led songs with a steady four-on-the-floor or a strong danceable pulse, catchy hooks, ideally 115 to 128 BPM. A set that keeps the floor moving from start to end.",
    words: ["dance", "house", "club", "groove", "disco", "funk", "four-on-the-floor", "beat", "bass", "upbeat", "electro", "edm", "pop"],
  },
  {
    id: "romance",
    label: "Romance",
    emoji: "🌹",
    note: "Slower and warm: long smooth blends, tender voices, oud and strings.",
    moods: ["lounge", "chiftetelli-slow", "oud-spotlight", "strings-lift", "organic-house", "baladi-deep", "deep-house"],
    minutes: 7,
    brief:
      "Romance. Love songs and tender, warm, intimate songs: soft voices, slower tempos, lush pads, oud, strings, piano. Nothing harsh or aggressive. The set should feel like a slow, glowing evening.",
    words: ["love", "romantic", "tender", "warm", "soft", "ballad", "slow", "intimate", "dreamy", "piano", "strings", "oud", "acoustic", "soul", "r&b", "lush"],
  },
  {
    id: "hype",
    label: "Hype",
    emoji: "🔥",
    note: "Peak energy: the fastest songs and the biggest drops, with brakes and spins.",
    moods: ["peak", "euro-rave", "maqsum-fire", "dabka-techno", "progressive-house", "tech-house"],
    minutes: 7,
    brief:
      "Pure enthusiasm and hype. The most energetic, anthemic, euphoric songs: big choruses, chants, drops, fast tempos. A set that lifts a crowd and keeps climbing.",
    words: ["energetic", "anthem", "euphoric", "hype", "fast", "drop", "chant", "rave", "trance", "rock", "powerful", "driving", "festival", "hard"],
  },
  {
    id: "wahda",
    label: "على واحدة ونص",
    emoji: "🥁",
    note: "A belly-dance party: the Mixer plays darbuka and tabla rhythms under the songs.",
    moods: ["baladi-bounce", "maqsum-fire", "saidi-stick", "drum-solo-show", "chiftetelli-slow", "oriental-house"],
    minutes: 7,
    brief:
      "على واحدة ونص: an Egyptian belly-dance party (raqs sharqi). The Mixer will play darbuka/tabla rhythms (baladi, maqsum, saidi) under the songs, so pick songs that dance on a hand-drum groove: Egyptian, Arabic, oriental, shaabi, sha'bi, mahraganat, Middle Eastern scales, joyful vocals, roughly 95 to 125 BPM. Songs with their own hand percussion or oriental melodies are best.",
    words: ["arabic", "egyptian", "oriental", "shaabi", "baladi", "belly", "darbuka", "tabla", "middle eastern", "maqam", "oud", "mahraganat", "cairo", "percussion"],
  },
];

export function feelingById(id: unknown): Feeling | null {
  return FEELINGS.find((f) => f.id === id) ?? null;
}

// How many songs TeeJay picks. The page listens to all of them and keeps the
// ones whose tempos can meet (at most MAX_KEEP).
export const SUGGEST_PICKS = 6;
export const MAX_KEEP = 5;
export const MIN_KEEP = 3;

export type Suggestion = {
  ids: number[]; // in the order TeeJay would play them
  mood: string;
  minutes: 5 | 7 | 10;
  why: string; // one line, TeeJay's voice
  title: string; // a name for the set
  by: "teejay" | "rules";
};
