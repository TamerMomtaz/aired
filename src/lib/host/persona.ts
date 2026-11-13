// Kahotia, AIRED's host: its personality, and the version of it that works with
// no AI.
//
// Kahotia is AIRED's mascot and Tee's alter ego: half stitched burlap doll, half
// blue man, a warm, cheeky Cairo spirit who lives inside the app: it says
// good morning by name, asks how you feel, jokes about it, and puts on songs
// from the AIRED catalog that fit. With ANTHROPIC_API_KEY set, Claude plays the
// host (lib/host/brain.ts). Without it, this file plays a simpler host: it
// spots a mood in what you said, answers with a line written here, and picks
// songs by matching mood words against titles, lyrics and descriptors.

export type HostLang = "ar" | "en";

export type Mood =
  | "sad"
  | "happy"
  | "energy"
  | "calm"
  | "love"
  | "party"
  | "focus"
  | "cheer"
  | "drama";

// Words a listener might use for each mood, in English, Egyptian Arabic and
// Franco-Arabic. Order matters only for "cheer" and "drama", which answer the
// host's "cheer up, or go full drama?" question and are checked first.
const MOOD_WORDS: [Mood, RegExp][] = [
  [
    "cheer",
    /(cheer|lift me|make me (happy|smile|laugh)|happier|فرفش|فرّح|فرحني|ضحكني|عايز افرح|نفرفش|farfesh|far7ni)/i,
  ],
  [
    "drama",
    /(drama|more (sad|depress)|sadder|let me cry|wallow|نكد|نكّد|عايز اعيط|اعيط|دراما|zay ma ana|nakad|a3ayat)/i,
  ],
  [
    "sad",
    /(sad|depress|down\b|lonely|cry|blue\b|heartbro|bad day|حزين|زعلان|مكتئب|مخنوق|متضايق|مضايق|وحيد|مدايق|z3lan|ze3lan|mde2|mt2ayk|ka2eb)/i,
  ],
  [
    "energy",
    /(energ|enthusias|motivat|pump|workout|gym|run|hype|power|حماس|متحمس|نشاط|رياضة|جيم|طاقة|ه?مزاج عالي|7amas|gym)/i,
  ],
  [
    "party",
    /(party|danc|club|celebrat|birthday|wedding|حفلة|رقص|نرقص|فرح|عيد ميلاد|ra2s|7afla)/i,
  ],
  [
    "calm",
    /(calm|relax|chill|sleep|tired|rest|quiet|peace|هادي|هدوء|رايق|تعبان|نوم|انام|ارتاح|استرخ|rayek|ta3ban|hady)/i,
  ],
  [
    "love",
    /(love|romant|miss (him|her|you)|crush|heart|حب|بحب|رومانسي|وحشني|وحشتني|قلبي|7ob|ba7eb|wa7ashni)/i,
  ],
  [
    "focus",
    /(focus|work|study|concentrat|code|coding|think|شغل|مذاكرة|اذاكر|تركيز|اركز|بشتغل|sho3'l|shoghl|mozakra)/i,
  ],
  [
    "happy",
    /(happy|great|good|amazing|awesome|fine|joy|مبسوط|فرحان|حلو|تمام|زي الفل|الحمد لله|mabsoot|mabsout|tamam|fel)/i,
  ],
];

export function detectMood(text: string): Mood | null {
  for (const [mood, re] of MOOD_WORDS) if (re.test(text)) return mood;
  return null;
}

// Search words for each mood: what a fitting song's title, lyrics or sound
// descriptors might contain.
export const MOOD_TERMS: Record<Mood, string[]> = {
  sad: ["sad", "tears", "alone", "night", "rain", "حزن", "دموع", "ليل", "وحدي", "lonely", "cry", "dark", "melancholy"],
  drama: ["sad", "tears", "alone", "heart", "حزن", "دموع", "قلبي", "ليل", "cry", "dark", "melancholy", "ballad"],
  cheer: ["happy", "smile", "sun", "dance", "joy", "free", "شمس", "فرح", "ضحك", "uplifting", "funk", "disco", "pop", "triumphant"],
  happy: ["happy", "sun", "smile", "joy", "free", "شمس", "فرح", "uplifting", "funk", "disco", "pop", "power-pop"],
  energy: ["power", "fire", "run", "rise", "up", "قوة", "نار", "anthem", "rage", "rock", "arena", "808", "trap", "triumphant", "euphoric"],
  party: ["dance", "party", "night", "move", "رقص", "فرح", "عيد", "house", "disco", "club", "funk", "euphoric", "birthday"],
  calm: ["calm", "sea", "sleep", "peace", "slow", "بحر", "هدوء", "نوم", "acoustic", "folk", "deep", "hypnotic", "mantra", "dub"],
  love: ["love", "heart", "habibi", "حب", "قلبي", "حبيبي", "عيون", "romantic", "soul", "warm"],
  focus: ["mind", "code", "learn", "think", "deep", "hypnotic", "mantra", "techno", "progressive", "house", "trance"],
};

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

export function timeOfDay(hour: number): "morning" | "afternoon" | "evening" | "night" {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

// The first thing the host says. Built on the device, so it can be spoken the
// moment the listener taps (no network wait, and browsers only allow sound
// that starts from a tap).
export function greeting(name: string | null, lang: HostLang, hour: number): string {
  const t = timeOfDay(hour);
  const n = name?.trim();
  if (lang === "ar") {
    const hello = {
      morning: pick(["صباح الفل", "صباح الخير", "صباح الورد"]),
      afternoon: pick(["أهلاً", "يا أهلاً"]),
      evening: pick(["مساء الفل", "مساء الخير"]),
      night: pick(["سهرانين؟ أهلاً", "مساء الفل"]),
    }[t];
    const me = pick(["كاهوتيا معاك.", "أنا كاهوتيا.", "معاك كاهوتيا، نص قماش ونص أزرق."]);
    const ask = pick([
      "مودك إيه النهارده؟ نفسك تسمع إيه؟",
      "قولّي، مزاجك عامل إيه؟ أشغّلك إيه؟",
      "عامل إيه النهارده؟ فرحان، تعبان، ولا عايز تتحمّس؟",
    ]);
    return n ? `${hello} يا ${n}! ${me} ${ask}` : `${hello}! ${me} ${ask}`;
  }
  const hello = {
    morning: pick(["Good morning", "Morning"]),
    afternoon: pick(["Good afternoon", "Hey"]),
    evening: pick(["Good evening", "Evening"]),
    night: pick(["Hey, night owl", "Still up? Hey"]),
  }[t];
  const me = pick(["Kahotia here.", "It's Kahotia.", "Kahotia here, half burlap, half blue."]);
  const ask = pick([
    "What's your mood today? What would you like to hear?",
    "How are you feeling? Tell me and I'll pick the music.",
    "What's the vibe today: happy, tired, or ready to go?",
  ]);
  return n ? `${hello}, ${n}! ${me} ${ask}` : `${hello}! ${me} ${ask}`;
}

type Lines = { ask?: string[]; play: string[] };

// What the no-AI host says for each mood. "ask" lines expect another answer
// before any music; "play" lines go with the songs.
const LINES: Record<HostLang, Record<Mood, Lines>> = {
  en: {
    sad: {
      ask: [
        "Oh no, you're down? Okay, two options: we cheer up, or we go full drama and cry together. Your call.",
        "Sad today? I can fix that, or I can make it worse. Cheer up, or more drama?",
      ],
      play: ["Here's something for a heavy heart."],
    },
    cheer: {
      play: [
        "Cheering up it is! Shoulders up, here we go.",
        "Good choice. Prescription: these songs, loud, twice a day.",
      ],
    },
    drama: {
      play: [
        "Full drama, I respect that. Tissues ready? Here we go.",
        "Okay, we're going deep. Cry it out, I've got you.",
      ],
    },
    happy: {
      play: [
        "Love that! Let's keep the good mood rolling.",
        "Happy people deserve happy music. Here you go.",
      ],
    },
    energy: {
      play: [
        "Enthusiasm mode on! Tell me what you're up to while this plays.",
        "Let's go! Turn it up, this one's for moving.",
      ],
    },
    party: {
      play: ["Party time! Clear the floor.", "Somebody's celebrating! Here we go."],
    },
    calm: {
      play: [
        "Easy now. Something gentle for you.",
        "Breathe out. I'll keep it soft.",
      ],
    },
    love: {
      play: [
        "Ooh, love is in the air. Here's something for the heart.",
        "Somebody's in love! These are for you.",
      ],
    },
    focus: {
      play: [
        "Head down, I'll keep the music steady. Go get it done.",
        "Focus mode. No distractions, just a groove.",
      ],
    },
  },
  ar: {
    sad: {
      ask: [
        "يا خبر! زعلان؟ طب عندي اختيارين: نفرفش، ولا نكمّل نكد ونعيّط سوا؟ قول إنت.",
        "مضايق النهارده؟ أقدر أفرّحك، وأقدر أزوّدها عليك. نفرفش ولا دراما؟",
      ],
      play: ["خد دي، تطبطب على قلبك."],
    },
    cheer: {
      play: [
        "يبقى نفرفش! ارفع راسك، يلا بينا.",
        "اختيار حلو. الروشتة: الأغاني دي، بصوت عالي، مرتين في اليوم.",
      ],
    },
    drama: {
      play: [
        "دراما على الآخر، احترمتك. جهّز المناديل، يلا.",
        "خلاص، هننزل للعمق. عيّط براحتك، أنا معاك.",
      ],
    },
    happy: {
      play: ["الله! يبقى نكمّل المزاج الحلو.", "الناس المبسوطة تستاهل مزيكا حلوة. اتفضل."],
    },
    energy: {
      play: [
        "وضع الحماس اشتغل! قولّي ناوي على إيه وإنت بتسمع.",
        "يلا بينا! علّي الصوت، دي للحركة.",
      ],
    },
    party: {
      play: ["وقت الحفلة! وسّعوا المكان.", "في حد بيحتفل! يلا."],
    },
    calm: {
      play: ["بالراحة كده. حاجة هادية ليك.", "خد نفس. هخليها ناعمة."],
    },
    love: {
      play: ["أوه، في حب في الجو! خد دي للقلب.", "في حد بيحب! دول عشانك."],
    },
    focus: {
      play: ["ركّز وأنا هظبطلك المزيكا. يلا خلّص شغلك.", "وضع التركيز. مفيش دوشة، بس جروف."],
    },
  },
};

export function moodLine(mood: Mood, lang: HostLang, kind: "ask" | "play"): string | null {
  const set = LINES[lang][mood];
  const list = kind === "ask" ? set.ask : set.play;
  return list?.length ? pick(list) : null;
}

export function notSureLine(lang: HostLang): string {
  return lang === "ar"
    ? pick([
        "مش متأكد فهمتك. فرحان، زعلان، تعبان، ولا عايز تتحمّس؟",
        "قولّي بكلمة واحدة: مزاجك إيه؟ وأنا عليّا الباقي.",
      ])
    : pick([
        "I didn't quite catch the mood. Happy, sad, tired, or ready to go?",
        "Give me one word for your mood, and I'll do the rest.",
      ]);
}

// The words that mean "if the listener says this, keep it gentle": no jokes,
// care first. Used by both hosts.
export const CRISIS_WORDS =
  /(kill myself|end my life|suicid|want to die|hurt myself|self[- ]harm|انتحر|انتحار|عايز اموت|اموت نفسي|أموت نفسي|اأذي نفسي|أأذي نفسي|ma3adsh 3ayez a3eesh)/i;

export function crisisLine(lang: HostLang): string {
  return lang === "ar"
    ? "أنا سامعك، وده مهم. لو بتفكّر تأذي نفسك، كلّم حد بتثق فيه دلوقتي، أو خط المساعدة في بلدك. في مصر الأمانة العامة للصحة النفسية: 08008880700. أنا هنا، ولو حابب أشغّلك حاجة هادية قولّي."
    : "I hear you, and that matters. If you're thinking about hurting yourself, please reach out to someone you trust right now, or a crisis line where you are. I'm here, and if you'd like something gentle to listen to, just say so.";
}
