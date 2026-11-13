// MOODS: the character of a set. Each mood is a recipe the Mixer lays over
// whatever songs the listener picked: an energy (how the set is built: part
// length, moves, drops), a tempo window it leans toward, a groove the Mixer
// plays itself (a darbuka, a dabke tabl, a house kit, hand percussion), a tone,
// and sometimes a signature moment (a darbuka solo before the drop, a taqsim
// breakdown, a chorus that keeps coming back).
//
// The grooves are synthesized here, not sampled from anyone: the catalog has
// no songs tagged belly dance, dabka, oud or violin, so a mood can't be a list
// of songs. It is a way of playing any of them.
//
// Groove notation, one character per sixteenth note (16 per bar; a pattern can
// run several bars):
//   D doum (low, centre of the drum)   T tek (high, the rim)   k ka (soft rim)
//   c conga high   C conga low   s shaker   . rest
// The Middle Eastern patterns follow the common doum/tek charts (maqsum,
// baladi, saidi, malfuf, chiftetelli, nawari for dabke).

import type { Energy, LayerStyle } from "./script";

export type MoodFamily = "classic" | "belly" | "dabka" | "oud" | "violin" | "euro" | "house" | "fusion";

export type Groove = {
  // The drum the hits are tuned like: a darbuka, or the deeper dabke tabl.
  drum: "darbuka" | "tabl" | "hand";
  steps: string; // 16 per bar, any number of bars
  fill?: string; // one bar, played on the last bar of every 8
  level: number; // 0–1
};

export type Kit = {
  kick: "four" | "soft" | "none"; // what "kick" means in this mood
  hats: "off" | "open" | "sixteenths" | "none";
  claps: boolean; // claps on 2 and 4 where the plan asks for them
  shaker: boolean; // quiet sixteenth shaker under the groove
};

export type Mood = {
  id: string;
  family: MoodFamily;
  label: string;
  note: string; // shown under the picker
  energy: Energy; // how the set is built
  bpm?: [number, number]; // the tempo window the set leans toward
  groove?: Groove;
  // Where the groove plays: wherever the plan has drums ("drums"), all the
  // way through except breakdowns ("always"), or only in breakdowns ("breaks").
  grooveIn?: "drums" | "always" | "breaks";
  kit: Kit;
  tone?: { low: number; mid: number; high: number }; // dB tilt on the master
  layerBias?: LayerStyle[]; // overrides the energy's kind of lines
  // drumSolo: the loop build before a drop becomes a darbuka solo
  // taqsim: breakdowns leave the melody alone, thrown into a long echo
  // hookReturn: the set's strongest hook comes back every other part
  signature?: "drumSolo" | "taqsim" | "hookReturn";
  brain: string; // what the DJ brain is told about the mood
};

const KIT_HOUSE: Kit = { kick: "four", hats: "off", claps: true, shaker: false };
const KIT_HANDS: Kit = { kick: "none", hats: "none", claps: false, shaker: false };

// Doum/tek patterns, one bar of sixteenths each.
const MAQSUM = "D.T...T.D...T...";
const MAQSUM_FILL = "D.TkTkD.TkTkTkTk";
const BALADI = "D.D...T.D...T...";
const SAIDI = "D.T...D.D...T...";
const MALFUF = "D..T..T.D..T..T.";
const NAWARI = "T.D...T.D...T...";
const NAWARI_FILL = "T.D.T.D.TkTkD.D.";
const CHIFTETELLI = "D.....T...T.....D...D...T.......";
const AFRO = "C..c..c...c.c...";

export const MOODS: Mood[] = [
  // ---- the classics -------------------------------------------------------
  {
    id: "lounge",
    family: "classic",
    label: "Lounge",
    note: "A touch slower and warm. Long parts melting over 8-bar blends, lines from one song floating over another in echo. No extra drums.",
    energy: "lounge",
    kit: KIT_HOUSE,
    brain: "The classic Lounge set.",
  },
  {
    id: "club",
    family: "classic",
    label: "Club",
    note: "The opener's tempo. 16-bar parts, songs trading bars in call and response, a breakdown and a loop build into the drop.",
    energy: "club",
    kit: KIT_HOUSE,
    brain: "The classic Club set.",
  },
  {
    id: "peak",
    family: "classic",
    label: "Peak",
    note: "Pushed faster and harder: 8-bar parts traded bar by bar, chopped hooks, loop builds and drops.",
    energy: "peak",
    kit: KIT_HOUSE,
    brain: "The classic Peak set.",
  },

  // ---- belly-dance party ----------------------------------------------------
  {
    id: "baladi-bounce",
    family: "belly",
    label: "Baladi Bounce",
    note: "A darbuka playing baladi (doum-doum, tek, doum, tek) under the songs: earthy, made for hip drops. Voices up front.",
    energy: "club",
    bpm: [100, 114],
    groove: { drum: "darbuka", steps: BALADI, fill: MAQSUM_FILL, level: 1 },
    grooveIn: "always",
    kit: KIT_HANDS,
    brain:
      "A belly-dance party on a baladi darbuka groove (the Mixer plays it). Warm and earthy; favour vocal phrases, mashups of one song's voice over another's groove, and lifted lines. Few drops; let the groove carry.",
  },
  {
    id: "maqsum-fire",
    family: "belly",
    label: "Maqsum Fire",
    note: "Fast maqsum on the darbuka with rolling fills at the end of every phrase, a soft kick under it, short parts traded hard.",
    energy: "peak",
    bpm: [112, 126],
    groove: { drum: "darbuka", steps: MAQSUM, fill: MAQSUM_FILL, level: 1 },
    grooveIn: "always",
    kit: { kick: "soft", hats: "none", claps: true, shaker: false },
    brain:
      "A fiery belly-dance set on a fast maqsum darbuka (the Mixer plays it, with fills at phrase ends). Short parts, trades, chopped hooks, a loop build and drop every 32 bars.",
  },
  {
    id: "saidi-stick",
    family: "belly",
    label: "Saidi Stick",
    note: "The heavy saidi rhythm (doum-tek, doum-doum, tek): strong and proud, with short vocal chops answering the drum.",
    energy: "club",
    bpm: [100, 112],
    groove: { drum: "darbuka", steps: SAIDI, fill: MAQSUM_FILL, level: 1 },
    grooveIn: "always",
    kit: KIT_HANDS,
    layerBias: ["chop", "lift"],
    brain:
      "A belly-dance set on the heavy saidi rhythm (the Mixer plays it). Chopped vocal lines answer the drum; trades and mashups; a breakdown before the drop.",
  },
  {
    id: "drum-solo-show",
    family: "belly",
    label: "Drum Solo Show",
    note: "The show moment: before each drop the music falls away for a darbuka solo that speeds into a roll, then everything slams back on the one.",
    energy: "club",
    bpm: [104, 120],
    groove: { drum: "darbuka", steps: MAQSUM, fill: MAQSUM_FILL, level: 1 },
    grooveIn: "always",
    kit: KIT_HANDS,
    signature: "drumSolo",
    brain:
      "A belly-dance show. Every loop_build you place becomes a darbuka solo (the music drops out, the drum speeds into a roll) and the next part lands with everything on the one, so place two or three loop builds, each followed by a strong part with a drop.",
  },
  {
    id: "chiftetelli-slow",
    family: "belly",
    label: "Chiftetelli Slow",
    note: "Slow and heavy chiftetelli under long, melting parts: voices and melody floating in echo, like a taqsim before the dance.",
    energy: "lounge",
    groove: { drum: "darbuka", steps: CHIFTETELLI, level: 0.7 },
    grooveIn: "always",
    kit: KIT_HANDS,
    signature: "taqsim",
    brain: "A slow, sensual belly-dance opening on a chiftetelli darbuka. Long parts, long blends, lines in echo, no added drums.",
  },

  // ---- dabka ---------------------------------------------------------------
  {
    id: "nawari-stomp",
    family: "dabka",
    label: "Nawari Stomp",
    note: "The dabke tabl (tek-doum, tek-doum, tek) as the floor: the stomp is the kick, and the basslines swap on the doum.",
    energy: "club",
    groove: { drum: "tabl", steps: NAWARI, fill: NAWARI_FILL, level: 1 },
    grooveIn: "always",
    kit: KIT_HANDS,
    brain:
      "A dabka line-dance set on the nawari tabl groove (the Mixer plays it). Persistent downbeats; long runs of each song so the line can dance; blends and mashups; hooks repeated like a chant.",
  },
  {
    id: "wedding-dabka",
    family: "dabka",
    label: "Wedding Dabka",
    note: "Tabl plus claps on the off-beats and the biggest hook repeated like a crowd chant. Loud and joyful.",
    energy: "peak",
    groove: { drum: "tabl", steps: NAWARI, fill: NAWARI_FILL, level: 1 },
    grooveIn: "always",
    kit: { kick: "none", hats: "none", claps: true, shaker: false },
    signature: "hookReturn",
    brain:
      "A wedding dabka: tabl groove and claps (the Mixer plays them), the set's biggest hook chanted again and again over the other songs, high energy all the way, drops after loop builds.",
  },
  {
    id: "dabka-techno",
    family: "dabka",
    label: "Dabka Techno",
    note: "A four-on-the-floor kick under the dabke tabl, pushed toward 124–130 BPM: the village square meets the warehouse.",
    energy: "peak",
    bpm: [124, 130],
    groove: { drum: "tabl", steps: NAWARI, fill: NAWARI_FILL, level: 0.9 },
    grooveIn: "drums",
    kit: { kick: "four", hats: "sixteenths", claps: false, shaker: false },
    brain: "Dabka techno: four-on-the-floor kick under a dabke tabl (the Mixer plays both). Driving, hypnotic, loop builds and drops.",
  },
  {
    id: "malfuf-run",
    family: "dabka",
    label: "Malfuf Run",
    note: "The quick malfuf (doum . . tek . . tek) in short 8-bar parts: an entrance rhythm that never lets the floor rest.",
    energy: "peak",
    groove: { drum: "darbuka", steps: MALFUF, fill: MAQSUM_FILL, level: 0.95 },
    grooveIn: "always",
    kit: KIT_HANDS,
    brain: "A fast malfuf run (the Mixer plays the darbuka): short parts, quick trades and cuts, chopped hooks.",
  },

  // ---- oud electro -----------------------------------------------------------
  {
    id: "oud-spotlight",
    family: "oud",
    label: "Oud Spotlight",
    note: "The songs' melody (strings, guitars, plucked lines) brought forward over a light maqsum and a soft kick.",
    energy: "club",
    groove: { drum: "darbuka", steps: MAQSUM, level: 0.6 },
    grooveIn: "drums",
    kit: { kick: "soft", hats: "none", claps: false, shaker: true },
    tone: { low: -1, mid: 2.5, high: 0.5 },
    brain:
      "An oud-electro set: put the songs' melodic, instrumental phrases (low vocal score, high energy) up front; mashups where one song's melody plays over another's groove; a light maqsum darbuka under it (the Mixer plays it).",
  },
  {
    id: "taqsim-breakdown",
    family: "oud",
    label: "Taqsim Breakdown",
    note: "Electronic on top, and in every breakdown the beat stops and the melody plays alone into a long echo, like an oud taqsim, before the groove returns.",
    energy: "club",
    groove: { drum: "darbuka", steps: MAQSUM, fill: MAQSUM_FILL, level: 0.7 },
    grooveIn: "drums",
    kit: { kick: "four", hats: "off", claps: false, shaker: false },
    tone: { low: 0, mid: 1.5, high: 0 },
    signature: "taqsim",
    brain:
      "Oud electro with taqsim breakdowns: place two breakdowns on melodic phrases (the Mixer strips the beat and throws the melody into a long echo), each followed by a loop build and a drop.",
  },

  // ---- electronic violin ---------------------------------------------------
  {
    id: "strings-lift",
    family: "violin",
    label: "Strings Lift",
    note: "House drums with the top end opened up so strings and leads soar, and long filter rises carrying every build.",
    energy: "club",
    bpm: [120, 128],
    kit: KIT_HOUSE,
    tone: { low: 0, mid: 0.5, high: 2.5 },
    brain:
      "An electronic-violin feel: favour the songs' brightest melodic phrases, long 16-bar parts, filter_rise and riser before every drop, lines lifted rather than chopped.",
  },

  // ---- eurodance -------------------------------------------------------------
  {
    id: "euro-rave",
    family: "euro",
    label: "Euro 90s Rave",
    note: "Four-on-the-floor, open off-beat hats, pumping, pushed fast. The chorus hook comes back every other part; verse lines chopped short.",
    energy: "peak",
    bpm: [126, 140],
    kit: { kick: "four", hats: "open", claps: true, shaker: false },
    tone: { low: 1, mid: 0, high: 1 },
    signature: "hookReturn",
    brain:
      "A 90s eurodance set: relentless four-on-the-floor, the biggest sung chorus as the hook coming back every other part, short chopped verse lines between, loop builds and drops, nothing quiet for long.",
  },
  {
    id: "euro-chorus",
    family: "euro",
    label: "Euro Chorus Party",
    note: "The same eurodance drive, lighter: every song's biggest vocal phrase becomes a returning chorus over the others.",
    energy: "club",
    bpm: [122, 134],
    kit: { kick: "four", hats: "open", claps: true, shaker: false },
    signature: "hookReturn",
    brain:
      "A eurodance chorus party: each song's highest-vocal phrase becomes a hook lifted over the other songs; mashups and trades; a big drop.",
  },

  // ---- house, all kinds ----------------------------------------------------
  {
    id: "deep-house",
    family: "house",
    label: "Deep House",
    note: "118–125 BPM, a soft round kick and off-beat hats, a warm top, long blends and vocals chopped into echo.",
    energy: "club",
    bpm: [118, 125],
    kit: { kick: "soft", hats: "off", claps: false, shaker: true },
    tone: { low: 1.5, mid: 0, high: -2 },
    layerBias: ["echo", "chop", "lift"],
    brain: "Deep house: warm, hypnotic, long blends, vocal lines chopped and echoed, bass swaps, one patient build.",
  },
  {
    id: "dub-deep",
    family: "house",
    label: "Dub Deep",
    note: "Darker deep house: lines thrown into long echoes, the melody filtered low, space between the hits.",
    energy: "club",
    bpm: [118, 122],
    kit: { kick: "soft", hats: "off", claps: false, shaker: false },
    tone: { low: 2, mid: -1, high: -3 },
    layerBias: ["echo"],
    signature: "taqsim",
    brain: "Dub deep house: stripped parts, breakdowns, every line thrown into echo, long spaces, no chops.",
  },
  {
    id: "afro-house",
    family: "house",
    label: "Afro House",
    note: "A house kick with congas and a shaker rolling three against two, vocal chants floating over other songs' grooves.",
    energy: "club",
    bpm: [118, 126],
    groove: { drum: "hand", steps: AFRO, level: 0.8 },
    grooveIn: "drums",
    kit: { kick: "four", hats: "none", claps: false, shaker: true },
    brain: "Afro house: percussive and rolling (the Mixer adds congas and shaker), vocal chants lifted over other songs, long mashups.",
  },
  {
    id: "tech-house",
    family: "house",
    label: "Tech House",
    note: "122–130 BPM, a tight kick and rolling sixteenth hats, rolling bass swaps, vocals cut to short chops.",
    energy: "peak",
    bpm: [122, 130],
    kit: { kick: "four", hats: "sixteenths", claps: true, shaker: false },
    layerBias: ["chop"],
    brain: "Tech house: groove first, short vocal chops only, rolling bass swaps, loop builds.",
  },
  {
    id: "melodic-house",
    family: "house",
    label: "Melodic House",
    note: "A soft kick under the songs' melodies, brought forward, with long builds that open slowly.",
    energy: "club",
    bpm: [118, 126],
    kit: { kick: "soft", hats: "off", claps: false, shaker: false },
    tone: { low: 0, mid: 1.5, high: 0.5 },
    brain: "Melodic house: the songs' melodic phrases up front, long builds with filter_rise and riser, emotional drops.",
  },
  {
    id: "progressive-house",
    family: "house",
    label: "Progressive House",
    note: "A driving kick and 32-bar arcs: everything rises slowly, filters open, then one big drop.",
    energy: "club",
    bpm: [122, 130],
    kit: KIT_HOUSE,
    brain: "Progressive house: long arcs, 16- and 32-bar parts, filter_rise on builds, one big earned drop.",
  },
  {
    id: "soulful-house",
    family: "house",
    label: "Soulful House",
    note: "Claps on 2 and 4, voices always up front, the gospel lift: the songs sing to each other.",
    energy: "club",
    bpm: [118, 125],
    kit: KIT_HOUSE,
    layerBias: ["lift", "echo"],
    signature: "hookReturn",
    brain: "Soulful house: vocals up front all the way, voices answering each other across songs, claps on 2 and 4, a joyful lift.",
  },
  {
    id: "disco-house",
    family: "house",
    label: "Disco House",
    note: "Open off-beat hats and filter sweeps, basslines swapping on the one, hooks chopped and looped.",
    energy: "club",
    bpm: [112, 126],
    kit: { kick: "four", hats: "open", claps: true, shaker: false },
    brain: "Disco house: filter sweeps, bass swaps, chopped looped hooks, a funky bounce.",
  },
  {
    id: "organic-house",
    family: "house",
    label: "Organic House",
    note: "Slower and earthy: a soft kick, hand percussion and shaker, no claps, the melody forward.",
    energy: "club",
    bpm: [110, 122],
    groove: { drum: "hand", steps: AFRO, level: 0.6 },
    grooveIn: "drums",
    kit: { kick: "soft", hats: "none", claps: false, shaker: true },
    tone: { low: 0.5, mid: 1, high: -1 },
    brain: "Organic house: earthy, unhurried, hand percussion (the Mixer adds it), melodic phrases forward, long blends.",
  },

  // ---- AIRED fusions -------------------------------------------------------
  {
    id: "oriental-house",
    family: "fusion",
    label: "Oriental House",
    note: "A house kick and hats with a maqsum darbuka riding on top: the Cairo-to-club crossover.",
    energy: "club",
    bpm: [118, 125],
    groove: { drum: "darbuka", steps: MAQSUM, fill: MAQSUM_FILL, level: 0.85 },
    grooveIn: "drums",
    kit: { kick: "four", hats: "off", claps: false, shaker: false },
    brain: "Oriental house: house kick and hats with a maqsum darbuka on top (the Mixer plays them). Mashups, trades, a breakdown, a loop build and drop.",
  },
  {
    id: "baladi-deep",
    family: "fusion",
    label: "Baladi Deep",
    note: "Deep house all the way, and in every breakdown a baladi darbuka steps in alone.",
    energy: "club",
    bpm: [118, 124],
    groove: { drum: "darbuka", steps: BALADI, fill: MAQSUM_FILL, level: 0.9 },
    grooveIn: "breaks",
    kit: { kick: "soft", hats: "off", claps: false, shaker: true },
    tone: { low: 1.5, mid: 0, high: -1.5 },
    brain: "Deep house with baladi breakdowns: place two breakdowns (the Mixer plays a baladi darbuka in them), long blends, echoed lines.",
  },
  {
    id: "dabka-disco",
    family: "fusion",
    label: "Dabka Disco",
    note: "The dabke tabl over disco hats and a house kick, basslines swapping on the doum.",
    energy: "club",
    bpm: [112, 124],
    groove: { drum: "tabl", steps: NAWARI, fill: NAWARI_FILL, level: 0.85 },
    grooveIn: "drums",
    kit: { kick: "four", hats: "open", claps: false, shaker: false },
    brain: "Dabka disco: tabl over disco hats and kick (the Mixer plays them), bass swaps, chopped hooks, a joyful drop.",
  },
];

export const FAMILIES: { value: MoodFamily; label: string }[] = [
  { value: "classic", label: "Classic" },
  { value: "belly", label: "Belly-dance" },
  { value: "dabka", label: "Dabka" },
  { value: "oud", label: "Oud electro" },
  { value: "violin", label: "Electronic violin" },
  { value: "euro", label: "Eurodance" },
  { value: "house", label: "House" },
  { value: "fusion", label: "AIRED fusions" },
];

const BY_ID = new Map(MOODS.map((m) => [m.id, m]));

export function moodById(id: unknown): Mood {
  return (typeof id === "string" && BY_ID.get(id)) || BY_ID.get("club")!;
}

// The classic mood for an energy, for callers that only know the energy.
export function classicMood(energy: Energy): Mood {
  return BY_ID.get(energy)!;
}
