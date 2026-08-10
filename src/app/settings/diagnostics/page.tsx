import { DiagnosticsScreen } from "@/components/diagnostics/diagnostics-screen";

export const metadata = {
  title: "Player diagnostics · AIRED",
  // Unlisted on purpose: this is a workshop door, not a room in the house.
  robots: { index: false, follow: false },
};

// The player's black box, read back.
//
// ⚠ TEMPORARY. This route, the ⋯ door that reaches it, and the recorder behind
// it are instrumentation raised to catch ONE bug: audio dying in a car on a
// locked screen. They come down when that bug is closed. Scaffolding left
// standing becomes part of the building, and this is not part of the building.
// Removing it means: this page, src/components/diagnostics/, src/lib/
// diagnostics/, the Diagnostics entry in site-header.tsx, and the diag() calls
// threaded through player-provider.tsx.
//
// Deliberately NOT gated on auth or on admin. The log is written and stored
// entirely on the device that produced it — no server data, no other listener's
// anything — and the one time it matters most is the moment after playback died,
// which is not a good moment to discover you need to sign in first. It is kept
// out of reach instead by being unlisted: no nav entry for a listener, and a
// door in the ⋯ menu only an admin is shown.
export default function DiagnosticsPage() {
  return <DiagnosticsScreen />;
}
