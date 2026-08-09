"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// The phone nav's overflow door. Three entries hold the rail — Listen, Shelf,
// Upload — and everything a listener doesn't reach for on a phone lives behind
// this button: Downloads, Manage, Log out, and Review for an admin.
//
// It sits OUTSIDE the scrolling rail on purpose. The rail is an overflow-x
// scroll container (see .nav-rail), and a scroll container clips on BOTH axes —
// a panel opened from inside it would be cut off at the strip's edge. Anchoring
// the button beside the rail instead of within it also means the door never
// scrolls away from the thumb.
//
// Colour: neutral dark throughout. cert-red is the Red Line's and the lockup's
// (CLAUDE.md §1.3), and none of this chrome is either.

export type MoreItem = {
  href: string;
  label: string;
  // A waiting-count, shown as a neutral chip. Deliberately not the rail's red
  // pill: this menu is new chrome, and new chrome doesn't spend cert-red.
  count?: number;
};

export function NavMore({
  items,
  footer,
  className = "",
}: {
  items: MoreItem[];
  // Trailing slot for the sign-out form, which is a server action and can't be
  // reduced to an href.
  footer?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Navigating away closes the door behind you. This adjusts state during
  // render rather than in an effect: an effect would paint the still-open menu
  // over the new page for a frame first, then cascade a second render.
  const [routeWhenRendered, setRouteWhenRendered] = useState(pathname);
  if (routeWhenRendered !== pathname) {
    setRouteWhenRendered(pathname);
    if (open) setOpen(false);
  }

  // Escape closes and hands focus back to the button; a tap anywhere else
  // closes without stealing focus.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More"
        className={`inline-flex size-9 items-center justify-center rounded-md transition ${
          open ? "bg-white/10 text-foreground" : "text-muted hover:text-foreground"
        }`}
      >
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          className="size-5"
          fill="currentColor"
        >
          <circle cx="4" cy="10" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="16" cy="10" r="1.6" />
        </svg>
      </button>

      {/* Solid, not translucent: a menu is read, not glanced past, and the
          catalog behind it must not show through the words. */}
      {open ? (
        <div
          role="menu"
          aria-label="More"
          className="absolute right-0 top-full z-30 mt-2 flex min-w-[11rem] flex-col gap-0.5 rounded-xl border border-white/12 bg-background p-1.5 shadow-2xl shadow-black/70"
        >
          {items.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                aria-current={active ? "page" : undefined}
                className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm whitespace-nowrap transition ${
                  active
                    ? "bg-white/[0.07] text-foreground"
                    : "text-muted hover:bg-white/[0.05] hover:text-foreground"
                }`}
              >
                {item.label}
                {item.count && item.count > 0 ? (
                  <span className="rounded-full bg-white/12 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-foreground">
                    {item.count}
                  </span>
                ) : null}
              </Link>
            );
          })}
          {footer ? (
            <div className="mt-0.5 border-t border-white/8 pt-1.5">{footer}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
