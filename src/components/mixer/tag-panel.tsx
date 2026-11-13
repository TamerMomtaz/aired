"use client";

import { useEffect, useRef, useState } from "react";

import { usePlayer } from "@/components/player/player-provider";
import { MIX_SAMPLE_RATE } from "@/lib/mixer/load";
import { decodeTag, deleteTag, saveTag, TAG_MAX_SECONDS, type SavedTag } from "@/lib/mixer/tag";

// Record (or pick) the mixer's DJ tag, name it, hear it, and choose whether
// this mix carries it. The recording stays on this device.
export function TagPanel({
  tag,
  onTag,
  useTag,
  onUseTag,
  disabled,
}: {
  tag: SavedTag | null;
  onTag: (t: SavedTag | null) => void;
  useTag: boolean;
  onUseTag: (on: boolean) => void;
  disabled: boolean;
}) {
  const [name, setName] = useState(tag?.name ?? "");
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { pause } = usePlayer();

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      recRef.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  async function keep(audio: Blob) {
    const t = { name: name.trim().slice(0, 40), audio };
    if (!(await decodeTag(audio, MIX_SAMPLE_RATE))) {
      setError("That recording came out silent. Try again a little closer to the mic.");
      return;
    }
    await saveTag(t).catch(() => setError("Couldn't save the tag on this device."));
    onTag(t);
    onUseTag(true);
  }

  async function record() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        if (timerRef.current) clearTimeout(timerRef.current);
        void keep(new Blob(chunks, { type: rec.mimeType }));
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
      timerRef.current = setTimeout(() => rec.state === "recording" && rec.stop(), (TAG_MAX_SECONDS + 1) * 1000);
    } catch {
      setError("The microphone isn't available. Allow it in the browser, or pick a recording instead.");
    }
  }

  function stop() {
    if (recRef.current?.state === "recording") recRef.current.stop();
  }

  async function listen() {
    if (!tag) return;
    const buf = await decodeTag(tag.audio, MIX_SAMPLE_RATE);
    if (!buf) return;
    pause();
    const ctx = new AudioContext();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => void ctx.close();
    src.start();
  }

  async function rename(v: string) {
    if (!tag) return;
    const t = { ...tag, name: v.trim().slice(0, 40) };
    await saveTag(t).catch(() => {});
    onTag(t);
  }

  async function remove() {
    await deleteTag().catch(() => {});
    onTag(null);
    onUseTag(false);
  }

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-1 text-sm font-semibold text-foreground">Your DJ tag</legend>
      <p className="text-xs text-muted">
        Say your DJ name in your own voice, up to {TAG_MAX_SECONDS} seconds. It signs your mixes twice: in the
        first bars and just after the big drop, thrown into echo. It stays on this device.
      </p>
      <input
        type="text"
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        onBlur={(e) => void rename(e.target.value)}
        placeholder="Your DJ name, e.g. TeeJay"
        className="rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted/60 focus:border-white/30 focus:outline-none"
      />
      <div className="flex flex-wrap items-center gap-2">
        {recording ? (
          <button
            type="button"
            onClick={stop}
            className="rounded-lg border border-white/30 px-3 py-2 text-sm text-foreground"
          >
            ■ Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void record()}
            className="rounded-lg border border-white/15 px-3 py-2 text-sm text-foreground hover:border-white/30"
          >
            ● {tag ? "Record again" : "Record my tag"}
          </button>
        )}
        <label className="cursor-pointer rounded-lg border border-white/15 px-3 py-2 text-sm text-foreground hover:border-white/30">
          Pick a recording
          <input
            type="file"
            accept="audio/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void keep(f);
              e.target.value = "";
            }}
          />
        </label>
        {tag ? (
          <>
            <button
              type="button"
              onClick={() => void listen()}
              className="rounded-lg border border-white/15 px-3 py-2 text-sm text-foreground hover:border-white/30"
            >
              ▶ Hear it
            </button>
            <button type="button" onClick={() => void remove()} className="px-2 py-2 text-xs text-muted hover:text-foreground">
              Delete
            </button>
          </>
        ) : null}
      </div>
      {recording ? <p className="text-xs text-foreground">Recording… say it now.</p> : null}
      {tag ? (
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={useTag}
            onChange={(e) => onUseTag(e.target.checked)}
            className="size-4 accent-white"
          />
          Sign this mix with my tag
        </label>
      ) : null}
      {error ? <p className="text-xs text-muted">{error}</p> : null}
    </fieldset>
  );
}
