import type { Metadata } from "next";

import { DownloadsScreen } from "@/components/offline/downloads-screen";

// The Downloads library. The screen reads only from IndexedDB + Cache Storage, so
// this page works with the network fully off — the service worker serves the
// downloaded manifest + segments, and the global player plays them. No Supabase,
// no RLS, nothing server-side to reach offline.
export const metadata: Metadata = {
  title: "Downloads · AIRED",
  description: "Songs you've kept on this device — they play with no connection.",
};

export default function DownloadsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
      <DownloadsScreen />
    </main>
  );
}
