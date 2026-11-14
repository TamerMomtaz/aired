"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { usePlayer } from "@/components/player/player-provider";
import type { Track } from "@/components/player/track";
import { formatDuration } from "@/lib/format";
import { deleteMix, loadMixAudio, markOnAccount, mixPlayerId, renameMix, type SavedMix } from "@/lib/mixer/library";
import { Mp3Button } from "@/components/mixer/mp3-button";
import { uploadMixToAccount } from "@/lib/mixes/upload";
import { wavToMp3 } from "@/lib/mixer/mp3";

// The catalog numbers a mix was built from. Mixes saved before these were
// stored carry them only in their credit labels ("AIRED-0092 · …").
function sourceIds(m: SavedMix): number[] {
  if (m.sourceWorkIds?.length) return m.sourceWorkIds;
  return m.credits
    .map((c) => Number(/AIRED-(\d+)/.exec(c.label)?.[1]))
    .filter((n) => Number.isSafeInteger(n) && n > 0);
}

// File URLs for saved mixes, made once per page visit and shared by the shelf
// and the player, so a mix that is playing keeps playing while you browse.
const urls = new Map<string, string>();

async function urlFor(id: string): Promise<string | null> {
  const known = urls.get(id);
  if (known) return known;
  const blob = await loadMixAudio(id).catch(() => null);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

function toTrack(m: SavedMix, url: string): Track {
  const makers = [m.dj ?? "You", ...m.makers.filter((n) => n !== m.dj)];
  return {
    id: mixPlayerId(m.id),
    title: m.title,
    hlsPlaylistKey: null,
    artworkUrl: null,
    durationSeconds: Math.round(m.seconds),
    contributors: makers.map((name) => ({ name, profile_slug: null })),
    localUrl: url,
  };
}

function fileName(m: SavedMix): string {
  return `${m.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "AIRED Mix"} - MixaTee.wav`;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// MIXATEE: every mix you've made, kept in the app. Play one (or all of them, in
// a row) in the main player, rename it, download it again, or let it go.
export function MixaTeeShelf({ mixes, onChange }: { mixes: SavedMix[]; onChange: () => void }) {
  const { playQueue, current, isPlaying, toggle } = usePlayer();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keeping, setKeeping] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [needSignIn, setNeedSignIn] = useState(false);

  async function keep(m: SavedMix) {
    setError(null);
    setNeedSignIn(false);
    const wav = await loadMixAudio(m.id).catch(() => null);
    if (!wav) return setError("That mix couldn't be read from this device.");
    setKeeping(m.id);
    // A 10 minute WAV is about 100 MB, too big to get up from a phone (Tee
    // pressed Keep and it just sat there). The same mix as a 192 kbps MP3 is
    // about 14 MB; the worker turns either into the stream.
    setStep("Making it small to send… 0%");
    const blob = await wavToMp3(wav, (f) => setStep(`Making it small to send… ${Math.round(f * 100)}%`)).catch(() => null);
    if (!blob) {
      setKeeping(null);
      setStep(null);
      return setError("That mix couldn't be prepared for AIRED. Try again.");
    }
    setStep(`Sending ${Math.max(1, Math.round(blob.size / 1e6))} MB to AIRED…`);
    const r = await uploadMixToAccount(blob, {
      title: m.title,
      seconds: m.seconds,
      bpm: m.bpm,
      energy: m.energy,
      dj: m.dj,
      story: m.story,
      plannedBy: m.plannedBy,
      sourceWorkIds: sourceIds(m),
    });
    setKeeping(null);
    setStep(null);
    if ("error" in r) {
      if (r.error === "signin") setNeedSignIn(true);
      else setError(r.error);
      return;
    }
    await markOnAccount(m.id, r.id).catch(() => {});
    onChange();
  }

  async function play(from: number) {
    setError(null);
    const tracks: Track[] = [];
    let start = 0;
    for (let i = 0; i < mixes.length; i++) {
      const url = await urlFor(mixes[i].id);
      if (!url) continue;
      if (i === from) start = tracks.length;
      tracks.push(toTrack(mixes[i], url));
    }
    if (tracks.length === 0) {
      setError("That mix couldn't be read from this device.");
      return;
    }
    playQueue(tracks, start);
  }

  async function download(m: SavedMix) {
    const url = await urlFor(m.id);
    if (!url) return setError("That mix couldn't be read from this device.");
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName(m);
    a.click();
  }

  async function remove(m: SavedMix) {
    if (confirm !== m.id) return setConfirm(m.id);
    setConfirm(null);
    await deleteMix(m.id).catch(() => setError("Couldn't delete that mix."));
    onChange();
  }

  if (mixes.length === 0) return null;
  const totalSeconds = mixes.reduce((t, m) => t + m.seconds, 0);

  return (
    <section id="mixatee" className="flex scroll-mt-20 flex-col gap-3 border-t border-white/8 pt-8">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold text-foreground">MixaTee</h2>
          <p className="text-xs text-muted">
            Your mixes, kept on this device. {mixes.length} {mixes.length === 1 ? "mix" : "mixes"} ·{" "}
            {formatDuration(Math.round(totalSeconds))}
          </p>
        </div>
        {mixes.length > 1 ? (
          <button
            type="button"
            onClick={() => void play(0)}
            className="shrink-0 rounded-lg border border-white/15 px-3 py-2 text-sm text-foreground hover:border-white/30"
          >
            ▶ Play all
          </button>
        ) : null}
      </div>

      <ul className="flex flex-col gap-2">
        {mixes.map((m, i) => {
          const playing = current?.id === mixPlayerId(m.id);
          return (
            <li
              key={m.id}
              className={`flex flex-col gap-2 rounded-xl border p-3 ${playing ? "border-cert-red/50 bg-cert-red/[0.05]" : "border-white/10 bg-white/[0.02]"}`}
            >
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => (playing ? toggle() : void play(i))}
                  aria-label={playing && isPlaying ? `Pause ${m.title}` : `Play ${m.title}`}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground text-sm text-background"
                >
                  {playing && isPlaying ? "❚❚" : "▶"}
                </button>
                <div className="flex min-w-0 flex-1 flex-col">
                  <TitleField key={m.title} mix={m} onSaved={onChange} />
                  <span className="truncate text-xs text-muted">
                    {formatDuration(Math.round(m.seconds))} · {m.energy} · {Math.round(m.bpm)} BPM ·{" "}
                    {dateFmt.format(m.createdAt)}
                    {m.dj ? ` · mixed by ${m.dj}` : ""}
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted/80">{m.credits.map((c) => `${c.label} by ${c.by}`).join(" · ")}</p>
              <div className="flex flex-wrap items-center gap-2">
                {m.accountId ? (
                  <Link
                    href={`/mixes/${m.accountId}`}
                    className="rounded-lg border border-cert-red/40 px-3 py-1.5 text-xs text-foreground hover:border-cert-red/70"
                  >
                    On AIRED ✓
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => void keep(m)}
                    disabled={keeping !== null}
                    className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
                  >
                    {keeping === m.id ? (step ?? "Saving to AIRED…") : "Keep on AIRED"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void download(m)}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-foreground hover:border-white/30"
                >
                  WAV
                </button>
                <Mp3Button
                  getWav={() => loadMixAudio(m.id)}
                  fileName={fileName(m).replace(/\.wav$/, "")}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-foreground hover:border-white/30 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => void remove(m)}
                  onBlur={() => setConfirm(null)}
                  className="px-2 py-1.5 text-xs text-muted hover:text-foreground"
                >
                  {confirm === m.id ? "Tap again to delete" : "Delete"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {error ? <p className="text-xs text-muted">{error}</p> : null}
      {needSignIn ? (
        <p className="text-xs text-foreground">
          <Link href="/login?next=/mix" className="underline">
            Sign in
          </Link>{" "}
          to keep mixes on your AIRED account.
        </p>
      ) : null}
      <p className="text-xs text-muted/70">
        MixaTee lives in this browser on this device. Tap <strong>Keep on AIRED</strong> to save a mix to your
        account, where it plays on any device you sign in on.{" "}
        <Link href="/mixes" className="underline">
          My mixes on AIRED
        </Link>
      </p>
    </section>
  );
}

function TitleField({ mix, onSaved }: { mix: SavedMix; onSaved: () => void }) {
  const [value, setValue] = useState(mix.title);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <input
      ref={ref}
      type="text"
      value={value}
      maxLength={80}
      aria-label="Mix name"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const t = value.trim().slice(0, 80);
        if (!t || t === mix.title) return setValue(mix.title);
        void renameMix(mix.id, t).then(onSaved);
      }}
      onKeyDown={(e) => e.key === "Enter" && ref.current?.blur()}
      className="w-full truncate bg-transparent text-sm font-medium text-foreground focus:outline-none"
    />
  );
}
