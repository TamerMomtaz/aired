"use client";

import { INSTALL_SHOW_EVENT, usePlatform } from "./use-install-state";

// The "Install app" entry in the site header. Dispatches the custom event the
// InstallCoach listens for — that clears the dismissal flag and forces the
// banner open even after the user said "Not now". Hides itself when the app
// is already installed (display-mode: standalone, or iOS's navigator.standalone)
// since there's nothing to install in that case.

export function InstallTrigger() {
  const { isStandalone } = usePlatform();

  if (isStandalone) return null;

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(INSTALL_SHOW_EVENT))}
      className="hidden rounded-md px-2.5 py-1.5 text-muted transition hover:text-foreground md:inline-flex"
      title="Install AIRED to your home screen"
    >
      Install app
    </button>
  );
}
