import Link from "next/link";

import { InstallTrigger } from "@/components/install/install-trigger";
import { NavLink } from "@/components/nav/nav-link";
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

  return (
    <header className="sticky top-0 z-20 border-b border-white/8 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-5">
        <Link
          href="/"
          className="text-lg font-semibold tracking-[0.2em] text-foreground"
        >
          AIRED
        </Link>

        <nav className="flex items-center gap-1 text-sm sm:gap-2">
          <NavLink href="/">Listen</NavLink>

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

          <InstallTrigger />

          {user ? (
            <>
              <NavLink href="/manage">Manage</NavLink>
              <NavLink href="/upload" variant="cta">
                Upload
              </NavLink>
              <span
                className="hidden max-w-[12rem] truncate px-2 text-xs text-muted/70 sm:inline"
                title={user.email ?? undefined}
              >
                {user.email}
              </span>
              <form action={signOut}>
                <button
                  type="submit"
                  className="rounded-md border border-white/10 px-2.5 py-1.5 text-muted transition hover:border-white/20 hover:text-foreground"
                >
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-md px-2.5 py-1.5 text-muted transition hover:text-foreground"
              >
                Log in
              </Link>
              <Link
                href="/signup?next=/upload"
                className="rounded-md bg-cert-red px-3 py-1.5 font-medium text-white transition hover:brightness-110"
              >
                Create
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
