"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { usePlayer } from "@/components/player/player-provider";
import { formatCatalogId, formatWorkLabel } from "@/lib/catalog";
import { formatDuration } from "@/lib/format";
import {
  LOAD_SECONDS,
  MAX_TRACKS,
  MIN_TRACKS,
  planSet,
  prepareTrack,
  renderSet,
  visitCounts,
  type Energy,
  type MixMinutes,
  type MixPlan,
  type Move,
  type PreparedTrack,
} from "@/lib/mixer/engine";
import { loadDeck } from "@/lib/mixer/load";
import { analyzeStructure } from "@/lib/mixer/structure";
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
  { value: "lounge", label: "Lounge", note: "Smooth blends only. The songs carry it, no extra drums." },
  { value: "club", label: "Club", note: "Blends and mash-ups, a bridge kick, hats, claps, risers and drops." },
  { value: "peak", label: "Peak", note: "Everything in Club, harder: more cuts, more drops, a heavier kick." },
];

const MINUTES: { value: MixMinutes; label: string; note: string }[] = [
  { value: 5, label: "5 min", note: "At least 5 minutes." },
  { value: 7, label: "7 min", note: "At least 7 minutes." },
  { value: 10, label: "10 min", note: "At least 10 minutes. Takes longer to build on a phone." },
];

const MOVE_LABEL: Record<Move, string> = {
  open: "opens",
  blend: "blends in",
  mashup: "mash-up: its voice over the last beat",
  cut: "drops in on a cut",
};

type Stage =
  | { kind: "idle" }
  | { kind: "working"; step: string; progress: number }
  | { kind: "done"; url: string; plan: MixPlan; seconds: number; set: MixSource[] }
  | { kind: "error"; message: string };

function names(s: MixSource): string {
  return s.contributors.map((c) => c.name).join(", ") || "AIRED";
}

const tick = () => new Promise((r) => setTimeout(r, 20)); // let the label paint

export function MixerStudio({ sources }: { sources: MixSource[] }) {
  const [setIds, setSetIds] = useState<number[]>(sources.slice(0, 2).map((s) => s.id));
  const [energy, setEnergy] = useState<Energy>("club");
  const [minutes, setMinutes] = useState<MixMinutes>(5);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const { pause } = usePlayer();

  const set = useMemo(
    () => setIds.map((id) => sources.find((s) => s.id === id)).filter((s): s is MixSource => !!s),
    [sources, setIds],
  );

  // Free the previous mix's memory when a new one replaces it or we leave.
  const doneUrl = stage.kind === "done" ? stage.url : null;
  useEffect(() => {
    return () => {
      if (doneUrl) URL.revokeObjectURL(doneUrl);
    };
  }, [doneUrl]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const busy = stage.kind === "working";
  const ready = set.length >= MIN_TRACKS && !busy;

  function add(id: number) {
    setSetIds((ids) => (ids.includes(id) || ids.length >= MAX_TRACKS ? ids : [...ids, id]));
  }
  function remove(id: number) {
    setSetIds((ids) => ids.filter((x) => x !== id));
  }
  function move(id: number, dir: -1 | 1) {
    setSetIds((ids) => {
      const i = ids.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return ids;
      const out = [...ids];
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    });
  }

  async function makeMix() {
    const tracks = set;
    if (tracks.length < MIN_TRACKS) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const n = tracks.length;
    // Each song: fetch (70% of its slice) then analyse (30%). Render after.
    const slice = 0.8 / n;
    try {
      const prepared: PreparedTrack[] = [];
      let masterBpm = 0;
      let counts: number[] = [];
      for (let i = 0; i < n; i++) {
        const s = tracks[i];
        const base = i * slice;
        setStage({ kind: "working", step: `Fetching ${s.title}`, progress: base });
        const deck = await loadDeck(s.hlsPlaylistKey, LOAD_SECONDS, {
          signal: ac.signal,
          onProgress: (f) =>
            setStage({ kind: "working", step: `Fetching ${s.title}`, progress: base + f * slice * 0.7 }),
        });
        if (ac.signal.aborted) return;
        setStage({ kind: "working", step: `Reading the beat and sections of ${s.title}`, progress: base + slice * 0.75 });
        await tick();
        const tempo = detectTempo(deck.buffer);
        const structure = analyzeStructure(deck.buffer, tempo);
        if (i === 0) {
          masterBpm = tempo.bpm;
          counts = visitCounts(masterBpm, minutes, n).per;
        }
        // Only the chosen sections are kept; the full song is let go here.
        prepared.push(prepareTrack(s.title, deck.buffer, tempo, structure, masterBpm, counts[i], i === 0));
      }

      setStage({ kind: "working", step: "Mixing the set", progress: 0.82 });
      await tick();
      const plan = planSet(prepared, masterBpm, energy);
      const buffer = await renderSet(prepared, plan, energy);
      if (ac.signal.aborted) return;

      setStage({ kind: "working", step: "Packing the file", progress: 0.96 });
      await tick();
      const blob = encodeWav(buffer, {
        title: `${tracks.map((t) => t.title).join(" × ")} (AIRED Mix)`,
        artist: tracks.map(names).join(" × "),
        comment:
          `AIRED Mix. Built from ` +
          tracks.map((t) => `${formatWorkLabel(t.id, t.title)} by ${names(t)}`).join("; ") +
          `. Beat-matched and arranged by the AIRED Mixer. ai-red.io`,
        software: "AIRED Mixer",
      });
      setStage({
        kind: "done",
        url: URL.createObjectURL(blob),
        plan,
        seconds: buffer.duration,
        set: tracks,
      });
    } catch (err) {
      if (ac.signal.aborted) return;
      setStage({
        kind: "error",
        message: err instanceof Error ? err.message : "The mix didn't come together.",
      });
    }
  }

  if (sources.length < MIN_TRACKS) {
    return (
      <p className="rounded-xl border border-white/10 p-5 text-sm text-muted">
        The Mixer needs at least two live songs to work with.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SetList set={set} onRemove={remove} onMove={move} disabled={busy} />

      <SongPicker
        sources={sources}
        inSet={setIds}
        full={setIds.length >= MAX_TRACKS}
        onAdd={add}
        disabled={busy}
      />

      <Choice legend="Energy" options={ENERGIES} value={energy} onChange={setEnergy} disabled={busy} />
      <Choice legend="Length" options={MINUTES} value={minutes} onChange={setMinutes} disabled={busy} />

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void makeMix()}
          disabled={!ready}
          className="rounded-lg bg-foreground px-5 py-3 text-sm font-semibold text-background transition hover:brightness-95 active:scale-[0.99] disabled:opacity-40"
        >
          {busy ? "Mixing…" : stage.kind === "done" ? "Mix again" : "Mix it"}
        </button>
        {set.length < MIN_TRACKS ? (
          <p className="text-xs text-muted">Add at least two songs.</p>
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
          {stage.message} Try again, or change the songs.
        </p>
      ) : null}

      {stage.kind === "done" ? <MixResult stage={stage} onPlay={pause} /> : null}
    </div>
  );
}

function MixResult({
  stage,
  onPlay,
}: {
  stage: Extract<Stage, { kind: "done" }>;
  onPlay: () => void;
}) {
  const { plan, set } = stage;
  const fileName = `AIRED Mix - ${set.map((s) => formatCatalogId(s.id)).join(" x ")}.wav`;
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-white/12 bg-white/[0.03] p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">{set.map((s) => s.title).join(" × ")}</h2>
        <p className="text-xs text-muted">
          AIRED Mix · {formatDuration(Math.round(stage.seconds))} · {Math.round(plan.bpm)} BPM ·{" "}
          {plan.visits.length} sections
        </p>
      </div>

      {/* Its own element, scoped to this page. Pressing play here pauses the
          global player so two things never sound at once. */}
      <audio controls src={stage.url} onPlay={onPlay} className="w-full" />

      <a
        href={stage.url}
        download={fileName}
        className="self-start rounded-lg border border-white/15 px-4 py-2.5 text-sm font-medium text-foreground transition hover:border-white/30"
      >
        Download the mix
      </a>

      <div className="flex flex-col gap-1.5 border-t border-white/8 pt-4">
        <p className="text-xs font-medium text-foreground">How the set runs</p>
        <ol className="flex flex-col gap-1 text-xs text-muted">
          {plan.visits.map((v, i) => (
            <li key={i} className="flex gap-3">
              <span className="w-10 shrink-0 tabular-nums text-foreground/80">
                {formatDuration(Math.round(v.at))}
              </span>
              <span className="min-w-0">
                {set[v.track].title}{" "}
                <span className="text-muted/70">
                  (from {formatDuration(Math.round(v.sourceStart))}) · {MOVE_LABEL[v.move]}
                </span>
              </span>
            </li>
          ))}
        </ol>
        <ul className="mt-2 flex flex-col gap-0.5 text-xs text-muted/80">
          {plan.tracks.map((t, i) => {
            const nudge = (t.rate - 1) * 100;
            return (
              <li key={i}>
                {t.title}: {Math.round(t.bpm)} BPM
                {i === 0
                  ? " · sets the tempo"
                  : !t.synced
                    ? " · too far from the set's tempo to lock, so it comes and goes on cuts"
                    : Math.abs(nudge) >= 0.1
                      ? ` · ${nudge > 0 ? "sped up" : "slowed down"} ${Math.abs(nudge).toFixed(1)}%`
                      : " · already on tempo"}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-white/8 pt-4 text-xs text-muted">
        <p className="font-medium text-foreground">Credits</p>
        {set.map((s) => (
          <p key={s.id}>
            {formatWorkLabel(s.id, s.title)} by {names(s)}
          </p>
        ))}
        <p>Mixed by you · beat-matched and arranged by the AIRED Mixer</p>
        <p className="text-muted/70">These credits are written inside the downloaded file too.</p>
      </div>
    </section>
  );
}

function SetList({
  set,
  onRemove,
  onMove,
  disabled,
}: {
  set: MixSource[];
  onRemove: (id: number) => void;
  onMove: (id: number, dir: -1 | 1) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2 rounded-2xl border border-white/10 p-4" disabled={disabled}>
      <legend className="px-1 text-sm font-semibold text-foreground">
        Your set{" "}
        <span className="font-normal text-muted">
          · {set.length} of {MAX_TRACKS} · the first song opens and sets the tempo
        </span>
      </legend>
      {set.length === 0 ? <p className="px-1 text-xs text-muted">Add songs from the list below.</p> : null}
      <ol className="flex flex-col gap-1">
        {set.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2 py-1.5">
            <span className="w-5 shrink-0 text-center text-xs text-muted">{i + 1}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm text-foreground">{s.title}</span>
              <span className="truncate text-xs text-muted">
                {formatCatalogId(s.id)} · {names(s)}
              </span>
            </span>
            <IconButton label="Move up" onClick={() => onMove(s.id, -1)} disabled={i === 0}>
              ↑
            </IconButton>
            <IconButton label="Move down" onClick={() => onMove(s.id, 1)} disabled={i === set.length - 1}>
              ↓
            </IconButton>
            <IconButton label="Remove" onClick={() => onRemove(s.id)}>
              ✕
            </IconButton>
          </li>
        ))}
      </ol>
    </fieldset>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-sm text-muted transition hover:bg-white/10 hover:text-foreground disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function SongPicker({
  sources,
  inSet,
  full,
  onAdd,
  disabled,
}: {
  sources: MixSource[];
  inSet: number[];
  full: boolean;
  onAdd: (id: number) => void;
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
        Add songs <span className="font-normal text-muted">· 2 to {MAX_TRACKS}</span>
      </legend>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a song or a maker"
        className="rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted/60 focus:border-white/30 focus:outline-none"
      />
      <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
        {list.map((s) => {
          const added = inSet.includes(s.id);
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onAdd(s.id)}
                disabled={added || full}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-white/[0.04] disabled:hover:bg-transparent"
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
                  </span>
                </span>
                <span className="ml-auto shrink-0 text-xs text-muted">
                  {added ? "In the set ✓" : full ? "" : "+ Add"}
                </span>
              </button>
            </li>
          );
        })}
        {list.length === 0 ? <li className="px-2 py-2 text-xs text-muted">No match.</li> : null}
      </ul>
    </fieldset>
  );
}

function Choice<T extends string | number>({
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
