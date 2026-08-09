"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The two shelves, side by side, at the top of each of them.
//
// On a phone the header carries ONE entry for both — Shelf — because three
// entries is the whole budget at 360px. That entry lands on Adorned, so Moods
// needs a way back into view: these tabs are it. Above sm: the header shows
// Adorned and Moods separately, so the tabs would only repeat what the rail
// already says, and they step aside.
//
// Neutral throughout — the current tab is marked by brightness and a lit
// surface, never by cert-red, which belongs to the Red Line and the lockup.

const SHELVES = [
  { href: "/adorned", label: "Adorned" },
  { href: "/moods", label: "Moods" },
];

export function ShelfTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Your shelves"
      className="mb-5 flex items-center gap-1 rounded-xl border border-white/8 bg-white/[0.02] p-1 sm:hidden"
    >
      {SHELVES.map((shelf) => {
        const active = pathname.startsWith(shelf.href);
        return (
          <Link
            key={shelf.href}
            href={shelf.href}
            aria-current={active ? "page" : undefined}
            className={`flex-1 rounded-lg px-3 py-2 text-center text-sm whitespace-nowrap transition ${
              active
                ? "bg-white/[0.08] font-medium text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {shelf.label}
          </Link>
        );
      })}
    </nav>
  );
}
