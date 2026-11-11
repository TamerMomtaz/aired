"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { HOST_OPEN_EVENT } from "@/components/host/host";
import { usePlayer } from "@/components/player/player-provider";
import type { Track } from "@/components/player/track";
import { formatCatalogId } from "@/lib/catalog";
import {
  getRecognizerCtor,
  initialLang,
  saveLang,
  type Lang,
  type Recognizer,
} from "@/lib/voice/speech";

// Ask AIRED: find (and play) a song by saying what you remember of it.
//
// A round mic button floats bottom-right on every page. One tap opens the sheet
// and starts listening right away, because it is meant to be used one-handed in
// a car. The listener says something like "play the song where she says ana add
// haaly" or "شغل الأغنية بتاعة عيد الميلاد", in Egyptian Arabic or English. The
// words go to /api/voice-search, which matches them against titles, makers and
// lyrics (and, with an AI key, by meaning). If they asked to PLAY and one song is
// a clear match, it starts playing; otherwise they pick from a short list.
//
// Speech-to-text is the browser's own (Web Speech API): Chrome on Android, and
// Safari on iPhone. It hears one language at a time, so the sheet has an
// عربي / English switch that is remembered. Where the browser has no speech
// recognition the sheet still works by typing.

type Result = {
  id: number;
  title: string;
  artworkUrl: string | null;
  durationSeconds: number | null;
  hlsPlaylistKey: string | null;
  contributors: { name: string; profile_slug: string | null }[];
  reason: string | null;
  snippet: string | null;
  confidence: number;
};

const AUTOPLAY_CONFIDENCE = 0.6;

function toTrack(r: Result): Track {
  return {
    id: r.id,
    title: r.title,
    hlsPlaylistKey: r.hlsPlaylistKey,
    artworkUrl: r.artworkUrl,
    durationSeconds: r.durationSeconds,
    contributors: r.contributors,
  };
}

type Phase = "idle" | "listening" | "searching" | "done" | "error";

export function VoiceSearch() {
  const player = usePlayer();
  const [open, setOpen] = useState(false);
  // Both read browser-only state; the sheet that uses them only ever renders
  // on the client (after a tap), so lazy initializers are safe here.
  const [lang, setLang] = useState<Lang>(initialLang);
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [typed, setTyped] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [supported, setSupported] = useState(() => !!getRecognizerCtor());

  const recRef = useRef<Recognizer | null>(null);
  const finalRef = useRef("");
  // Music we paused so the mic could hear; resumed if nothing new is chosen.
  const pausedForMicRef = useRef(false);


  const resumeIfPaused = useCallback(() => {
    if (pausedForMicRef.current) {
      pausedForMicRef.current = false;
      player.play();
    }
  }, [player]);

  const search = useCallback(
    async (q: string) => {
      const query = q.trim();
      if (!query) {
        setPhase("idle");
        resumeIfPaused();
        return;
      }
      setPhase("searching");
      setMessage(null);
      setResults([]);
      try {
        const res = await fetch("/api/voice-search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ q: query }),
        });
        const data = (await res.json()) as {
          intent?: "play" | "find";
          results?: Result[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "Search failed.");
        const found = (data.results ?? []).filter((r) => r.hlsPlaylistKey);
        setResults(found);
        setPhase("done");
        if (found.length === 0) {
          setMessage(
            lang === "ar-EG"
              ? "ملقتش أغنية زي كده. جرّب كلمة تانية من الأغنية."
              : "No song matched that. Try another word or line from it.",
          );
          resumeIfPaused();
          return;
        }
        const top = found[0];
        const clear =
          top.confidence >= AUTOPLAY_CONFIDENCE &&
          (found.length === 1 ||
            top.confidence - (found[1]?.confidence ?? 0) >= 0.15);
        if (data.intent === "play" && clear) {
          pausedForMicRef.current = false;
          player.playQueue(found.map(toTrack), 0);
          setPlayingId(top.id);
        } else {
          resumeIfPaused();
        }
      } catch (err) {
        setPhase("error");
        setMessage(err instanceof Error ? err.message : "Search failed.");
        resumeIfPaused();
      }
    },
    [lang, player, resumeIfPaused],
  );

  const stopListening = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const startListening = useCallback(() => {
    const Ctor = getRecognizerCtor();
    if (!Ctor) {
      setSupported(false);
      return;
    }
    recRef.current?.abort();
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    finalRef.current = "";
    setTranscript("");
    setResults([]);
    setMessage(null);
    setPlayingId(null);

    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript;
        else interim += r[0].transcript;
      }
      setTranscript((finalRef.current + " " + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setMessage(
          "Microphone access is off for AIRED. Allow the mic in your browser settings, or type below.",
        );
        setPhase("error");
      } else if (e.error === "no-speech") {
        setMessage(lang === "ar-EG" ? "مسمعتش حاجة. جرّب تاني." : "I didn't hear anything. Try again.");
        setPhase("idle");
      } else if (e.error !== "aborted") {
        setMessage("Listening stopped. Try again, or type below.");
        setPhase("error");
      }
    };
    rec.onend = () => {
      recRef.current = null;
      const said = finalRef.current.trim();
      if (said) {
        setTranscript(said);
        void search(said);
      } else {
        setPhase((p) => (p === "listening" ? "idle" : p));
        resumeIfPaused();
      }
    };

    // Pause the music so the mic hears the listener, not the song.
    if (player.isPlaying) {
      player.pause();
      pausedForMicRef.current = true;
    }
    recRef.current = rec;
    setPhase("listening");
    try {
      rec.start();
    } catch {
      setPhase("error");
      setMessage("Couldn't start the microphone. Type below instead.");
      resumeIfPaused();
    }
  }, [lang, player, search, resumeIfPaused]);

  function openSheet() {
    setOpen(true);
    if (getRecognizerCtor()) startListening();
  }

  function closeSheet() {
    recRef.current?.abort();
    recRef.current = null;
    setOpen(false);
    setPhase("idle");
    resumeIfPaused();
  }

  function chooseLang(next: Lang) {
    setLang(next);
    saveLang(next);
  }

  function playResult(index: number) {
    pausedForMicRef.current = false;
    player.playQueue(results.map(toTrack), index);
    setPlayingId(results[index].id);
  }

  // Sit above the now-playing bar when it's showing.
  const lift = player.current ? "bottom-[calc(env(safe-area-inset-bottom)+6.5rem)]" : "bottom-[calc(env(safe-area-inset-bottom)+1.25rem)]";
  const ar = lang === "ar-EG";

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={openSheet}
          aria-label="Ask AIRED for a song by voice"
          className={`fixed right-4 z-30 flex size-14 items-center justify-center rounded-full border border-white/15 bg-foreground text-background shadow-[0_6px_24px_-6px_rgba(0,0,0,0.8)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${lift}`}
        >
          <MicIcon className="size-6" />
        </button>
      ) : null}

      {open ? (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
          onClick={closeSheet}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Ask AIRED"
            className="flex max-h-[85dvh] w-full max-w-lg flex-col gap-4 rounded-t-2xl border border-white/10 bg-background p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-foreground">
                Ask AIRED
              </h2>
              <div className="flex items-center gap-2">
                <div
                  role="radiogroup"
                  aria-label="Language I'll speak"
                  className="flex rounded-full border border-white/10 p-0.5 text-xs"
                >
                  {(
                    [
                      ["ar-EG", "عربي"],
                      ["en-US", "English"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={lang === value}
                      onClick={() => chooseLang(value)}
                      className={`rounded-full px-3 py-1 transition ${lang === value ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={closeSheet}
                  aria-label="Close"
                  className="rounded-full p-2 text-muted transition hover:bg-white/5 hover:text-foreground"
                >
                  <CloseIcon className="size-4" />
                </button>
              </div>
            </div>

            {supported ? (
              <div className="flex flex-col items-center gap-3 py-2">
                <button
                  type="button"
                  onClick={phase === "listening" ? stopListening : startListening}
                  aria-label={phase === "listening" ? "Stop listening" : "Start listening"}
                  className={`relative flex size-20 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${phase === "listening" ? "bg-foreground text-background" : "border border-white/15 bg-white/5 text-foreground hover:bg-white/10"}`}
                >
                  {phase === "listening" ? (
                    <span className="absolute inset-0 animate-ping rounded-full bg-foreground/30 motion-reduce:animate-none" />
                  ) : null}
                  <MicIcon className="relative size-8" />
                </button>
                <p
                  dir="auto"
                  className="min-h-[1.5rem] text-center text-sm text-foreground"
                  aria-live="polite"
                >
                  {phase === "listening"
                    ? transcript || (ar ? "سامعك… قول اسم الأغنية أو كلمة منها" : "Listening… say a title or a line you remember")
                    : phase === "searching"
                      ? ar ? "بدوّر…" : "Looking…"
                      : transcript
                        ? `“${transcript}”`
                        : ar ? "دوس على المايك واتكلم" : "Tap the mic and speak"}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted">
                This browser can&rsquo;t listen yet. Type what you remember instead.
              </p>
            )}

            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                recRef.current?.abort();
                setTranscript(typed.trim());
                void search(typed);
              }}
            >
              <input
                dir="auto"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={ar ? "أو اكتب: الأغنية اللي فيها…" : "Or type: the song where…"}
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted/60 focus:border-white/30"
              />
              <button
                type="submit"
                className="rounded-lg border border-white/15 px-3 py-2 text-sm text-foreground transition hover:bg-white/[0.06]"
              >
                {ar ? "دوّر" : "Find"}
              </button>
            </form>

            <button
              type="button"
              onClick={() => {
                closeSheet();
                // Synchronous, so the host opens inside this same tap and may
                // speak right away.
                window.dispatchEvent(new Event(HOST_OPEN_EVENT));
              }}
              className="self-start text-xs text-muted underline-offset-4 transition hover:text-foreground hover:underline"
            >
              {ar ? "مش عارف تسمع إيه؟ اتكلم مع AIRED عن مودك" : "Not sure what you want? Talk to AIRED about your mood"}
            </button>

            {message ? (
              <p dir="auto" className="text-sm text-muted" role="status">
                {message}
              </p>
            ) : null}

            {results.length > 0 ? (
              <ul className="-mx-1 flex flex-col gap-1 overflow-y-auto">
                {results.map((r, i) => (
                  <li
                    key={r.id}
                    className={`flex items-center gap-3 rounded-lg px-1 py-2 ${playingId === r.id ? "bg-white/[0.06]" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => playResult(i)}
                      aria-label={`Play ${r.title}`}
                      className="flex size-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition hover:brightness-110"
                    >
                      <PlayIcon className="size-4" />
                    </button>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <Link
                        href={`/registry/${r.id}`}
                        onClick={closeSheet}
                        dir="auto"
                        className="truncate text-sm font-medium text-foreground hover:underline"
                      >
                        {r.title}
                      </Link>
                      <span className="truncate text-xs text-muted">
                        {formatCatalogId(r.id)}
                        {r.contributors.length
                          ? ` · ${r.contributors.map((c) => c.name).join(", ")}`
                          : ""}
                      </span>
                      {r.reason || r.snippet ? (
                        <span dir="auto" className="truncate text-xs text-muted/80">
                          {r.reason ?? `“${r.snippet}”`}
                        </span>
                      ) : null}
                    </div>
                    {playingId === r.id ? (
                      <span className="shrink-0 text-[10px] uppercase tracking-[0.16em] text-muted">
                        {ar ? "شغّال" : "Playing"}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function MicIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function PlayIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.5-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

function CloseIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
