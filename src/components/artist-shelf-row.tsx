import Link from "next/link";

// One artist's shelf on the Listen page (ALBUMS or SINGLES): a left artist-name
// column — a label that doubles as a divider spine — followed by that artist's
// cards laid out horizontally and scrolling on overflow. The cards themselves are
// the existing AlbumCard / WorkCard, passed in as <li> children; this only adds
// the grouping frame, so card designs are untouched.
//
// Responsive shape: on narrow screens the artist name stacks as a horizontal
// label ABOVE its row (so a long name never clips), and the cards scroll beneath.
// From sm up it becomes a fixed-width vertical spine at the row's left edge,
// reading bottom-to-top like a record-shelf divider. The name links to the
// artist's page (/artist/[handle], falling back to the profile id).
export function ArtistShelfRow({
  artistId,
  artistHandle,
  artistName,
  children,
}: {
  artistId: string;
  artistHandle: string | null;
  artistName: string;
  children: React.ReactNode;
}) {
  const href = `/artist/${artistHandle ?? artistId}`;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
      <Link
        href={href}
        aria-label={`Open ${artistName}`}
        className="group flex shrink-0 items-center transition sm:w-9 sm:justify-center sm:border-r sm:border-white/8 sm:pr-1"
      >
        <span className="block truncate text-sm font-semibold uppercase tracking-[0.14em] text-muted transition group-hover:text-foreground sm:max-h-full sm:max-w-none sm:overflow-hidden sm:whitespace-nowrap sm:text-[13px] sm:[writing-mode:vertical-rl] sm:[transform:rotate(180deg)]">
          {artistName}
        </span>
      </Link>

      <ul className="flex min-w-0 flex-1 gap-4 overflow-x-auto pb-1">
        {children}
      </ul>
    </div>
  );
}
