"use client";

import { track } from "@vercel/analytics";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import {
  INSTALL_SHOW_EVENT,
  setDismissed,
  useDismissed,
  usePlatform,
} from "./use-install-state";

// The install-coach. Platform-aware, dismissible, friendly.
//
//   - On Android / desktop Chrome the browser fires beforeinstallprompt — we
//     stash the event and show a clean one-tap "Install AIRED" button that
//     calls .prompt() on the stashed event.
//   - On iOS Safari there's no beforeinstallprompt and install is always
//     manual — we show a short card with the Share-then-Add-to-Home-Screen
//     steps and the iOS Share glyph.
//   - When the app is already installed (display-mode: standalone, or iOS's
//     navigator.standalone), it renders nothing.
//   - Dismissal is remembered in localStorage so the banner doesn't nag —
//     but the manual "Install app" trigger in the site header always
//     re-opens it via the INSTALL_SHOW_EVENT custom event.
//   - By default the banner only shows on the Listen home (/). Other pages
//     stay clean unless the manual trigger fires.

type DeferredPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallCoach() {
  const pathname = usePathname();
  const { mode, isStandalone } = usePlatform();
  const dismissed = useDismissed();
  const [deferred, setDeferred] = useState<DeferredPrompt | null>(null);
  const [forced, setForced] = useState(false);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as DeferredPrompt);
    };
    const onInstalled = () => {
      setDeferred(null);
      // Record the install. The browser fires `appinstalled` once per
      // successful add-to-home-screen (Android prompt accepted, or iOS/desktop
      // manual install), and InstallCoach mounts once in the layout — so this
      // counts each install exactly once. Event name only: no PII in the
      // payload.
      track("app_installed");
    };
    const onShow = () => {
      setDismissed(false);
      setForced(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener(INSTALL_SHOW_EVENT, onShow);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener(INSTALL_SHOW_EVENT, onShow);
    };
  }, []);

  if (isStandalone) return null;
  if (mode === "none") return null;
  if (!forced && pathname !== "/") return null;
  if (!forced && dismissed) return null;
  // On Android we need either a deferred prompt OR a manual force to show
  // anything useful — otherwise the install button has nothing to call.
  if (mode === "android" && !deferred && !forced) return null;

  const dismiss = () => {
    setDismissed(true);
    setForced(false);
  };

  const onInstallClick = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") {
        setDeferred(null);
        dismiss();
      }
    } catch (err) {
      console.warn("[AIRED] install prompt failed", err);
    }
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4 sm:bottom-6">
      <div
        role="dialog"
        aria-label="Install AIRED"
        className="pointer-events-auto w-full max-w-md rounded-2xl border border-cert-red/30 bg-background/95 p-4 shadow-[0_10px_40px_-12px_rgba(255,45,45,0.35)] backdrop-blur"
      >
        <div className="flex items-start gap-3">
          <div
            aria-hidden
            className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-cert-red shadow-[0_0_10px_2px_rgba(255,45,45,0.6)]"
          />
          <div className="flex-1">
            <div className="text-sm font-semibold tracking-wide text-foreground">
              Install AIRED
            </div>
            {mode === "android" ? (
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Add AIRED to your home screen for a full-screen, app-like
                listen.
              </p>
            ) : (
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Tap the Share icon{" "}
                <ShareGlyph className="mx-0.5 inline-block h-3.5 w-3.5 -translate-y-px align-middle text-cert-red" />{" "}
                in Safari, then choose{" "}
                <span className="font-medium text-foreground">
                  Add to Home Screen
                </span>
                .
              </p>
            )}

            <div className="mt-3 flex items-center gap-2">
              {mode === "android" && (
                <button
                  type="button"
                  onClick={onInstallClick}
                  disabled={!deferred}
                  className="rounded-lg bg-cert-red px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Install AIRED
                </button>
              )}
              <button
                type="button"
                onClick={dismiss}
                className="rounded-lg border border-white/12 px-3 py-1.5 text-xs text-muted transition hover:border-white/20 hover:text-foreground"
              >
                {mode === "android" ? "Not now" : "Got it"}
              </button>
            </div>

            {mode === "android" && !deferred && (
              <p className="mt-2 text-[11px] leading-snug text-muted/70">
                Your browser hasn&rsquo;t offered the install prompt yet — keep
                using AIRED for a minute and it&rsquo;ll appear here.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// The iOS Share glyph (square with an up-arrow). Inline SVG so it always
// matches the surrounding text color and doesn't depend on an emoji font.
function ShareGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v13" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}
