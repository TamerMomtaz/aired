import type { MetadataRoute } from "next";

// The Web App Manifest — the thing that turns AIRED into an installable PWA.
// Once a visitor (and a service worker) is registered, Android/Chrome will offer
// a one-tap install; iOS reads the manifest for name/colors but uses the
// apple-touch icon for the home-screen image (see app/apple-icon.tsx and the
// appleWebApp block in app/layout.tsx).
//
// Icons are served from stable route handlers (app/icons/[name]/route.ts) so
// the URLs the manifest names never drift behind a content hash.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AIRED",
    short_name: "AIRED",
    description:
      "AI-ed and proud — music credited to human and AI, by name.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    categories: ["music"],
    orientation: "portrait",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
