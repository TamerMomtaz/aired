// Text folding for "find the song where…" — shared by the catalog index and the
// query, so both sides of a comparison are folded the same way.
//
// Speech-to-text and people both spell Arabic loosely: hamza seats come and go,
// ta marbuta is heard as ha, alef maqsura as ya, and diacritics are rare. English
// is easier, but case and punctuation still differ. Folding both sides to one
// plain form makes "أنا" match "انا" and "Ruru!" match "ruru".

const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;

export function foldText(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, "")
    .replace(TATWEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    // Anything that is not a letter or digit (any script) becomes a space.
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Words too common to say anything about which song is meant. Folded forms.
const STOPWORDS = new Set([
  // English
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for", "with",
  "is", "it", "its", "that", "this", "where", "which", "song", "track", "play",
  "listen", "want", "i", "me", "my", "you", "please", "there", "about", "one",
  "put", "find", "some", "can", "could", "would", "like", "says", "say", "goes",
  // Egyptian / MSA Arabic (folded)
  "في", "من", "علي", "الي", "عن", "و", "يا", "ده", "دي", "اللي", "الي", "انا",
  "عايز", "عاوز", "عايزه", "شغل", "شغلي", "شغللي", "اسمع", "اغنيه", "الاغنيه",
  "اللي", "فيها", "بتقول", "بيقول", "هي", "هو", "ممكن", "لو", "سمحت", "بتاعه",
  "حط", "دور", "ال",
]);

export function queryTerms(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of foldText(input).split(" ")) {
    if (!word || STOPWORDS.has(word)) continue;
    // One-letter words carry no signal (except digits, which can be a catalog id).
    if (word.length < 2 && !/\d/.test(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}

// CROSS-SCRIPT MATCHING. AIRED lyrics are often Egyptian Arabic written in Latin
// letters ("ehna el farafeesh", "kedda", "aywa"), while an Arabic speech
// recognizer writes Arabic script ("احنا الفرافيش"). To let those meet without
// any AI, both sides are reduced to a consonant skeleton: "farafeesh" and
// "فرافيش" both become "frfS". Vowels, and the letters that are usually
// written as vowels (ا و ي ء ع), are dropped; Franco digits map to their letters.

const ARABIC_TO_LATIN: Record<string, string> = {
  ب: "b", ت: "t", ث: "t", ج: "g", ح: "h", خ: "K", د: "d", ذ: "z", ر: "r",
  ز: "z", س: "s", ش: "S", ص: "s", ض: "d", ط: "t", ظ: "z", غ: "G", ف: "f",
  ق: "k", ك: "k", ل: "l", م: "m", ن: "n", ه: "h", ة: "h", پ: "b", گ: "g",
  چ: "S", ڤ: "f",
};

export function isArabicScript(word: string): boolean {
  return /[\u0600-\u06FF]/.test(word);
}

export function consonantSkeleton(word: string): string {
  let out = "";
  if (isArabicScript(word)) {
    for (const ch of word) out += ARABIC_TO_LATIN[ch] ?? "";
  } else {
    out = word
      .toLowerCase()
      .replace(/sh|ch/g, "S")
      .replace(/kh|5/g, "K")
      .replace(/gh|8/g, "G")
      .replace(/th/g, "t")
      .replace(/dh/g, "d")
      .replace(/7/g, "h")
      .replace(/6/g, "t")
      .replace(/9/g, "s")
      .replace(/[qc]/g, "k")
      .replace(/j/g, "g")
      .replace(/v/g, "f")
      .replace(/p/g, "b")
      .replace(/x/g, "ks")
      .replace(/[aeiouywı23'`\d]/g, "")
      .replace(/[^a-zA-Z]/g, "");
  }
  // Collapse doubled letters and a soft final h ("kedda"/"كده" both → "kd").
  return out.replace(/(.)\1+/g, "$1").replace(/h$/, "");
}
