import { formatCatalogId } from "@/lib/catalog";

// The canonical way AIRED renders a work: AIRED-#### · "Title" (CLAUDE.md §2).
// The catalog number anchors (mono, cert-red); the title sings (larger, bright).
// `size` keeps one component usable both in a list row and as a page heading.
// At `sm` the layout stacks (ID on its own line, title below with up to 2 lines
// and ellipsis) so long titles never get silently clipped inside narrow cards.
export function WorkTitle({
  id,
  title,
  size = "md",
  className = "",
}: {
  id: number | bigint;
  title: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  if (size === "sm") {
    return (
      <span className={`flex min-w-0 flex-col gap-y-0.5 ${className}`}>
        <span className="font-mono text-[11px] uppercase leading-4 tracking-[0.16em] text-cert-red">
          {formatCatalogId(id)}{" "}
          <span aria-hidden className="text-muted/50">
            ·
          </span>
        </span>
        <span className="line-clamp-2 break-words text-sm font-medium leading-5 text-foreground">
          &ldquo;{title}&rdquo;
        </span>
      </span>
    );
  }

  const layout =
    size === "lg" ? "gap-1" : "flex-row flex-wrap items-baseline gap-x-2 gap-y-0.5";
  const idClass = size === "lg" ? "text-sm" : "text-xs";
  const titleClass =
    size === "lg"
      ? "text-2xl font-semibold sm:text-3xl"
      : "text-base font-medium";

  return (
    <span className={`flex ${size === "lg" ? "flex-col" : ""} ${layout} ${className}`}>
      <span
        className={`font-mono uppercase tracking-[0.16em] text-cert-red ${idClass}`}
      >
        {formatCatalogId(id)}
      </span>
      <span aria-hidden className="text-muted/50">
        ·
      </span>
      <span className={`text-foreground ${titleClass}`}>
        &ldquo;{title}&rdquo;
      </span>
    </span>
  );
}
