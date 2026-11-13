import type { Metadata } from "next";

import { MixerStudio, type MixSource } from "@/components/mixer/mixer-studio";
import { createClient } from "@/lib/supabase/server";
import { getFeed } from "@/lib/works/queries";

export const metadata: Metadata = {
  title: "Mix · AIRED",
  description:
    "Pick two to six AIRED songs and the Mixer weaves them into one long, beat-matched club set — right here, no outside tools.",
};

// The AIRED Mixer. The page only hands the live catalog to the studio; all the
// audio work happens in the listener's browser (src/lib/mixer), straight off the
// public HLS bucket. No backend, no schema change, no new cost.
export default async function MixPage() {
  const supabase = await createClient();
  const feed = await getFeed(supabase);
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
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
      <header className="mb-8 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">Mix</h1>
        <p className="text-sm text-muted">
          Pick two to six songs. The Mixer finds their beat, locks them to one
          tempo, and weaves them together part by part, like a club set, for
          five minutes or more. Every maker of every song stays credited on
          the mix.
        </p>
      </header>
      <MixerStudio sources={sources} />
    </main>
  );
}
