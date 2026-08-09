"use client";

import { usePathname, useRouter } from "next/navigation";

import { useAdorned } from "@/components/library/adorned-provider";

// The heart. One tap keeps a song; one more takes it back.
//
// A maker credits a song in the Volley Ledger. This is the listener's side of
// that gesture — the ledger pointed the other way. It is private: nobody but the
// listener ever sees it, and it changes nothing about who made the work.
//
// Signed out, the heart is still shown and still means something: tapping it
// leads to sign-up and back, rather than being hidden until you already know it
// exists.

type Size = "sm" | "md";

export function AdornButton({
  workId,
  title,
  size = "md",
  // "icon" is the bare heart used on cards and in the player bar; "full" is the
  // labelled pill that sits in a song page's action row beside Share and QR.
  variant = "icon",
  className = "",
}: {
  workId: number;
  // Named in the label so a screen reader hears which song is being kept.
  title: string;
  size?: Size;
  variant?: "icon" | "full";
  className?: string;
}) {
  const { isAdorned, toggle, signedIn } = useAdorned();
  const router = useRouter();
  const pathname = usePathname();

  const adorned = isAdorned(workId);
  const box = size === "sm" ? "size-8" : "size-9";
  const glyph = size === "sm" ? "size-4" : "size-[18px]";

  function onClick(e: React.MouseEvent<HTMLButtonElement>) {
    // Hearts often sit on top of a card that is itself a link.
    e.preventDefault();
    e.stopPropagation();
    if (!signedIn) {
      const next = encodeURIComponent(pathname || "/");
      router.push(`/signup?next=${next}`);
      return;
    }
    toggle(workId);
  }

  const label = adorned ? `Remove ${title} from Adorned` : `Adorn ${title}`;
  const hint = adorned ? "Adorned — tap to remove" : "Adorn this song";

  if (variant === "full") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={adorned}
        aria-label={label}
        title={hint}
        className={`inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition active:scale-[0.98] ${
          adorned
            ? "border-cert-red/40 text-cert-red hover:bg-cert-red/10"
            : "border-white/12 text-foreground hover:border-white/25 hover:bg-white/[0.04]"
        } ${className}`}
      >
        <HeartIcon filled={adorned} className="size-4" />
        {adorned ? "Adorned" : "Adorn"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={adorned}
      aria-label={label}
      title={hint}
      className={`flex ${box} items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cert-red/50 active:scale-95 ${
        adorned
          ? "text-cert-red hover:brightness-110"
          : "text-muted hover:text-foreground"
      } ${className}`}
    >
      <HeartIcon filled={adorned} className={glyph} />
    </button>
  );
}

function HeartIcon({
  filled,
  className,
}: {
  filled: boolean;
  className: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={
        filled
          ? {
              filter:
                "drop-shadow(0 0 6px color-mix(in srgb, var(--cert-red) 60%, transparent))",
            }
          : undefined
      }
    >
      <path d="M12 20.5 4.2 12.9a4.7 4.7 0 0 1 0-6.7 4.7 4.7 0 0 1 6.6 0l1.2 1.2 1.2-1.2a4.7 4.7 0 0 1 6.6 0 4.7 4.7 0 0 1 0 6.7Z" />
    </svg>
  );
}
