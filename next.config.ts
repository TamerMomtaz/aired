import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Version-skew protection (belt-and-suspenders for the PWA shell). On Vercel,
  // every deployment carries a unique VERCEL_DEPLOYMENT_ID; threading it into
  // Next's `deploymentId` makes Next stamp `?dpl=<id>` onto static-asset URLs
  // (cache-busting) and trigger a hard navigation whenever a still-open client's
  // build no longer matches the server's — so a slightly-stale client fetches
  // matching deployment assets instead of 404'd chunks. Undefined off-Vercel
  // (local dev), so it's a no-op there. NOTE: also turn on "Skew Protection" in
  // the Vercel project settings — that enables Vercel's edge routing to the
  // matching deployment and auto-wires the same id, complementing this.
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
  images: {
    // Artwork is served from the public Supabase Storage `artwork` bucket.
    // Scope the allow-list to public storage objects only. (Audio masters live
    // in a private bucket and are never rendered — Rule 6.)
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
