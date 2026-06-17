import { formatPlayCount, formatPlays } from "@/lib/format";

// A small, muted "▶ 1.2K" play-count chip. Real listens are public and shown
// (the platform keeps an honest count — recorded server-side, deduped per
// session/hour). The triangle is decorative; the accessible label spells out the
// full count ("1,234 plays"). Server component — number formatting stays on the
// server, so no hydration drift.
export function PlayCount({
  count,
  className = "",
}: {
  count: number | null | undefined;
  className?: string;
}) {
  const label = formatPlays(count);
  return (
    <span
      className={`inline-flex items-center gap-1 ${className}`}
      aria-label={label}
      title={label}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-2.5 shrink-0"
        aria-hidden
        fill="currentColor"
      >
        <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.5-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
      </svg>
      <span aria-hidden>{formatPlayCount(count)}</span>
    </span>
  );
}
