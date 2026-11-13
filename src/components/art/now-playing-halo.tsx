"use client";

import { usePlayer } from "@/components/player/player-provider";

// The song playing now washes the top of the page in its own colours: its
// cover, blurred into light, breathing slowly behind everything. It changes
// with the music, so the page's mood follows what is on. Nothing plays, no
// halo; the plain onyx shows through.
export function NowPlayingHalo() {
  const { current } = usePlayer();
  const src = current?.artworkUrl;
  if (!src) return null;
  return (
    <div
      key={src}
      aria-hidden
      className="now-playing-halo"
      style={{ backgroundImage: `url(${JSON.stringify(src)})` }}
    />
  );
}
