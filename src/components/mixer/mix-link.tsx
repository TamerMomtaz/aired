import Link from "next/link";

// "Mix it": opens the Mixer with this song already in the set. It sits beside
// the ankh on cards, on the song page and in lists, so any song in AIRED is one
// tap from the Mixer. A plain link (no client state): the Mixer reads ?add=.

export function mixHref(workId: number): string {
  return `/mix?add=${workId}`;
}

export function MixLink({
  workId,
  title,
  variant = "icon",
  size = "md",
  className = "",
}: {
  workId: number;
  title: string;
  // "icon" for cards, lists and the player; "full" for a song page's action row.
  variant?: "icon" | "full";
  size?: "sm" | "md";
  className?: string;
}) {
  const label = `Mix ${title}`;
  if (variant === "full") {
    return (
      <Link
        href={mixHref(workId)}
        aria-label={label}
        title="Open the Mixer with this song"
        className={`inline-flex items-center justify-center gap-2 rounded-lg border border-white/12 px-4 py-2.5 text-sm font-medium text-foreground transition hover:border-white/25 hover:bg-white/[0.04] active:scale-[0.98] ${className}`}
      >
        <MixIcon className="size-4" />
        Mix it
      </Link>
    );
  }
  const box = size === "sm" ? "size-8" : "size-9";
  return (
    <Link
      href={mixHref(workId)}
      aria-label={label}
      title="Mix this song"
      className={`inline-flex ${box} shrink-0 items-center justify-center rounded-full text-muted transition hover:text-foreground active:scale-95 ${className}`}
    >
      <MixIcon className={size === "sm" ? "size-4" : "size-[18px]"} />
    </Link>
  );
}

// Two crossing records: one song turning into the next.
function MixIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className} aria-hidden>
      <circle cx="8.5" cy="12" r="5.5" />
      <circle cx="15.5" cy="12" r="5.5" />
      <circle cx="8.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
