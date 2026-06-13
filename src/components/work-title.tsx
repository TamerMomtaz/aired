import { formatCatalogId } from "@/lib/catalog";

// The canonical way AIRED renders a work: AIRED-#### · "Title" (CLAUDE.md §2).
// The catalog number anchors (mono, cert-red); the title sings (larger, bright).
// `size` keeps one component usable both in a list row and as a page heading.
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
  const layout =
    size === "lg"
      ? "gap-1"
      : "flex-row flex-wrap items-baseline gap-x-2 gap-y-0.5";
  const idClass =
    size === "lg" ? "text-sm" : size === "sm" ? "text-[11px]" : "text-xs";
  const titleClass =
    size === "lg"
      ? "text-2xl font-semibold sm:text-3xl"
      : size === "sm"
        ? "text-sm font-medium"
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
