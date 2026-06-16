"use client";

import { useState } from "react";

import { formatCatalogId } from "@/lib/catalog";

// Per-song share — the viral lever (CLAUDE.md §1.3a: the platform's growth
// mechanic is people searching and following NAMES). Native share sheet on
// mobile (essential in MENA, where WhatsApp + IG carry the link), clipboard
// fallback on desktop. The text template names the makers explicitly so even
// a paste into a chat that doesn't unfurl the OG card still tells the story.
//
// The OG image itself is wired by /registry/[id]/opengraph-image; this button
// only opens the share UI.

type Props = {
  workId: number;
  title: string;
  contributorNames: string[];
  compact?: boolean;
  className?: string;
};

function joinNames(names: string[]): string {
  const visible = names.slice(0, 4);
  const extra = names.length - visible.length;
  let head: string;
  if (visible.length === 0) head = "";
  else if (visible.length === 1) head = visible[0];
  else if (visible.length === 2) head = `${visible[0]} & ${visible[1]}`;
  else
    head = `${visible.slice(0, -1).join(", ")} & ${visible[visible.length - 1]}`;
  if (extra > 0) return `${head} +${extra}`;
  return head;
}

export function ShareButton({
  workId,
  title,
  contributorNames,
  compact = false,
  className,
}: Props) {
  const [copied, setCopied] = useState(false);

  const url = `https://ai-red.io/registry/${workId}`;
  const makers = joinNames(contributorNames);
  const makersClause = makers
    ? `made by ${makers}, carbon and silicon, credited by name`
    : "made by carbon and silicon, credited by name";
  const text = `${formatCatalogId(workId)} · "${title}" — ${makersClause}. Listen on AIRED.`;

  async function showCopied() {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function onClick(e: React.MouseEvent) {
    // The button can sit over a card-level link; never let the share open
    // a navigation too.
    e.preventDefault();
    e.stopPropagation();

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (err) {
        // User dismissed the share sheet — leave the UI as it was.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Any other failure falls through to the clipboard.
      }
    }

    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
        await showCopied();
        return;
      } catch {
        // Clipboard blocked — show a transient label so the tap isn't silent.
      }
    }

    await showCopied();
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={copied ? "Link copied" : `Share ${formatCatalogId(workId)}`}
        title={copied ? "Link copied" : "Share"}
        className={
          className ??
          "inline-flex size-9 items-center justify-center rounded-full border border-white/15 bg-background/70 text-foreground backdrop-blur transition hover:border-white/30 hover:bg-background/85 active:scale-95"
        }
      >
        {copied ? <CheckIcon /> : <ShareIcon />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        className ??
        "inline-flex items-center gap-2 self-start rounded-lg border border-white/12 px-4 py-2.5 text-sm font-medium text-foreground transition hover:border-white/25 hover:bg-white/[0.04] active:scale-[0.98]"
      }
    >
      <ShareIcon />
      <span>{copied ? "Link copied" : "Share"}</span>
    </button>
  );
}

function ShareIcon() {
  // Generic share glyph — three nodes wired together; renders crisp at 16px.
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
