// The reference-sanitizer (CLAUDE.md Rule 2, Phase 2 brief part 3).
//
// Runs at the input boundary, BEFORE any public write. It is a PURE function so
// the same logic powers the live preview in the editor (client) and the hard
// enforcement in the server action (server) — defense in depth: even if the
// client sends a raw name, the server only ever writes this module's sanitized
// output to public data.
//
// Hard guarantee: no third-party artist/song/band name reaches `work`,
// `public_volley`, `certification`, or any searchable column. The raw string is
// kept ONLY in the encrypted private volley.

import { descriptorDictionary } from "./descriptorDictionary";

export type SanitizeResult = {
  /** The original text, exactly as typed. Sealed into private craft ONLY. */
  raw: string;
  /** A known dictionary reference was matched and mapped to descriptors. */
  matched: boolean;
  /** A reference to an unknown proper noun (a name) — must not go public. */
  unknownReference: boolean;
  /** Safe text for public surfaces, or null when nothing may be written. */
  publicText: string | null;
  /** Sanitized descriptor tokens for the public, searchable descriptor set. */
  descriptors: string[];
  /** UI hint: ask the creator to describe the sound instead of naming it. */
  promptForDescriptors: boolean;
};

// Normalize for matching: lowercase, drop quotes, collapse whitespace.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[“”"'’`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitDescriptors(s: string): string[] {
  return s
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
}

// An explicit "make it sound like <something named>" framing.
const REFERENCE_PATTERN =
  /(?:sounds?\s+like|sound\s+like|in\s+the\s+style\s+of|styled?\s+after|reminiscent\s+of|reminds?\s+me\s+of|à\s+la|a\s+la|\blike\b)\s+(.+)$/i;

// Does the captured target contain a capitalized word (a likely name)?
// Unicode-aware so accented names ("Beyoncé", "Sigur Rós") are caught too.
function hasProperNoun(captured: string): boolean {
  const cleaned = captured.replace(/[“”"'’`.!?]/g, " ").trim();
  if (!cleaned) return false;
  return cleaned.split(/\s+/).some((w) => /^\p{Lu}[\p{L}\p{N}'’-]*$/u.test(w));
}

// A short Title-Case phrase with no descriptor list reads like a bare name
// ("Madonna", "Daft Punk", "The Beatles") rather than a genre ("80s new wave").
// Conservative on purpose: any lowercase word, a comma, or >4 words spares it,
// because creators type genres/descriptors in lowercase, comma-separated lists.
function looksLikeBareName(s: string): boolean {
  if (s.includes(",")) return false;
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  const alpha = words.filter((w) => /\p{L}/u.test(w));
  if (alpha.length === 0) return false;
  return alpha.every((w) => /^\p{Lu}/u.test(w));
}

export function sanitizeReference(input: string): SanitizeResult {
  const raw = input ?? "";
  const trimmed = raw.trim();

  if (!trimmed) {
    return {
      raw,
      matched: false,
      unknownReference: false,
      publicText: "",
      descriptors: [],
      promptForDescriptors: false,
    };
  }

  const norm = normalize(trimmed);

  // 1) Known reference → replace wholesale with its descriptors. The name is
  //    discarded from the public path entirely.
  for (const entry of descriptorDictionary) {
    if (entry.aliases.some((alias) => norm.includes(normalize(alias)))) {
      return {
        raw,
        matched: true,
        unknownReference: false,
        publicText: entry.descriptors,
        descriptors: splitDescriptors(entry.descriptors),
        promptForDescriptors: false,
      };
    }
  }

  // 2) An explicit "like <Name>" reference, or a bare Title-Case name → nothing
  //    may be written publicly; the raw stays sealed and the UI prompts.
  const m = trimmed.match(REFERENCE_PATTERN);
  if ((m && hasProperNoun(m[1])) || looksLikeBareName(trimmed)) {
    return {
      raw,
      matched: false,
      unknownReference: true,
      publicText: null,
      descriptors: [],
      promptForDescriptors: true,
    };
  }

  // 3) Plain genres / sonic descriptors → they belong to no one, pass through.
  return {
    raw,
    matched: false,
    unknownReference: false,
    publicText: trimmed,
    descriptors: splitDescriptors(trimmed),
    promptForDescriptors: false,
  };
}
