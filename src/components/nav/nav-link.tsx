"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// A nav item that knows whether it's the page you're standing on. SiteHeader is
// a server component (it reads the signed-in user), so the "you are here" logic
// lives here in a small client island that reads the current path.
//
// Why it exists: before this, the active page was dimmed like every other link
// while the red Upload CTA pulled the eye as if IT were the destination — so
// people tapped "Listen" just to confirm where they were. Now the current page
// is unmistakable: bright text under a cert-red underline (the Red Line doubling
// as a "you are here" mark). The Upload CTA keeps its red, but gains an active
// ring when you're actually on /upload so it reads as current, not merely primary.
//
// Match rule: "/" must match exactly — every path starts with "/" — while other
// hrefs match by prefix so /upload stays lit on /upload/anything.
export function NavLink({
  href,
  children,
  variant = "link",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "link" | "cta";
}) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);

  if (variant === "cta") {
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`rounded-md bg-cert-red px-3 py-1.5 font-medium text-white transition hover:brightness-110 ${
          active
            ? "ring-2 ring-white/70 ring-offset-2 ring-offset-background"
            : ""
        }`}
      >
        {children}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative rounded-md px-2.5 py-1.5 transition after:absolute after:inset-x-2.5 after:bottom-1 after:h-0.5 after:rounded-full after:bg-cert-red after:transition-opacity ${
        active
          ? "text-foreground after:opacity-100"
          : "text-muted hover:text-foreground after:opacity-0"
      }`}
    >
      {children}
    </Link>
  );
}
