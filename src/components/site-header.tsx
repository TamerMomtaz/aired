import Link from "next/link";

import { InstallTrigger } from "@/components/install/install-trigger";
import { NavLink } from "@/components/nav/nav-link";
import { NavMore, type MoreItem } from "@/components/nav/nav-more";
import { signOut } from "@/lib/auth/actions";
import { getPendingReviewCount } from "@/lib/review/queries";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

// The app shell's top bar. Server-rendered so it knows who's signed in. It's
// revalidated on sign-in/out (see lib/auth/actions) so the state never goes
// stale across a navigation.
//
// The shape is the platform's offer in nav form: Listen (the public feed) on
// one side, Create (Upload) on the other. A logged-out maker who taps Create
// is routed via /signup?next=/upload — landing them at the upload form the
// moment they finish signing up.
//
// PHONE vs DESKTOP. Above sm: every entry is in the rail, exactly as it has
// always been. Below it there is only room for three — measured, not guessed:
// the rail is 267px at 390px and 197px at 320px, while the full signed-in strip
// is 524px (and 594px for an admin). So a phone gets Listen · Shelf · Upload,
// and the rest lives behind the ⋯ door beside the rail.
//
// The three that stay are what a returning listener reaches for: the catalog,
// their own shelves, and — because AIRED is uploaded from phones — the door to
// making something. Downloads used to hold the second seat by accident of
// order, at 91px the widest entry on the platform; it now sits behind ⋯.
//
// Every entry below appears exactly once. `hidden sm:contents` and `sm:hidden`
// decide which of the two navs it belongs to, so there is one source of truth
// for each href and label, and the DOM order is the desktop order untouched.
export async function SiteHeader() {
  const [user, profile] = await Promise.all([
    getCurrentUser(),
    getCurrentProfile(),
  ]);

  // The Review link and its waiting-count are admin-only — and we only run the
  // count query for an admin, so a normal visitor's header never pays for it.
  let pendingCount = 0;
  if (profile?.is_admin) {
    const supabase = await createClient();
    pendingCount = await getPendingReviewCount(supabase);
  }

  // What the phone's ⋯ door holds — the same destinations the desktop rail
  // shows inline, in the same order. Log out isn't here: it's a server action,
  // so it rides in as the menu's footer.
  // Diagnostics rides in the ⋯ door for an admin and nowhere else. It needs to
  // be reachable one-handed, in a parked car, seconds after playback died — and
  // invisible to every listener, because a black box is workshop equipment, not
  // part of the offer. Admin-only in the menu; the page itself is unlisted
  // rather than locked (see app/settings/diagnostics/page.tsx).
  const moreItems: MoreItem[] = user
    ? [
        { href: "/downloads", label: "Downloads" },
        ...(profile?.is_admin
          ? [
              { href: "/review", label: "Review", count: pendingCount },
              { href: "/settings/diagnostics", label: "Diagnostics" },
            ]
          : []),
        { href: "/manage", label: "Manage" },
      ]
    : [
        { href: "/downloads", label: "Downloads" },
        { href: "/login", label: "Log in" },
      ];

  return (
    <header className="sticky top-0 z-20 border-b border-white/8 bg-background/80 backdrop-blur">
      {/* gap-2 on a phone, gap-3 from sm: up. Those 8px are the difference
          between the three phone entries fitting at 360px and the rail having
          to scroll 2px — measured. Desktop keeps the spacing it always had. */}
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-5 sm:gap-3">
        <Link
          href="/"
          className="shrink-0 text-lg font-semibold tracking-[0.2em] text-foreground"
        >
          AIRED
        </Link>

        {/* The strip carries its own horizontal scroll (see .nav-rail in
            globals.css). `min-w-0` is the load-bearing class: a flex child
            defaults to min-width:auto, which means "never shrink below your
            content", so without it the nav lays out at its full content width
            and shoves the whole document sideways — the page slides under your
            thumb instead of the nav. `flex-1` hands it the space left over
            beside the lockup; `-my-2 py-2` gives the Upload CTA's active ring
            room to breathe, since a scroll container clips on both axes. */}
        <nav
          aria-label="Main"
          className="nav-rail -my-2 flex min-w-0 flex-1 items-center overflow-x-auto py-2 text-sm"
        >
          {/* The items ride on their own track: `shrink-0` keeps them at full
              width so the rail scrolls rather than squeezing them, and `ml-auto`
              parks them at the right edge whenever they DO fit (a flex auto
              margin resolves to zero once space runs out, so nothing is ever
              stranded off the left edge, unreachable). */}
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <NavLink href="/">Listen</NavLink>

            {/* Phone only: one entry standing for both shelves. It lands on
                Adorned — the ankh is the most frequent gesture on AIRED — and
                stays lit on the mood pages, which the tabs at the top of each
                shelf flip between. */}
            {user ? (
              <div className="contents sm:hidden">
                <NavLink href="/adorned" alsoActiveFor={["/moods"]}>
                  Shelf
                </NavLink>
              </div>
            ) : null}

            <div className="hidden sm:contents">
              <NavLink href="/downloads">Downloads</NavLink>

              {profile?.is_admin ? (
                <NavLink href="/review">
                  <span className="inline-flex items-center gap-1.5">
                    Review
                    {pendingCount > 0 ? (
                      <span className="rounded-full bg-cert-red px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                        {pendingCount}
                      </span>
                    ) : null}
                  </span>
                </NavLink>
              ) : null}
            </div>

            <InstallTrigger />

            {user ? (
              <>
                {/* The listener's own two shelves. They sit before Manage because
                    every account listens, while only some upload. */}
                <div className="hidden sm:contents">
                  <NavLink href="/adorned">Adorned</NavLink>
                  <NavLink href="/moods">Moods</NavLink>
                  <NavLink href="/manage">Manage</NavLink>
                </div>
                <NavLink href="/upload" variant="cta">
                  Upload
                </NavLink>
                <Link
                  href="/settings"
                  className="hidden max-w-[12rem] truncate px-2 text-xs text-muted/70 transition hover:text-foreground sm:inline"
                  title={`${user.email ?? "Your account"} — edit your identity`}
                >
                  {user.email}
                </Link>
                <div className="hidden sm:contents">
                  <form action={signOut}>
                    <button
                      type="submit"
                      className="rounded-md border border-white/10 px-2.5 py-1.5 whitespace-nowrap text-muted transition hover:border-white/20 hover:text-foreground"
                    >
                      Log out
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <>
                <div className="hidden sm:contents">
                  <Link
                    href="/login"
                    className="rounded-md px-2.5 py-1.5 whitespace-nowrap text-muted transition hover:text-foreground"
                  >
                    Log in
                  </Link>
                </div>
                {/* Create keeps a seat on a phone at every width. It is the
                    whole offer to someone who has never been here, and it was
                    the entry getting clipped mid-word before this. */}
                <Link
                  href="/signup?next=/upload"
                  className="rounded-md bg-cert-red px-3 py-1.5 font-medium whitespace-nowrap text-white transition hover:brightness-110"
                >
                  Create
                </Link>
              </>
            )}
          </div>
        </nav>

        {/* The ⋯ door — phone only, and deliberately a sibling of the rail
            rather than a passenger in it: the rail is a scroll container and
            would clip the panel, and out here the door never scrolls away from
            the thumb. */}
        <NavMore
          className="shrink-0 sm:hidden"
          items={moreItems}
          footer={
            user ? (
              <form action={signOut}>
                <button
                  type="submit"
                  className="w-full rounded-lg px-3 py-2.5 text-left text-sm whitespace-nowrap text-muted transition hover:bg-white/[0.05] hover:text-foreground"
                >
                  Log out
                </button>
              </form>
            ) : null
          }
        />
      </div>
    </header>
  );
}
