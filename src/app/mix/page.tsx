import type { Metadata } from "next";
import Link from "next/link";

import { MixerStudio, type MixSource } from "@/components/mixer/mixer-studio";
import { createClient } from "@/lib/supabase/server";
import { getFeed } from "@/lib/works/queries";

import "./club.css";

export const metadata: Metadata = {
  title: "Mix · AIRED",
  description:
    "Pick one to six AIRED songs and the Mixer weaves them into one long, beat-matched club set — right here, no outside tools.",
};

// The AIRED Mixer. The page only hands the live catalog to the studio; all the
// audio work happens in the listener's browser (src/lib/mixer), straight off the
// public HLS bucket. No backend, no schema change, no new cost.
// Every live song can be mixed, not only the newest page of the feed. The
// catalog is small enough to hand over whole; past this many the picker would
// need a server search instead.
const MIX_CATALOG_LIMIT = 2000;

export default async function MixPage({
  searchParams,
}: {
  // ?add=12 (or 12,40) opens the Mixer with those songs in the set: the "Mix
  // it" button on every song links here.
  searchParams: Promise<{ add?: string | string[] }>;
}) {
  const { add } = await searchParams;
  const supabase = await createClient();
  const feed = await getFeed(supabase, MIX_CATALOG_LIMIT);
  const sources: MixSource[] = feed
    .filter((w) => !!w.hls_playlist_key)
    .map((w) => ({
      id: w.id,
      title: w.title,
      artworkUrl: w.artwork_url,
      durationSeconds: w.duration_seconds,
      hlsPlaylistKey: w.hls_playlist_key,
      contributors: w.contributors,
    }));

  return (
    <main className="club-stage mx-auto w-full max-w-3xl flex-1 px-5 py-10">
      {/* Ibiza club booth (Tee, Nov 2026): lasers, neon, a real deck. Look only;
          the mixing itself lives in MixerStudio and src/lib/mixer. */}
      <div className="club-lights" aria-hidden>
        <span />
        <span />
        <span />
        <span />
      </div>
      <header className="club-hero mb-8 flex flex-col gap-2">
        <p className="club-kicker">AIRED · Live booth</p>
        <h1 className="club-title">MIX</h1>
        <p className="club-tagline">Your songs. One set. Your drop.</p>
        <p className="text-sm text-muted">
          Pick one to six songs (one song becomes a remix). The Mixer finds their beat, locks them to one
          tempo, and weaves them together part by part, like a club set, for
          five minutes or more. Every maker of every song stays credited on
          the mix.
        </p>
        <Link href="/mixes" className="club-pill mt-1 self-start">
          My mixes on AIRED
        </Link>
      </header>
      <MixerStudio sources={sources} initialIds={parseAdd(add, sources)} />
    </main>
  );
}

function parseAdd(add: string | string[] | undefined, sources: MixSource[]): number[] | undefined {
  const raw = (Array.isArray(add) ? add.join(",") : add ?? "").split(",");
  const known = new Set(sources.map((s) => s.id));
  const ids = raw.map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && known.has(n));
  return ids.length ? ids.slice(0, 6) : undefined;
}
