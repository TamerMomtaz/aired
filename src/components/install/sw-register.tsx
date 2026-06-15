"use client";

import { useEffect } from "react";

// Registers /sw.js after the page is interactive. The SW file lives in /public
// (see public/sw.js) and is intentionally conservative — Supabase, R2/HLS,
// /auth, and every non-GET is never cached. Registration runs only in modern
// browsers that ship the API.
//
// updateViaCache: "none" forces the browser to revalidate sw.js on every page
// load — without it, an aggressive HTTP cache could pin a buggy worker for
// hours. The activate handler in sw.js already sweeps old caches, so a fresh
// SW takes over cleanly.

export function SwRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") {
      return;
    }

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch((err) => {
          console.warn("[AIRED] service worker registration failed", err);
        });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }
  }, []);

  return null;
}
