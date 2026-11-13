"use client";

// The host's speaking voice.
//
// Two voices, best first:
//   1. A natural human voice from /api/host/voice (ElevenLabs), when the
//      server has a key for it.
//   2. The phone's own speech voice (speechSynthesis), picking the most natural
//      one the phone has for the language (Siri, Google, "Enhanced",
//      "Natural" voices before the robotic defaults).
//
// Phones only let a page make sound that starts from a tap, so unlock() must be
// called inside the tap that opens the host. After that the same audio element
// can keep speaking for the rest of the conversation.

const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export type VoiceLang = "ar" | "en";

// Told how far into the text the voice has got (in characters), so the words
// on screen and Kahotia's mouth can keep pace with what is heard.
export type OnProgress = (chars: number) => void;

function scoreVoice(v: SpeechSynthesisVoice, lang: VoiceLang): number {
  const l = v.lang.toLowerCase();
  if (!l.startsWith(lang)) return -1;
  let s = 0;
  if (lang === "ar" && l === "ar-eg") s += 3;
  if (lang === "en" && (l === "en-us" || l === "en-gb")) s += 1;
  if (/natural|neural|premium|enhanced|siri/i.test(v.name)) s += 4;
  if (/google/i.test(v.name)) s += 2;
  // Kahotia is a he: prefer the phone's male voices where their names say so.
  if (/\b(maged|majed|tarik|hamed|daniel|aaron|arthur|alex|fred|gordon|rishi|tom|male)\b/i.test(v.name)) s += 3;
  if (v.localService === false) s += 1; // cloud voices tend to sound better
  return s;
}

function bestVoice(lang: VoiceLang): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -1;
  for (const v of voices) {
    const s = scoreVoice(v, lang);
    if (s > bestScore) {
      best = v;
      bestScore = s;
    }
  }
  return best;
}

export class HostVoice {
  private audio: HTMLAudioElement | null = null;
  // null = not tried yet; false = the server has no human voice configured.
  private human: boolean | null = null;
  private cancel: (() => void) | null = null;

  // Call inside a tap.
  unlock(): void {
    if (typeof window === "undefined") return;
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.preload = "auto";
    }
    this.audio.src = SILENT_WAV;
    void this.audio.play().catch(() => {});
    if ("speechSynthesis" in window) {
      // Loads the voice list (Chrome fills it lazily) and unlocks iOS.
      window.speechSynthesis.getVoices();
      const u = new SpeechSynthesisUtterance("");
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  }

  stop(): void {
    this.cancel?.();
    this.cancel = null;
  }

  // Resolves when the host has finished speaking (or was stopped).
  async say(
    text: string,
    lang: VoiceLang,
    muted = false,
    onProgress?: OnProgress,
  ): Promise<void> {
    this.stop();
    if (muted || !text.trim()) return;
    if (this.human !== false && this.audio) {
      const ok = await this.sayHuman(text, onProgress);
      if (ok) return;
    }
    await this.sayDevice(text, lang, onProgress);
  }

  private async sayHuman(text: string, onProgress?: OnProgress): Promise<boolean> {
    let stopped = false;
    const controller = new AbortController();
    this.cancel = () => {
      stopped = true;
      controller.abort();
    };
    let url: string;
    try {
      const res = await fetch("/api/host/voice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (res.status === 501) {
        this.human = false;
        return false;
      }
      if (!res.ok) return false;
      url = URL.createObjectURL(await res.blob());
      this.human = true;
    } catch {
      return stopped; // a stop counts as done, a network error falls back
    }
    if (stopped) {
      URL.revokeObjectURL(url);
      return true;
    }
    const audio = this.audio!;
    return new Promise<boolean>((resolve) => {
      const done = (ok: boolean) => {
        audio.onended = null;
        audio.onerror = null;
        audio.ontimeupdate = null;
        URL.revokeObjectURL(url);
        resolve(ok);
      };
      this.cancel = () => {
        audio.pause();
        done(true);
      };
      audio.onended = () => done(true);
      audio.onerror = () => done(false);
      audio.ontimeupdate = () => {
        if (audio.duration > 0 && Number.isFinite(audio.duration)) {
          onProgress?.(Math.round((text.length * audio.currentTime) / audio.duration));
        }
      };
      audio.src = url;
      audio.play().catch(() => done(false));
    });
  }

  private sayDevice(text: string, lang: VoiceLang, onProgress?: OnProgress): Promise<void> {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return Promise.resolve();
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    return new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === "ar" ? "ar-EG" : "en-US";
      const v = bestVoice(lang);
      if (v) u.voice = v;
      // A touch slower and lower than the default reads warmer and less
      // like a talking box.
      u.rate = lang === "ar" ? 0.96 : 0.98;
      u.pitch = 0.92;
      // Some phones never fire onend; don't let the conversation hang.
      const guard = window.setTimeout(finish, 4000 + text.length * 110);
      function finish() {
        window.clearTimeout(guard);
        resolve();
      }
      // Most phones report each word as it is spoken.
      u.onboundary = (e) => onProgress?.(e.charIndex + (e.charLength || 0));
      u.onend = finish;
      u.onerror = finish;
      this.cancel = () => {
        synth.cancel();
        finish();
      };
      synth.speak(u);
    });
  }
}
