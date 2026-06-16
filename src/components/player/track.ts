import type { FeedWork } from "@/lib/works/queries";

// What the global player needs to play and present one work. This is a plain,
// serializable shape so Server Components can build it and hand it to the client
// engine as props.
//
// Contributor names are PUBLIC and CELEBRATED (CLAUDE.md §3a): they appear in the
// now-playing bar and as the OS media-session "artist" line. They are who MADE the
// track — never a style descriptor (which is the only kind of name AIRED forgets).
export type Track = {
  id: number;
  title: string;
  hlsPlaylistKey: string | null;
  artworkUrl: string | null;
  durationSeconds: number | null;
  contributors: { name: string; profile_slug: string | null }[];
};

// Map a feed/search card row to a player Track so the whole feed is one tap away
// from the queue.
export function trackFromFeedWork(work: FeedWork): Track {
  return {
    id: work.id,
    title: work.title,
    hlsPlaylistKey: work.hls_playlist_key,
    artworkUrl: work.artwork_url,
    durationSeconds: work.duration_seconds,
    contributors: work.contributors,
  };
}
