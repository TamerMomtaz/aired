// The browser's own speech-to-text (Web Speech API), shared by Ask AIRED and
// the AIRED host. Chrome on Android and Safari on iPhone have it; it hears one
// language at a time. These typings are minimal because the API is not in
// TypeScript's DOM lib.

export type SpeechAlt = { transcript: string };
export type SpeechResultList = ArrayLike<
  ArrayLike<SpeechAlt> & { isFinal: boolean }
>;
export type Recognizer = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult:
    | ((e: { resultIndex: number; results: SpeechResultList }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
export type RecognizerCtor = new () => Recognizer;

export function getRecognizerCtor(): RecognizerCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognizerCtor;
    webkitSpeechRecognition?: RecognizerCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// The one language setting both voice features share, remembered per device.
export type Lang = "ar-EG" | "en-US";
export const LANG_KEY = "aired.voice.lang";

export function initialLang(): Lang {
  if (typeof window === "undefined") return "ar-EG";
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "ar-EG" || saved === "en-US") return saved;
  } catch {
    // storage blocked: fall through
  }
  return navigator.language.toLowerCase().startsWith("ar") ? "ar-EG" : "en-US";
}

export function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // ignore
  }
}
