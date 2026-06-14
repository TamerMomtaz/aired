import Link from "next/link";

import { signOut } from "@/lib/auth/actions";
import { getCurrentUser } from "@/lib/supabase/auth";

// The app shell's top bar. Server-rendered so it knows who's signed in. It's
// revalidated on sign-in/out (see lib/auth/actions) so the state never goes
// stale across a navigation.
export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="sticky top-0 z-20 border-b border-white/8 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-4 px-5">
        <Link
          href="/"
          className="text-lg font-semibold tracking-[0.2em] text-foreground"
        >
          AIRED
        </Link>

        <nav className="flex items-center gap-1 text-sm sm:gap-2">
          <Link
            href="/registry"
            className="rounded-md px-2.5 py-1.5 text-muted transition hover:text-foreground"
          >
            Registry
          </Link>

          {user ? (
            <>
              <Link
                href="/upload"
                className="rounded-md px-2.5 py-1.5 text-muted transition hover:text-foreground"
              >
                Upload
              </Link>
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
                href="/signup"
                className="rounded-md bg-cert-red px-3 py-1.5 font-medium text-white transition hover:brightness-110"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
