// AIRED catalog identity (CLAUDE.md §2).
//
// The stored catalog id is a raw bigint with no ceiling. Zero-padding to four
// digits is presentation only and grows naturally past 9999. Never hard-code a
// maximum.
export function formatCatalogId(id: number | bigint): string {
  return `AIRED-${id.toString().padStart(4, "0")}`;
}

// Display format for a released work: AIRED-#### · "Title".
export function formatWorkLabel(id: number | bigint, title: string): string {
  return `${formatCatalogId(id)} · "${title}"`;
}
