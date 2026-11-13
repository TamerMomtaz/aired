"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useOnboarded } from "@/components/onboarding/onboarding-state";
import { usePlayer } from "@/components/player/player-provider";
import type { Track } from "@/components/player/track";
import { formatCatalogId } from "@/lib/catalog";
import { greeting, type HostLang } from "@/lib/host/persona";
import {
  getRecognizerCtor,
  initialLang,
  saveLang,
  type Lang,
  type Recognizer,
} from "@/lib/voice/speech";
import { HostVoice } from "./host-voice";
import { KahotiaStage } from "./kahotia-stage";

// Kahotia, AIRED's host: AIRED's mascot (half stitched burlap doll, half blue
// man, braids in fire and sea) says good morning to you by name, asks how you
// feel, chats about it (with jokes), and puts on songs that fit.
//
// When the app opens, a small speech bubble greets the listener above the mic
// button. Phones only allow sound and the microphone after a tap, so the bubble
// asks for one tap ("Let's talk"); from then on it is a spoken conversation:
// the host talks, then listens, then answers, until the music starts. Tap the
// mic to talk again any time. Ask AIRED's sheet can open it too, through the
// "aired:host-open" event.
//
// Nothing is stored: the conversation lives in this component and is sent to
// /api/host one turn at a time.

export const HOST_OPEN_EVENT = "aired:host-open";

type Song = {
  id: number;
  title: string;
  artworkUrl: string | null;
  durationSeconds: number | null;
  hlsPlaylistKey: string | null;
  contributors: { name: string; profile_slug: string | null }[];
};
type Turn = { role: "listener" | "host"; text: string };
type Phase = "idle" | "speaking" | "listening" | "thinking";

function toTrack(s: Song): Track {
  return {
    id: s.id,
    title: s.title,
    hlsPlaylistKey: s.hlsPlaylistKey,
    artworkUrl: s.artworkUrl,
    durationSeconds: s.durationSeconds,
    contributors: s.contributors,
  };
}

const noop = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

const hostLang = (l: Lang): HostLang => (l === "ar-EG" ? "ar" : "en");

export function Host({ name }: { name: string | null }) {
  const player = usePlayer();
  const mounted = useMounted();
  const onboarded = useOnboarded();

  const [lang, setLang] = useState<Lang>(initialLang);
  const [hello, setHello] = useState(() =>
    greeting(name, hostLang(initialLang()), new Date().getHours()),
  );
  const [bubble, setBubble] = useState(true);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [heard, setHeard] = useState("");
  const [typed, setTyped] = useState("");
  const [songs, setSongs] = useState<Song[]>([]);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  // How far into his current line Kahotia's voice has got, in characters.
  const [spoken, setSpoken] = useState(0);
  const [showChat, setShowChat] = useState(false);

  const voiceRef = useRef<HostVoice | null>(null);
  const recRef = useRef<Recognizer | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const openRef = useRef(false);
  const pausedRef = useRef(false);
  const listenRef = useRef<() => void>(() => {});
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const voice = () => (voiceRef.current ??= new HostVoice());

  const pushTurn = useCallback((t: Turn) => {
    turnsRef.current = [...turnsRef.current, t];
    setTurns(turnsRef.current);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, showChat]);

  const resumeIfPaused = useCallback(() => {
    if (pausedRef.current) {
      pausedRef.current = false;
      player.play();
    }
  }, [player]);

  const pauseForTalk = useCallback(() => {
    if (player.isPlaying) {
      player.pause();
      pausedRef.current = true;
    }
  }, [player]);

  // Host speaks, then (unless music is starting) listens for the answer.
  const speakThenListen = useCallback(
    async (text: string, l: HostLang, listenAfter: boolean) => {
      setSpoken(0);
      setPhase("speaking");
      await voice().say(text, l, muted, setSpoken);
      if (!openRef.current) return;
      if (listenAfter && getRecognizerCtor()) listenRef.current();
      else setPhase("idle");
    },
    [muted],
  );

  const send = useCallback(
    async (text: string) => {
      const said = text.trim();
      if (!said) return;
      pushTurn({ role: "listener", text: said });
      setHeard("");
      setPhase("thinking");
      setNote(null);
      try {
        const res = await fetch("/api/host", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            turns: turnsRef.current,
            name,
            lang: hostLang(lang),
            hour: new Date().getHours(),
            nowPlaying: player.current?.title ?? null,
          }),
        });
        const data = (await res.json()) as {
          say?: string;
          lang?: HostLang;
          play?: boolean;
          songs?: Song[];
          error?: string;
        };
        if (!res.ok || !data.say) throw new Error(data.error || "I lost my words for a second. Try again?");
        if (!openRef.current) return;
        pushTurn({ role: "host", text: data.say });
        const found = (data.songs ?? []).filter((s) => s.hlsPlaylistKey);
        if (found.length) setSongs(found);
        const startMusic = !!data.play && found.length > 0;
        await speakThenListen(data.say, data.lang ?? hostLang(lang), !startMusic);
        if (startMusic && openRef.current) {
          pausedRef.current = false;
          player.playQueue(found.map(toTrack), 0);
          setPlayingId(found[0].id);
        }
      } catch (err) {
        setPhase("idle");
        setNote(err instanceof Error ? err.message : "Something went wrong.");
      }
    },
    [lang, name, player, pushTurn, speakThenListen],
  );

  const listen = useCallback(() => {
    const Ctor = getRecognizerCtor();
    if (!Ctor) {
      setPhase("idle");
      return;
    }
    recRef.current?.abort();
    voice().stop();
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let final = "";
    setHeard("");
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      setHeard((final + " " + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setNote(
          lang === "ar-EG"
            ? "المايك مقفول لـ AIRED. افتحه من إعدادات المتصفح، أو اكتب تحت."
            : "The microphone is off for AIRED. Allow it in your browser settings, or type below.",
        );
      }
    };
    rec.onend = () => {
      recRef.current = null;
      const said = final.trim();
      if (said && openRef.current) void send(said);
      else {
        setPhase((p) => (p === "listening" ? "idle" : p));
        if (!said) resumeIfPaused();
      }
    };
    pauseForTalk();
    recRef.current = rec;
    setPhase("listening");
    try {
      rec.start();
    } catch {
      setPhase("idle");
    }
  }, [lang, pauseForTalk, resumeIfPaused, send]);

  useEffect(() => {
    listenRef.current = listen;
  }, [listen]);

  // Opening the host is always a tap, so this is where sound gets unlocked.
  const start = useCallback(
    (fromBubble: boolean) => {
      voice().unlock();
      openRef.current = true;
      setOpen(true);
      setBubble(false);
      setNote(null);
      if (turnsRef.current.length === 0) {
        const first = fromBubble
          ? hello
          : greeting(name, hostLang(lang), new Date().getHours());
        pushTurn({ role: "host", text: first });
        pauseForTalk();
        void speakThenListen(first, hostLang(lang), true);
      } else {
        listen();
      }
    },
    [hello, lang, listen, name, pauseForTalk, pushTurn, speakThenListen],
  );

  const close = useCallback(() => {
    openRef.current = false;
    recRef.current?.abort();
    recRef.current = null;
    voice().stop();
    setOpen(false);
    setPhase("idle");
    resumeIfPaused();
  }, [resumeIfPaused]);

  function restart() {
    recRef.current?.abort();
    voice().stop();
    turnsRef.current = [];
    setTurns([]);
    setSongs([]);
    setPlayingId(null);
    start(false);
  }

  function chooseLang(next: Lang) {
    setLang(next);
    saveLang(next);
    setHello(greeting(name, hostLang(next), new Date().getHours()));
  }

  function playSong(index: number) {
    voice().stop();
    recRef.current?.abort();
    pausedRef.current = false;
    player.playQueue(songs.map(toTrack), index);
    setPlayingId(songs[index].id);
    setPhase("idle");
  }

  useEffect(() => {
    const onOpen = () => start(false);
    window.addEventListener(HOST_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(HOST_OPEN_EVENT, onOpen);
  }, [start]);

  if (!mounted) return null;

  const ar = lang === "ar-EG";
  const lift = player.current
    ? "bottom-[calc(env(safe-area-inset-bottom)+11rem)]"
    : "bottom-[calc(env(safe-area-inset-bottom)+5.75rem)]";
  const canListen = !!getRecognizerCtor();
  const lastHostLine =
    [...turns].reverse().find((t) => t.role === "host")?.text ?? hello;

  return (
    <>
      {bubble && onboarded && !open ? (
        <div
          className={`fixed right-4 z-30 w-[min(20rem,calc(100vw-2rem))] rounded-2xl rounded-br-sm border border-white/12 bg-background/95 p-4 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.9)] backdrop-blur ${lift}`}
          role="dialog"
          aria-label="Kahotia says hello"
        >
          <div className="flex items-start gap-3">
            <HostAvatar className="size-14 shrink-0" />
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                Kahotia
              </span>
              <p dir="auto" className="text-sm leading-relaxed text-foreground">
                {hello}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setBubble(false)}
              aria-label="Not now"
              className="-m-1 rounded-full p-1 text-muted transition hover:text-foreground"
            >
              <CloseIcon className="size-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => start(true)}
            className="mt-3 w-full rounded-full bg-gradient-to-r from-[#e8902a] to-[#2f74e0] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_6px_20px_-8px_rgba(47,116,224,0.8)] transition hover:brightness-110"
          >
            {ar ? "يلا نتكلم" : "Let's talk"}
          </button>
        </div>
      ) : null}

      {open ? (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Talk with Kahotia"
            className="flex max-h-[92dvh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-t-2xl border border-white/10 bg-background p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="flex flex-col leading-tight">
                  <h2 className="text-base font-semibold text-foreground">Kahotia</h2>
                  <span className="text-[11px] text-muted">{ar ? "مضيف AIRED" : "your AIRED host"}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
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
                  onClick={() => {
                    if (!muted) voice().stop();
                    setMuted((m) => !m);
                  }}
                  aria-label={muted ? "Turn the host's voice on" : "Mute the host's voice"}
                  aria-pressed={muted}
                  className="rounded-full p-2 text-muted transition hover:bg-white/5 hover:text-foreground"
                >
                  <SpeakerIcon className="size-4" off={muted} />
                </button>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="rounded-full p-2 text-muted transition hover:bg-white/5 hover:text-foreground"
                >
                  <CloseIcon className="size-4" />
                </button>
              </div>
            </div>

            <KahotiaStage
              line={lastHostLine}
              speaking={phase === "speaking" && !muted}
              spoken={spoken}
              listening={phase === "listening"}
              thinking={phase === "thinking"}
              heard={heard}
              ar={ar}
            />

            <div className="flex flex-col gap-2">
              {songs.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-1">
                  {songs.map((s, i) => (
                    <li
                      key={s.id}
                      className={`flex items-center gap-3 rounded-lg px-1 py-1.5 ${playingId === s.id ? "bg-white/[0.06]" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => playSong(i)}
                        aria-label={`Play ${s.title}`}
                        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition hover:brightness-110"
                      >
                        <PlayIcon className="size-4" />
                      </button>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <Link
                          href={`/registry/${s.id}`}
                          onClick={close}
                          dir="auto"
                          className="truncate text-sm font-medium text-foreground hover:underline"
                        >
                          {s.title}
                        </Link>
                        <span className="truncate text-xs text-muted">
                          {formatCatalogId(s.id)}
                          {s.contributors.length
                            ? ` · ${s.contributors.map((c) => c.name).join(", ")}`
                            : ""}
                        </span>
                      </div>
                      {playingId === s.id ? (
                        <span className="shrink-0 text-[10px] uppercase tracking-[0.16em] text-muted">
                          {ar ? "شغّال" : "Playing"}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {turns.length > 1 ? (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setShowChat((v) => !v)}
                  aria-expanded={showChat}
                  className="self-center text-xs text-muted underline-offset-4 hover:text-foreground hover:underline"
                >
                  {showChat
                    ? ar ? "اخفي الكلام" : "Hide what we said"
                    : ar ? "اعرض الكلام كله" : "Show what we said"}
                </button>
                {showChat ? (
                  <div ref={scrollRef} className="flex max-h-48 flex-col gap-2 overflow-y-auto">
                    {turns.map((t, i) => (
                      <p
                        key={i}
                        dir="auto"
                        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                          t.role === "host"
                            ? "self-start rounded-bl-sm bg-white/[0.07] text-foreground"
                            : "self-end rounded-br-sm bg-foreground text-background"
                        }`}
                      >
                        {t.text}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {note ? (
              <p dir="auto" className="text-sm text-muted" role="status">
                {note}
              </p>
            ) : null}

            <div className="flex flex-col items-center gap-2 pt-1">
              {canListen ? (
                <button
                  type="button"
                  onClick={() =>
                    phase === "listening" ? recRef.current?.stop() : listen()
                  }
                  disabled={phase === "thinking"}
                  aria-label={phase === "listening" ? "Done talking" : "Talk"}
                  className={`relative flex size-16 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50 ${phase === "listening" ? "bg-foreground text-background" : "border border-white/15 bg-white/5 text-foreground hover:bg-white/10"}`}
                >
                  {phase === "listening" ? (
                    <span className="absolute inset-0 animate-ping rounded-full bg-foreground/30 motion-reduce:animate-none" />
                  ) : null}
                  <MicIcon className="relative size-7" />
                </button>
              ) : null}
              <p className="min-h-[1.25rem] text-center text-xs text-muted" aria-live="polite">
                {phase === "speaking"
                  ? ar ? "كاهوتيا بيتكلم… دوس على المايك عشان تقاطعه" : "Kahotia is talking… tap the mic to cut in"
                  : phase === "listening"
                    ? ar ? "سامعك…" : "Listening…"
                    : phase === "thinking"
                      ? ar ? "بفكّر…" : "Thinking…"
                      : canListen
                        ? ar ? "دوس على المايك واتكلم" : "Tap the mic to talk"
                        : ar ? "اكتب لي تحت" : "Type to me below"}
              </p>
            </div>

            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                recRef.current?.abort();
                voice().stop();
                const t = typed;
                setTyped("");
                void send(t);
              }}
            >
              <input
                dir="auto"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={ar ? "أو اكتب: أنا مضايق، فرّحني…" : "Or type: I'm tired, cheer me up…"}
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted/60 focus:border-white/30"
              />
              <button
                type="submit"
                className="rounded-lg border border-white/15 px-3 py-2 text-sm text-foreground transition hover:bg-white/[0.06]"
              >
                {ar ? "ابعت" : "Send"}
              </button>
            </form>
            {turns.length > 2 ? (
              <button
                type="button"
                onClick={restart}
                className="self-center text-xs text-muted underline-offset-4 hover:text-foreground hover:underline"
              >
                {ar ? "نبدأ من الأول" : "Start over"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

// Kahotia's face: the split portrait (burlap doll | blue man) in a ring that
// carries the same split, fire braids on the left and sea braids on the right.
// While Kahotia speaks, the ring breathes.
function HostAvatar({ className = "", active = false }: { className?: string; active?: boolean }) {
  return (
    <span className={`relative inline-flex shrink-0 rounded-full ${className}`} aria-hidden>
      {active ? (
        <span className="absolute -inset-1 animate-ping rounded-full bg-gradient-to-r from-[#e8902a]/50 to-[#2f74e0]/50 motion-reduce:animate-none" />
      ) : null}
      <span className="relative block size-full rounded-full bg-gradient-to-r from-[#e8902a] to-[#2f74e0] p-[2px] shadow-[0_0_18px_-4px_rgba(47,116,224,0.7)]">
        <Image
          src="/kahotia/face.jpg"
          alt=""
          width={160}
          height={160}
          className="size-full rounded-full object-cover"
        />
      </span>
    </span>
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

function SpeakerIcon({ className = "", off = false }: { className?: string; off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      {off ? <path d="m22 9-6 6M16 9l6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />}
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
