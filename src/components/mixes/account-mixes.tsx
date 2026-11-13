"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { usePlayer } from "@/components/player/player-provider";
import type { Track } from "@/components/player/track";
import { formatDuration } from "@/lib/format";
import { mixPlayerId } from "@/lib/mixer/library";
import type { AccountMix } from "@/lib/mixes/types";

function toTrack(m: AccountMix): Track {
  const makers = [...new Set(m.credits.flatMap((c) => c.by.split(", ")))];
  return {
    id: mixPlayerId(m.id),
    title: m.title,
    hlsPlaylistKey: m.hls_playlist_key,
    artworkUrl: null,
    durationSeconds: Math.round(m.duration_seconds),
    contributors: [...(m.dj_name ? [m.dj_name] : []), ...makers.filter((n) => n !== m.dj_name)].map((name) => ({
      name,
      profile_slug: null,
    })),
    mixId: m.id,
  };
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

// A list of account mixes. `owner` turns on rename, Share and Delete.
export function AccountMixes({ mixes, owner }: { mixes: AccountMix[]; owner: boolean }) {
  const router = useRouter();
  const { playQueue, current, isPlaying, toggle } = usePlayer();
  const [rows, setRows] = useState(mixes);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState(mixes);
  if (synced !== mixes) {
    setSynced(mixes);
    setRows(mixes);
  }

  // A mix that's still being turned into a stream: look again shortly.
  const preparing = rows.some((m) => !m.hls_playlist_key);
  useEffect(() => {
    if (!preparing) return;
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [preparing, router]);

  const ready = rows.filter((m) => m.hls_playlist_key);

  function play(m: AccountMix) {
    const tracks = ready.map(toTrack);
    const at = ready.findIndex((r) => r.id === m.id);
    if (at >= 0) playQueue(tracks, at);
  }

  async function patch(m: AccountMix, body: { title?: string; shared?: boolean }) {
    setError(null);
    const res = await fetch(`/api/mixes/${m.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res?.ok) return setError("That change didn't save. Try again.");
    setRows((rs) => rs.map((r) => (r.id === m.id ? { ...r, ...body } : r)));
  }

  async function remove(m: AccountMix) {
    if (confirm !== m.id) return setConfirm(m.id);
    setConfirm(null);
    const res = await fetch(`/api/mixes/${m.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return setError("Couldn't delete that mix.");
    setRows((rs) => rs.filter((r) => r.id !== m.id));
    if (!owner) return;
    router.refresh();
  }

  async function share(m: AccountMix) {
    const url = `${window.location.origin}/mixes/${m.id}`;
    try {
      if (navigator.share) await navigator.share({ title: m.title, url });
      else await navigator.clipboard.writeText(url);
      setCopied(m.id);
    } catch {
      // The person closed the share sheet.
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {rows.map((m) => {
          const playing = current?.mixId === m.id;
          return (
            <li
              key={m.id}
              className={`flex flex-col gap-3 rounded-2xl border p-4 ${playing ? "border-cert-red/50 bg-cert-red/[0.05]" : "border-white/10 bg-white/[0.02]"}`}
            >
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => (playing ? toggle() : play(m))}
                  disabled={!m.hls_playlist_key}
                  aria-label={playing && isPlaying ? `Pause ${m.title}` : `Play ${m.title}`}
                  className="flex size-11 shrink-0 items-center justify-center rounded-full bg-foreground text-sm text-background disabled:opacity-30"
                >
                  {playing && isPlaying ? "❚❚" : "▶"}
                </button>
                <div className="flex min-w-0 flex-1 flex-col">
                  {owner ? (
                    <input
                      key={m.title}
                      defaultValue={m.title}
                      maxLength={120}
                      aria-label="Mix name"
                      onBlur={(e) => {
                        const t = e.target.value.trim();
                        if (t && t !== m.title) void patch(m, { title: t });
                        else e.target.value = m.title;
                      }}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      className="w-full truncate bg-transparent text-sm font-medium text-foreground focus:outline-none"
                    />
                  ) : (
                    <Link href={`/mixes/${m.id}`} className="truncate text-sm font-medium text-foreground">
                      {m.title}
                    </Link>
                  )}
                  <span className="truncate text-xs text-muted">
                    {m.hls_playlist_key ? formatDuration(Math.round(m.duration_seconds)) : "Getting it ready to stream…"}
                    {m.energy ? ` · ${m.energy}` : ""}
                    {m.bpm ? ` · ${Math.round(m.bpm)} BPM` : ""} · {dateFmt.format(new Date(m.created_at))}
                    {m.dj_name ? ` · mixed by ${m.dj_name}` : ""}
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted/80">
                {m.credits.map((c, i) => (
                  <span key={c.work_id}>
                    {i > 0 ? " · " : ""}
                    <Link href={`/registry/${c.work_id}`} className="hover:text-foreground">
                      {c.label}
                    </Link>{" "}
                    by {c.by}
                  </span>
                ))}
              </p>
              {owner ? (
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-foreground">
                    <input
                      type="checkbox"
                      checked={m.shared}
                      onChange={(e) => void patch(m, { shared: e.target.checked })}
                      className="size-4 accent-white"
                    />
                    Share: anyone with the link can play it
                  </label>
                  {m.shared ? (
                    <button
                      type="button"
                      onClick={() => void share(m)}
                      className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-foreground hover:border-white/30"
                    >
                      {copied === m.id ? "Link copied ✓" : "Share link"}
                    </button>
                  ) : null}
                  <Link href={`/mixes/${m.id}`} className="text-xs text-muted hover:text-foreground">
                    Open
                  </Link>
                  <button
                    type="button"
                    onClick={() => void remove(m)}
                    onBlur={() => setConfirm(null)}
                    className="text-xs text-muted hover:text-foreground"
                  >
                    {confirm === m.id ? "Tap again to delete" : "Delete"}
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? <p className="text-xs text-muted">{error}</p> : null}
    </div>
  );
}
