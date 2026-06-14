// Reference dictionary for the sanitizer (Phase 2, brief part 3).
//
// Maps a KNOWN third-party artist / song / band reference to neutral sonic
// descriptors that belong to no one. This is how AIRED "forgets the whisper and
// remembers the maker": the name is discarded from every public path and only
// descriptors travel onward.
//
// EXTENSIBLE BY DESIGN: add entries below. Each `aliases` string is matched
// case-insensitively against the normalized input. This seed is intentionally
// small — it is NOT full NER — but the public-write guarantee in
// `sanitizeReference` does not depend on the dictionary being complete.

export type DescriptorEntry = {
  /** Lowercase aliases that all map to the same descriptors. */
  aliases: string[];
  /** Comma-separated neutral descriptors written to public data instead. */
  descriptors: string;
};

export const descriptorDictionary: DescriptorEntry[] = [
  {
    aliases: ["rock me amadeus", "amadeus", "falco"],
    descriptors:
      "80s new wave, gated-reverb drums, brass-synth stabs, deadpan spoken-rap verses, anthemic chant chorus",
  },
];
