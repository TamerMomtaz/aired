"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { usePlayer } from "@/components/player/player-provider";
import { ClubDecks } from "@/components/mixer/club-decks";
import { MixaTeeShelf } from "@/components/mixer/mixatee-shelf";
import { Mp3Button } from "@/components/mixer/mp3-button";
import { TagPanel } from "@/components/mixer/tag-panel";
import { formatCatalogId, formatWorkLabel } from "@/lib/catalog";
import { formatDuration } from "@/lib/format";
import {
  LOAD_SECONDS,
  MAX_TRACKS,
  MAX_REPEATS,
  MIN_TRACKS,
  planTimes,
  prepareSongs,
  renderSet,
  type MixPlan,
  type SongAnalysis,
} from "@/lib/mixer/engine";
import { detectKey } from "@/lib/mixer/key";
import { listMixes, saveMix, type SavedMix } from "@/lib/mixer/library";
import { loadDeck, MIX_SAMPLE_RATE } from "@/lib/mixer/load";
import {
  bestOpener,
  fixScript,
  rulesScript,
  type Energy,
  type Fx,
  type Layer,
  type LayerStyle,
  type MixMinutes,
  type Move,
  type SetScript,
  type SongBrief,
} from "@/lib/mixer/script";
import { analyzeStructure } from "@/lib/mixer/structure";
import { decodeTag, loadTag, type SavedTag } from "@/lib/mixer/tag";
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
  {
    value: "lounge",
    label: "Lounge",
    note: "A touch slower and warm. Long parts melting over 8-bar blends, lines from one song floating over another in echo. No extra drums.",
  },
  {
    value: "club",
    label: "Club",
    note: "Songs trade bars in call and response, lines from the next song arrive before it does, the strongest hook keeps coming back.",
  },
  {
    value: "peak",
    label: "Peak",
    note: "Pushed faster and harder. Short parts traded bar by bar, chopped vocal hooks, loop builds and drops.",
  },
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
  trade: "trades bars with the last song",
  cut: "drops in on a cut",
  flow: "plays on",
};

const STYLE_LABEL: Record<LayerStyle, string> = { lift: "lifted", chop: "chopped", echo: "in echo" };

type Stage =
  | { kind: "idle" }
  | { kind: "working"; step: string; progress: number }
  | {
      kind: "done";
      url: string;
      plan: MixPlan;
      seconds: number;
      set: MixSource[];
      dj: string | null;
      saved: boolean;
      // Why the Mixer's own rules planned it, when the DJ brain was asked but
      // didn't answer.
      brainMiss: string | null;
    }
  | { kind: "error"; message: string };

function fxLabel(fx: Fx): string {
  const on: string[] = [];
  if (fx.breakdown) on.push("breakdown");
  if (fx.filterRise) on.push("filter rise");
  if (fx.loopBuild) on.push("loop build");
  if (fx.riser && !fx.loopBuild) on.push("riser");
  if (fx.drop || fx.loopBuild) on.push("drop");
  if (fx.kick) on.push("kick");
  if (fx.claps) on.push("claps");
  return on.length ? ` · ${on.join(", ")}` : "";
}

function layerLabel(l: Layer, set: MixSource[]): string {
  return `+ a line from "${set[l.song]?.title ?? "?"}", ${STYLE_LABEL[l.style]}${l.times > 1 ? ` ×${l.times}` : ""}`;
}

function names(s: MixSource): string {
  return s.contributors.map((c) => c.name).join(", ") || "AIRED";
}

const MISS_TEXT: Record<string, string> = {
  off: "The DJ brain isn't switched on for AIRED yet, so the Mixer's own rules planned this one and your vibe wasn't used.",
  busy: "The DJ brain was busy with too many plans in a minute, so the Mixer's own rules planned this one. Try again in a minute.",
  slow: "The DJ brain took too long to answer, so the Mixer's own rules planned this one and your vibe wasn't used. Try Mix again.",
  error: "The DJ brain couldn't be reached, so the Mixer's own rules planned this one and your vibe wasn't used. Try Mix again.",
};

// Ideas for the vibe box. Tapping one writes it in; the brain follows it.
const REMIX_IDEAS = [
  "Extended club version: long intro, slow build, one huge drop",
  "Dub version: stripped to the beat, the voice thrown into echoes",
  "Chop the hook and keep bringing it back",
  "Start in a breakdown, end in the full chorus",
  "Late night, dark and hypnotic, few words",
];
const SET_IDEAS = [
  "Sunset: start soft, climb slowly, euphoric peak at the end",
  "Keep the strongest hook running through every song",
  "Lots of call and response between the songs",
  "Hypnotic and deep, long blends, no big drops",
];

const tick = () => new Promise((r) => setTimeout(r, 20)); // let the label paint

export function MixerStudio({ sources, initialIds }: { sources: MixSource[]; initialIds?: number[] }) {
  // A song's "Mix it" button opens the Mixer with that song in the set.
  const [setIds, setSetIds] = useState<number[]>(initialIds ?? sources.slice(0, 2).map((s) => s.id));
  const [energy, setEnergy] = useState<Energy>("club");
  const [minutes, setMinutes] = useState<MixMinutes>(5);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [vibe, setVibe] = useState("");
  const [useBrain, setUseBrain] = useState(true);
  const [autoOrder, setAutoOrder] = useState(true);
  const [tag, setTag] = useState<SavedTag | null>(null);
  const [useTag, setUseTag] = useState(false);
  const [mixes, setMixes] = useState<SavedMix[]>([]);
  const refreshMixes = () => void listMixes().then(setMixes);
  useEffect(() => {
    void loadTag().then((t) => {
      setTag(t);
      setUseTag(!!t);
    });
    void listMixes().then(setMixes);
  }, []);
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
    setSetIds((ids) =>
      ids.filter((x) => x === id).length >= MAX_REPEATS || ids.length >= MAX_TRACKS ? ids : [...ids, id],
    );
  }
  function remove(i: number) {
    setSetIds((ids) => ids.filter((_, k) => k !== i));
  }
  function move(i: number, dir: -1 | 1) {
    setSetIds((ids) => {
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return ids;
      const out = [...ids];
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    });
  }

  async function makeMix() {
    if (set.length < MIN_TRACKS) return;
    // A song added more than once is listened to once and gets that many
    // shares of the set.
    let tracks = set.filter((s, i) => set.findIndex((t) => t.id === s.id) === i);
    let plays = tracks.map((t) => set.filter((s) => s.id === t.id).length);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const n = tracks.length;
    // Listening (fetch + analyse) takes the first 60% of the bar.
    const slice = 0.6 / n;
    const show = (step: string, progress: number) => setStage({ kind: "working", step, progress });
    try {
      // 1. Listen to every song once: beat, key, phrases. Only the analysis and
      //    the compressed audio are kept; the decoded song is let go.
      const analyses: SongAnalysis[] = [];
      for (let i = 0; i < n; i++) {
        const s = tracks[i];
        const base = i * slice;
        show(`Listening to ${s.title}`, base);
        const deck = await loadDeck(s.hlsPlaylistKey, LOAD_SECONDS, {
          signal: ac.signal,
          onProgress: (f) => show(`Listening to ${s.title}`, base + f * slice * 0.6),
        });
        if (ac.signal.aborted) return;
        show(`Hearing the beat, key and parts of ${s.title}`, base + slice * 0.7);
        await tick();
        const tempo = detectTempo(deck.buffer);
        const structure = analyzeStructure(deck.buffer, tempo);
        const key = detectKey(deck.buffer);
        analyses.push({ title: s.title, tempo, structure, key, duration: deck.seconds, adts: deck.adts });
      }
      let briefs = analyses.map((a, i) => ({ ...toBrief(a, tracks[i]), plays: plays[i] }));
      // Let the Mixer pick the opener whose key and tempo flow best into the
      // others; the planners then find the smoothest order from it.
      if (autoOrder && tracks.length > 1) {
        const o = bestOpener(briefs, energy);
        const front = <T,>(xs: T[]) => [xs[o], ...xs.filter((_, i) => i !== o)];
        tracks = front(tracks);
        plays = front(plays);
        analyses.splice(0, analyses.length, ...front(analyses));
        briefs = front(briefs);
      }
      const remix = tracks.length === 1;
      const energyLabel = ENERGIES.find((e) => e.value === energy)?.label ?? energy;

      // 2. Plan the set: the DJ brain if it's reachable, else the built-in rules.
      let script: SetScript | null = null;
      let brainMiss: string | null = null;
      if (useBrain) {
        show(vibe.trim() ? "The DJ brain is planning your set from your vibe" : "The DJ brain is planning your set", 0.62);
        const asked = await askBrain(tracks, analyses, briefs, energy, minutes, vibe, ac.signal);
        if (ac.signal.aborted) return;
        script = asked.script;
        brainMiss = asked.script ? null : MISS_TEXT[asked.reason] ?? MISS_TEXT.error;
      }
      script = fixScript(script ?? rulesScript(briefs, energy, minutes), briefs, energy, minutes);

      // 3. Decode only the parts the plan uses, then mix.
      show("Cueing up the parts", 0.7);
      const prepared = await prepareSongs(analyses, script, (f) => show("Cueing up the parts", 0.7 + f * 0.1));
      if (ac.signal.aborted) return;
      show("Mixing the set", 0.82);
      await tick();
      const plan = planTimes(script, analyses, prepared);
      const signed = useTag && tag ? await decodeTag(tag.audio, MIX_SAMPLE_RATE) : null;
      const dj = useTag && tag?.name ? tag.name : null;
      const buffer = await renderSet(prepared, plan, energy, signed);
      if (ac.signal.aborted) return;

      show("Packing the file", 0.96);
      await tick();
      const blob = encodeWav(buffer, {
        title: remix ? `${plan.title} (AIRED ${energyLabel} Remix)` : `${plan.title} (AIRED Mix)`,
        artist: tracks.map(names).join(" × "),
        comment:
          `AIRED Mix. Built from ` +
          tracks.map((t) => `${formatWorkLabel(t.id, t.title)} by ${names(t)}`).join("; ") +
          `. ${dj ? `Mixed by ${dj}. ` : ""}${plan.by === "brain" ? "Planned by the AIRED DJ brain (Claude, Anthropic)" : "Planned by the AIRED Mixer"}; beat-matched and mixed by the AIRED Mixer. ai-red.io`,
        software: "AIRED Mixer",
        setList: plan.visits
          .map(
            (v) =>
              `${formatDuration(Math.round(v.at))} ${tracks[v.song]?.title ?? "?"} (from ${formatDuration(Math.round(v.sourceStart))}, ${v.bars} bars) · ${MOVE_LABEL[v.move]}${fxLabel(v.fx)}${v.layers.length ? ` · ${v.layers.length} line${v.layers.length > 1 ? "s" : ""}` : ""}`,
          )
          .join("\n"),
      });
      // Keep it in MixaTee, on this device, with every credit.
      const saved = await saveMix(
        {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          title: remix ? `${plan.title} · ${energyLabel} remix` : plan.title,
          createdAt: Date.now(),
          seconds: buffer.duration,
          bpm: plan.bpm,
          energy: energyLabel,
          dj,
          story: plan.story || null,
          plannedBy: plan.by,
          credits: tracks.map((t) => ({ label: formatWorkLabel(t.id, t.title), by: names(t) })),
          makers: [...new Set(tracks.flatMap((t) => t.contributors.map((c) => c.name)))],
          sourceWorkIds: tracks.map((t) => t.id),
        },
        blob,
      ).then(
        () => true,
        () => false,
      );
      if (ac.signal.aborted) return;
      if (saved) refreshMixes();
      setStage({
        kind: "done",
        url: URL.createObjectURL(blob),
        plan,
        seconds: buffer.duration,
        set: tracks,
        dj,
        saved,
        brainMiss,
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
      <ClubDecks set={set} busy={busy} />
      <SetList set={set} onRemove={remove} onMove={move} disabled={busy} autoOrder={autoOrder} />

      <label className="-mt-3 flex items-start gap-2 px-1 text-sm text-foreground">
        <input
          type="checkbox"
          checked={autoOrder}
          onChange={(e) => setAutoOrder(e.target.checked)}
          disabled={busy}
          className="mt-0.5 size-4 accent-white"
        />
        <span>
          Let the Mixer choose the order
          <span className="block text-xs text-muted">
            It picks the opener and the order whose keys and tempos flow best, so songs collide less. Turn off to keep
            your order.
          </span>
        </span>
      </label>

      <SongPicker
        sources={sources}
        inSet={setIds}
        full={setIds.length >= MAX_TRACKS}
        onAdd={add}
        disabled={busy}
      />

      <Choice legend="Energy" options={ENERGIES} value={energy} onChange={setEnergy} disabled={busy} />
      <Choice legend="Length" options={MINUTES} value={minutes} onChange={setMinutes} disabled={busy} />

      <fieldset className="flex flex-col gap-2" disabled={busy}>
        <legend className="mb-1 text-sm font-semibold text-foreground">DJ brain</legend>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={useBrain}
            onChange={(e) => setUseBrain(e.target.checked)}
            className="size-4 accent-white"
          />
          Let the DJ brain plan the set
        </label>
        <p className="text-xs text-muted">
          It picks the order, the parts, the moves and the big moments, mixing in key, and tells you
          why. It reads the box below and follows it, in English or Arabic: the mood, the pace, the
          line you love, how it should end. If it can&apos;t be reached, the Mixer plans the set
          itself and tells you so.
        </p>
        {useBrain ? (
          <div className="flex flex-wrap gap-1.5">
            {(set.length > 0 && set.every((s) => s.id === set[0].id) ? REMIX_IDEAS : SET_IDEAS).map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => setVibe(idea)}
                className={`rounded-full border px-2.5 py-1 text-xs transition ${
                  vibe === idea ? "border-white/40 text-foreground" : "border-white/10 text-muted hover:border-white/25 hover:text-foreground"
                }`}
              >
                {idea}
              </button>
            ))}
          </div>
        ) : null}
        {useBrain ? (
          <input
            type="text"
            value={vibe}
            maxLength={300}
            onChange={(e) => setVibe(e.target.value)}
            placeholder="The vibe, in any words: sunset, slow climb to a euphoric peak…"
            className="rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted/60 focus:border-white/30 focus:outline-none"
          />
        ) : null}
      </fieldset>

      <TagPanel key={tag ? "tag" : "none"} tag={tag} onTag={setTag} useTag={useTag} onUseTag={setUseTag} disabled={busy} />

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void makeMix()}
          disabled={!ready}
          className="club-go rounded-lg bg-foreground px-5 py-3 text-sm font-semibold text-background transition hover:brightness-95 active:scale-[0.99] disabled:opacity-40"
        >
          {busy ? "Mixing…" : stage.kind === "done" ? "Mix again" : "Mix it"}
        </button>
        {set.length < MIN_TRACKS ? (
          <p className="text-xs text-muted">Add a song. One song on its own becomes a remix in the mood you pick.</p>
        ) : null}
      </div>

      {stage.kind === "working" ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          <p className="text-sm text-foreground">{stage.step}…</p>
          <div className="h-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="club-progress h-full bg-foreground/80 transition-[width]"
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

      <MixaTeeShelf mixes={mixes} onChange={refreshMixes} />
    </div>
  );
}

// The numbers the planners work from. Energy and bass are ranked 0–9 within
// each song so songs mastered at different loudness compare fairly.
function toBrief(a: SongAnalysis, s: MixSource): SongBrief {
  const ph = a.structure.phrases;
  const maxR = Math.max(1e-9, ...ph.map((p) => p.rms));
  const maxL = Math.max(1e-9, ...ph.map((p) => p.low));
  const maxV = Math.max(1e-9, ...ph.map((p) => p.vocal));
  return {
    title: s.title,
    makers: s.contributors.map((c) => c.name),
    descriptors: [],
    bpm: a.tempo.bpm,
    key: a.key,
    duration: a.duration,
    phrases: ph.map((p) => ({
      start: p.start,
      label: p.label,
      energy: Math.round((p.rms / maxR) * 9),
      bass: Math.round((p.low / maxL) * 9),
      vocal: Math.round((p.vocal / maxV) * 9),
      lines: p.lines,
    })),
  };
}

async function askBrain(
  tracks: MixSource[],
  analyses: SongAnalysis[],
  briefs: SongBrief[],
  energy: Energy,
  minutes: MixMinutes,
  vibe: string,
  signal: AbortSignal,
): Promise<{ script: SetScript | null; reason: string }> {
  try {
    const res = await fetch("/api/mix/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        vibe: vibe.trim(),
        energy,
        minutes,
        songs: tracks.map((t, i) => ({
          id: t.id,
          bpm: analyses[i].tempo.bpm,
          tonic: analyses[i].key.tonic,
          minor: analyses[i].key.minor,
          keyConfidence: analyses[i].key.confidence,
          duration: briefs[i].duration,
          phrases: briefs[i].phrases,
          plays: briefs[i].plays ?? 1,
        })),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { ai?: boolean; script?: SetScript; reason?: string };
    if (res.status === 429) return { script: null, reason: "busy" };
    if (res.status >= 500) return { script: null, reason: "slow" };
    if (data.ai && data.script) return { script: data.script, reason: "ok" };
    return { script: null, reason: data.reason ?? "error" };
  } catch {
    return { script: null, reason: "error" };
  }
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
    <section className="club-result flex flex-col gap-4 rounded-2xl border border-white/12 bg-white/[0.03] p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">{plan.title}</h2>
        <p className="text-xs text-muted">
          {set.length === 1 ? "AIRED Remix" : "AIRED Mix"} · {formatDuration(Math.round(stage.seconds))} · {Math.round(plan.bpm)} BPM ·{" "}
          {plan.visits.length} parts ·{" "}
          {plan.by === "brain" ? "planned by the DJ brain" : "planned by the Mixer's own rules"}
        </p>
        {plan.story ? <p className="mt-1 text-sm text-foreground/90">{plan.story}</p> : null}
        {stage.brainMiss ? <p className="mt-1 text-xs text-muted">{stage.brainMiss}</p> : null}
      </div>

      {/* Its own element, scoped to this page. Pressing play here pauses the
          global player so two things never sound at once. */}
      <audio controls src={stage.url} onPlay={onPlay} className="w-full" />

      <div className="flex flex-wrap items-center gap-3">
        <a
          href={stage.url}
          download={fileName}
          className="rounded-lg border border-white/15 px-4 py-2.5 text-sm font-medium text-foreground transition hover:border-white/30"
        >
          Download WAV
        </a>
        <Mp3Button
          getWav={() => fetch(stage.url).then((r) => r.blob())}
          fileName={fileName.replace(/\.wav$/, "")}
          className="rounded-lg border border-white/15 px-4 py-2.5 text-sm font-medium text-foreground transition hover:border-white/30 disabled:opacity-60"
        />
        <span className="text-xs text-muted">
          {stage.saved
            ? "Saved in your MixaTee below."
            : "Couldn't save it in MixaTee on this device (storage may be full). Download it to keep it."}
        </span>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-white/8 pt-4">
        <p className="text-xs font-medium text-foreground">How the set runs</p>
        <ol className="flex flex-col gap-1 text-xs text-muted">
          {plan.visits.map((v, i) => (
            <li key={i} className="flex gap-3">
              <span className="w-10 shrink-0 tabular-nums text-foreground/80">
                {formatDuration(Math.round(v.at))}
              </span>
              <span className="flex min-w-0 flex-col">
                <span>
                  {set[v.song].title}{" "}
                  <span className="text-muted/70">
                    (from {formatDuration(Math.round(v.sourceStart))}, {v.bars} bars) · {MOVE_LABEL[v.move]}
                    {fxLabel(v.fx)}
                  </span>
                </span>
                {v.layers.map((l, k) => (
                  <span key={k} className="text-muted/80">
                    {layerLabel(l, set)}
                  </span>
                ))}
                {v.note ? <span className="text-muted/70 italic">{v.note}</span> : null}
              </span>
            </li>
          ))}
        </ol>
        <ul className="mt-2 flex flex-col gap-0.5 text-xs text-muted/80">
          {plan.songs.map((t, i) => {
            const nudge = (t.rate - 1) * 100;
            return (
              <li key={i}>
                {t.title}: {Math.round(t.bpm)} BPM · key {t.key.name} ({t.key.camelot})
                {plan.visits[0]?.song === i
                  ? " · opens the set and sets the tempo"
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
        <p>
          Mixed by {stage.dj ?? "you"} ·{" "}
          {plan.by === "brain" ? "set planned by the AIRED DJ brain (Claude, Anthropic) · " : ""}
          beat-matched and mixed by the AIRED Mixer
        </p>
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
  autoOrder,
}: {
  set: MixSource[];
  onRemove: (i: number) => void;
  onMove: (i: number, dir: -1 | 1) => void;
  disabled: boolean;
  autoOrder: boolean;
}) {
  const remix = set.length > 0 && set.every((s) => s.id === set[0].id);
  return (
    <fieldset className="flex flex-col gap-2 rounded-2xl border border-white/10 p-4" disabled={disabled}>
      <legend className="px-1 text-sm font-semibold text-foreground">
        Your set{" "}
        <span className="font-normal text-muted">
          · {set.length} of {MAX_TRACKS} ·{" "}
          {remix
            ? "one song: the Mixer remixes it"
            : autoOrder
              ? "the Mixer picks the opener and order"
              : "the first song opens and sets the tempo"}
        </span>
      </legend>
      {set.length === 0 ? <p className="px-1 text-xs text-muted">Add songs from the list below.</p> : null}
      <ol className="flex flex-col gap-1">
        {set.map((s, i) => (
          <li key={`${s.id}-${i}`} className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2 py-1.5">
            <span className="w-5 shrink-0 text-center text-xs text-muted">{i + 1}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm text-foreground">{s.title}</span>
              <span className="truncate text-xs text-muted">
                {formatCatalogId(s.id)} · {names(s)}
              </span>
            </span>
            <IconButton label="Move up" onClick={() => onMove(i, -1)} disabled={i === 0}>
              ↑
            </IconButton>
            <IconButton label="Move down" onClick={() => onMove(i, 1)} disabled={i === set.length - 1}>
              ↓
            </IconButton>
            <IconButton label="Remove" onClick={() => onRemove(i)}>
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
        Add songs{" "}
        <span className="font-normal text-muted">
          · 1 to {MAX_TRACKS} · add a song up to {MAX_REPEATS} times to hear it more
        </span>
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
          const count = inSet.filter((x) => x === s.id).length;
          const maxed = count >= MAX_REPEATS;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onAdd(s.id)}
                disabled={maxed || full}
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
                  {count > 0 ? `In the set${count > 1 ? ` ×${count}` : ""} ✓${maxed || full ? "" : " · + again"}` : full ? "" : "+ Add"}
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
    <fieldset className="club-choice flex flex-col gap-2" disabled={disabled}>
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
