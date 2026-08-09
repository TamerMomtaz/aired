"use client";

import { usePathname, useRouter } from "next/navigation";

import { useAdorned } from "@/components/library/adorned-provider";

// The ankh. One tap keeps a song; one more takes it back.
//
// A maker credits a song in the Volley Ledger. This is the listener's side of
// that gesture — the ledger pointed the other way. It is private: nobody but the
// listener ever sees it, and it changes nothing about who made the work.
//
// Signed out, the ankh is still shown and still means something: tapping it
// leads to sign-up and back, rather than being hidden until you already know it
// exists.

type Size = "sm" | "md";

export function AdornButton({
  workId,
  title,
  size = "md",
  // "icon" is the bare ankh used on cards and in the player bar; "full" is the
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
    // The ankh often sits on top of a card that is itself a link.
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
            ? "border-adorn-blue/40 text-adorn-blue hover:bg-adorn-blue/10"
            : "border-white/12 text-foreground hover:border-white/25 hover:bg-white/[0.04]"
        } ${className}`}
      >
        <AnkhIcon adorned={adorned} className="size-4" />
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
      className={`flex ${box} items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-adorn-blue/50 active:scale-95 ${
        adorned
          ? "text-adorn-blue hover:brightness-110"
          : "text-muted hover:text-foreground"
      } ${className}`}
    >
      <AnkhIcon adorned={adorned} className={glyph} />
    </button>
  );
}

// The ankh — key of life, and the right mark for "this one lives". It is drawn
// in --adorn-blue, never cert-red: red is the Red Line's, and an adornment is
// the most frequent gesture on the platform, so it must not wear the scarcest
// colour.
//
// The loop stays HOLLOW in both states. A solid fill collapses into a lollipop
// at 16px and stops reading as an ankh at all — which is why adorned is carried
// by stroke weight and colour here, and not by fill the way the heart did it.
// Same geometry either way, so the glyph never changes shape under the thumb.
function AnkhIcon({
  adorned,
  className,
}: {
  adorned: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={adorned ? 2.25 : 1.75}
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
      style={
        adorned
          ? {
              filter:
                "drop-shadow(0 0 6px color-mix(in srgb, var(--adorn-blue) 60%, transparent))",
            }
          : undefined
      }
    >
      <ellipse cx="12" cy="6.5" rx="4.5" ry="5.5" />
      <line x1="12" y1="11" x2="12" y2="22.5" />
      <line x1="5.5" y1="15" x2="18.5" y2="15" />
    </svg>
  );
}
