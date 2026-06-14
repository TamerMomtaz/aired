import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
