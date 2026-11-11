"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { usePlayer } from "@/components/player/player-provider";
import { formatCatalogId, formatWorkLabel } from "@/lib/catalog";
import { formatDuration } from "@/lib/format";
import {
  deckWindowSeconds,
  planMix,
  renderMix,
  type Energy,
  type MixLength,
  type MixPlan,
} from "@/lib/mixer/engine";
import { loadDeck } from "@/lib/mixer/load";
import { detectTempo } from "@/lib/mixer/tempo";
import { encodeWav } from "@/lib/mixer/wav";

export type MixSource = {
  id: number;
  title: string;
  artworkUrl: string | null;
  durationSeconds: number | null;
  hlsPlaylistKey: string | null;
  contributors: { name: string; profile_slug: string | null }[];
};

const ENERGIES: { value: Energy; label: string; note: string }[] = [
  { value: "lounge", label: "Lounge", note: "Long, smooth 32-bar blend. No extra drums." },
  { value: "club", label: "Club", note: "16-bar blend, bridge kick, hats, riser and a drop." },
  { value: "peak", label: "Peak", note: "Fast 8-bar cut, kick all the way, claps, big drop." },
];

const LENGTHS: { value: MixLength; label: string; note: string }[] = [
  { value: "short", label: "Short", note: "about 2½ min" },
  { value: "long", label: "Long", note: "about 5 min" },
];

type Stage =
  | { kind: "idle" }
  | { kind: "working"; step: string; progress: number }
  | { kind: "done"; url: string; blob: Blob; plan: MixPlan; seconds: number }
  | { kind: "error"; message: string };

function names(s: MixSource): string {
  return s.contributors.map((c) => c.name).join(", ") || "AIRED";
}

export function MixerStudio({ sources }: { sources: MixSource[] }) {
  const [aId, setAId] = useState<number | null>(sources[0]?.id ?? null);
  const [bId, setBId] = useState<number | null>(sources[1]?.id ?? null);
  const [energy, setEnergy] = useState<Energy>("club");
  const [length, setLength] = useState<MixLength>("short");
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const { pause } = usePlayer();

  const a = useMemo(() => sources.find((s) => s.id === aId) ?? null, [sources, aId]);
  const b = useMemo(() => sources.find((s) => s.id === bId) ?? null, [sources, bId]);

  // Free the previous mix's memory when a new one replaces it or we leave.
  const doneUrl = stage.kind === "done" ? stage.url : null;
  useEffect(() => {
    return () => {
      if (doneUrl) URL.revokeObjectURL(doneUrl);
    };
  }, [doneUrl]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const busy = stage.kind === "working";
  const ready = !!a && !!b && a.id !== b.id && !busy;

  async function makeMix() {
    if (!a || !b || a.id === b.id) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const win = deckWindowSeconds(length);
    try {
      setStage({ kind: "working", step: `Fetching ${a.title}`, progress: 0 });
      const deckA = await loadDeck(a.hlsPlaylistKey, win.a, {
        signal: ac.signal,
        onProgress: (f) =>
          setStage({ kind: "working", step: `Fetching ${a.title}`, progress: f * 0.35 }),
      });
      setStage({ kind: "working", step: `Fetching ${b.title}`, progress: 0.35 });
      const deckB = await loadDeck(b.hlsPlaylistKey, win.b, {
        signal: ac.signal,
        onProgress: (f) =>
          setStage({ kind: "working", step: `Fetching ${b.title}`, progress: 0.35 + f * 0.35 }),
      });
      if (ac.signal.aborted) return;

      setStage({ kind: "working", step: "Finding the beat", progress: 0.72 });
      await new Promise((r) => setTimeout(r, 20)); // let the label paint
      const ta = detectTempo(deckA.buffer);
      const tb = detectTempo(deckB.buffer);
      const plan = planMix(deckA, deckB, ta, tb, energy, length);

      setStage({ kind: "working", step: "Mixing", progress: 0.8 });
      const { buffer } = await renderMix(deckA, deckB, ta, tb, energy, plan);
      if (ac.signal.aborted) return;

      setStage({ kind: "working", step: "Packing the file", progress: 0.95 });
      const blob = encodeWav(buffer, {
        title: `${a.title} × ${b.title} (AIRED Mix)`,
        artist: `${names(a)} × ${names(b)}`,
        comment:
          `AIRED Mix. Built from ${formatWorkLabel(a.id, a.title)} by ${names(a)} ` +
          `and ${formatWorkLabel(b.id, b.title)} by ${names(b)}. ` +
          `Beat-matched and arranged by the AIRED Mixer. ai-red.io`,
        software: "AIRED Mixer",
      });
      setStage({
        kind: "done",
        url: URL.createObjectURL(blob),
        blob,
        plan,
        seconds: buffer.duration,
      });
    } catch (err) {
      if (ac.signal.aborted) return;
      setStage({
        kind: "error",
        message: err instanceof Error ? err.message : "The mix didn't come together.",
      });
    }
  }

  if (sources.length < 2) {
    return (
      <p className="rounded-xl border border-white/10 p-5 text-sm text-muted">
        The Mixer needs at least two live songs to work with.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <DeckPicker
          label="Deck A"
          hint="Starts the mix and sets the tempo"
          sources={sources}
          value={aId}
          other={bId}
          onChange={setAId}
          disabled={busy}
        />
        <DeckPicker
          label="Deck B"
          hint="Comes in on the drop"
          sources={sources}
          value={bId}
          other={aId}
          onChange={setBId}
          disabled={busy}
        />
      </div>

      <button
        type="button"
        onClick={() => {
          setAId(bId);
          setBId(aId);
        }}
        disabled={busy}
        className="self-start rounded-lg px-3 py-1.5 text-xs text-muted transition hover:text-foreground disabled:opacity-40"
      >
        ⇅ Swap decks
      </button>

      <Choice
        legend="Energy"
        options={ENERGIES}
        value={energy}
        onChange={setEnergy}
        disabled={busy}
      />
      <Choice
        legend="Length"
        options={LENGTHS}
        value={length}
        onChange={setLength}
        disabled={busy}
      />

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void makeMix()}
          disabled={!ready}
          className="rounded-lg bg-foreground px-5 py-3 text-sm font-semibold text-background transition hover:brightness-95 active:scale-[0.99] disabled:opacity-40"
        >
          {busy ? "Mixing…" : stage.kind === "done" ? "Mix again" : "Mix it"}
        </button>
        {a && b && a.id === b.id ? (
          <p className="text-xs text-muted">Pick two different songs.</p>
        ) : null}
      </div>

      {stage.kind === "working" ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          <p className="text-sm text-foreground">{stage.step}…</p>
          <div className="h-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-foreground/80 transition-[width]"
              style={{ width: `${Math.round(stage.progress * 100)}%` }}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              abortRef.current?.abort();
              setStage({ kind: "idle" });
            }}
            className="self-start text-xs text-muted hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {stage.kind === "error" ? (
        <p className="rounded-xl border border-white/15 p-4 text-sm text-foreground" role="alert">
          {stage.message} Try again, or pick another pair.
        </p>
      ) : null}

      {stage.kind === "done" && a && b ? (
        <MixResult a={a} b={b} stage={stage} onPlay={pause} />
      ) : null}
    </div>
  );
}

function MixResult({
  a,
  b,
  stage,
  onPlay,
}: {
  a: MixSource;
  b: MixSource;
  stage: Extract<Stage, { kind: "done" }>;
  onPlay: () => void;
}) {
  const { plan } = stage;
  const nudge = (plan.rateB - 1) * 100;
  const fileName = `AIRED Mix - ${formatCatalogId(a.id)} x ${formatCatalogId(b.id)}.wav`;
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-white/12 bg-white/[0.03] p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">
          {a.title} × {b.title}
        </h2>
        <p className="text-xs text-muted">
          AIRED Mix · {formatDuration(Math.round(stage.seconds))}
        </p>
      </div>

      {/* Its own element, scoped to this page. Pressing play here pauses the
          global player so two things never sound at once. */}
      <audio controls src={stage.url} onPlay={onPlay} className="w-full" />

      <ul className="flex flex-col gap-1 text-xs text-muted">
        {plan.synced ? (
          <li>
            Locked at {Math.round(plan.bpm)} BPM
            {Math.abs(nudge) >= 0.1
              ? ` · ${b.title} ${nudge > 0 ? "sped up" : "slowed down"} ${Math.abs(nudge).toFixed(1)}% to meet ${a.title}`
              : " · both songs already shared a tempo"}
          </li>
        ) : (
          <li>
            The tempos were too far apart to lock ({Math.round(plan.bpmA)} vs{" "}
            {Math.round(plan.bpmB)} BPM), so the Mixer used a filter blend instead.
          </li>
        )}
        <li>
          {plan.transitionBars}-bar blend from {formatDuration(Math.round(plan.transitionStart))} ·
          drop at {formatDuration(Math.round(plan.dropAt))}
        </li>
      </ul>

      <a
        href={stage.url}
        download={fileName}
        className="self-start rounded-lg border border-white/15 px-4 py-2.5 text-sm font-medium text-foreground transition hover:border-white/30"
      >
        Download the mix
      </a>

      <div className="flex flex-col gap-1.5 border-t border-white/8 pt-4 text-xs text-muted">
        <p className="font-medium text-foreground">Credits</p>
        <p>
          Built from {formatWorkLabel(a.id, a.title)} by {names(a)}
        </p>
        <p>
          and {formatWorkLabel(b.id, b.title)} by {names(b)}
        </p>
        <p>Mixed by you · beat-matched and arranged by the AIRED Mixer</p>
        <p className="text-muted/70">
          These credits are written inside the downloaded file too.
        </p>
      </div>
    </section>
  );
}

function DeckPicker({
  label,
  hint,
  sources,
  value,
  other,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  sources: MixSource[];
  value: number | null;
  other: number | null;
  onChange: (id: number) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const list = q
    ? sources.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          formatCatalogId(s.id).toLowerCase().includes(q) ||
          s.contributors.some((c) => c.name.toLowerCase().includes(q)),
      )
    : sources;

  return (
    <fieldset className="flex flex-col gap-2 rounded-2xl border border-white/10 p-4" disabled={disabled}>
      <legend className="px-1 text-sm font-semibold text-foreground">
        {label} <span className="font-normal text-muted">· {hint}</span>
      </legend>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a song or a maker"
        className="rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted/60 focus:border-white/30 focus:outline-none"
      />
      <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto" role="listbox" aria-label={label}>
        {list.map((s) => {
          const selected = s.id === value;
          return (
            <li key={s.id}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onChange(s.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition ${
                  selected ? "bg-white/[0.09]" : "hover:bg-white/[0.04]"
                }`}
              >
                {s.artworkUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.artworkUrl} alt="" className="size-9 shrink-0 rounded object-cover" />
                ) : (
                  <span className="size-9 shrink-0 rounded bg-white/10" />
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-foreground">{s.title}</span>
                  <span className="truncate text-xs text-muted">
                    {formatCatalogId(s.id)} · {names(s)}
                    {s.id === other ? " · on the other deck" : ""}
                  </span>
                </span>
                {selected ? <span className="ml-auto text-xs text-foreground">✓</span> : null}
              </button>
            </li>
          );
        })}
        {list.length === 0 ? <li className="px-2 py-2 text-xs text-muted">No match.</li> : null}
      </ul>
    </fieldset>
  );
}

function Choice<T extends string>({
  legend,
  options,
  value,
  onChange,
  disabled,
}: {
  legend: string;
  options: { value: T; label: string; note: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled: boolean;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-1 text-sm font-semibold text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
            className={`rounded-full border px-4 py-1.5 text-sm transition ${
              o.value === value
                ? "border-foreground bg-foreground text-background"
                : "border-white/15 text-muted hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {current ? <p className="text-xs text-muted">{current.note}</p> : null}
    </fieldset>
  );
}
