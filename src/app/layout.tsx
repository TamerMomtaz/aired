import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { InstallCoach } from "@/components/install/install-coach";
import { SwRegister } from "@/components/install/sw-register";
import { OfflineInit } from "@/components/offline/offline-init";
import { Onboarding } from "@/components/onboarding/onboarding";
import { NowPlayingBar } from "@/components/player/now-playing-bar";
import { PlayerProvider } from "@/components/player/player-provider";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://ai-red.io";
// The short tagline lives in the install-coach copy, the manifest, and the
// social share card. The longer page description (below) is what a search
// crawler or screen reader gets — same idea in a fuller sentence.
const SHARE_TAGLINE = "AI-ed and proud — music credited to human and AI, by name.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "AIRED — AI-ed and proud",
  description:
    "The first music platform where the AI is a named, credited collaborator. Human + AI music goes live in minutes, carried by the Volley Ledger and certified with the Red Line.",
  applicationName: "AIRED",
  // app/manifest.ts emits the Web App Manifest at /manifest.webmanifest; this
  // line wires it into <head>. appleWebApp covers what iOS reads instead
  // (Safari ignores the manifest's icons + colors for home-screen installs).
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "AIRED",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    type: "website",
    siteName: "AIRED",
    title: "AIRED — AI-ed and proud",
    description: SHARE_TAGLINE,
    url: SITE_URL,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "AIRED — AI-ed and proud",
    description: SHARE_TAGLINE,
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <body className="min-h-dvh antialiased">
        {/* The player provider wraps the persistent app shell so the single
            <audio> element survives navigation and keeps playing while the
            listener browses (Phase 5 — continuous play). */}
        <PlayerProvider>
          <div className="flex min-h-dvh flex-col">
            <SiteHeader />
            {children}
            <SiteFooter />
            <NowPlayingBar />
          </div>
        </PlayerProvider>
        {/* Above the player bar (z-30) and header (z-20): the first-visit
            onboarding takes over the whole screen for a brand-new visitor. */}
        <Onboarding />
        <SwRegister />
        <OfflineInit />
        <InstallCoach />
        {/* Vercel Web Analytics — privacy-friendly page views + custom events.
            Renders nothing; injects the collector script. Data only flows once
            Web Analytics is enabled for the project in the Vercel dashboard. */}
        <Analytics />
      </body>
    </html>
  );
}
