"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// The search field on the listener's door. Server-rendered Home reads `?q=`,
// so we just keep the URL in sync as the user types — debounced so we don't
// hammer the server. Always routes results to `/` because that's where the
// feed and the cards live.
export function SearchBar({
  initial = "",
  placeholder = "Search by title, AIRED-####, or contributor",
  autoFocus = false,
  size = "md",
  className = "",
}: {
  initial?: string;
  placeholder?: string;
  autoFocus?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initial);
  const lastPushed = useRef(initial);

  // Keep input in sync if the URL changes from elsewhere (back/forward).
  useEffect(() => {
    const next = searchParams.get("q") ?? "";
    if (next !== lastPushed.current) {
      lastPushed.current = next;
      setValue(next);
    }
  }, [searchParams]);

  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed === lastPushed.current.trim()) return;
    const handle = setTimeout(() => {
      lastPushed.current = trimmed;
      const target =
        pathname === "/" ? "/" : "/"; // search always lands on the door
      const url = trimmed ? `${target}?q=${encodeURIComponent(trimmed)}` : target;
      router.replace(url, { scroll: false });
    }, 200);
    return () => clearTimeout(handle);
  }, [value, pathname, router]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    // No JS form GET — the router handles navigation. Prevent a page reload.
    e.preventDefault();
    const trimmed = value.trim();
    lastPushed.current = trimmed;
    router.push(trimmed ? `/?q=${encodeURIComponent(trimmed)}` : "/", {
      scroll: false,
    });
  }

  const padding = size === "sm" ? "px-3 py-1.5 text-sm" : "px-4 py-2.5 text-base";

  return (
    <form
      action="/"
      role="search"
      onSubmit={onSubmit}
      className={`relative flex-1 ${className}`}
    >
      <label className="sr-only" htmlFor="aired-search">
        Search AIRED
      </label>
      <input
        id="aired-search"
        type="search"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        autoFocus={autoFocus}
        className={`w-full rounded-lg border border-white/10 bg-white/5 ${padding} text-foreground outline-none transition placeholder:text-muted/60 focus:border-cert-red/60 focus:bg-white/[0.07] focus:ring-1 focus:ring-cert-red/40`}
      />
    </form>
  );
}
