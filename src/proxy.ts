import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

// Next.js 16 renamed Middleware to Proxy (same behaviour, Node.js runtime).
// AIRED uses it for one job: keep the Supabase auth session fresh on every
// request so Server Components, Server Actions and Route Handlers all see a
// valid user. Route protection lives close to the data (RLS + per-page checks),
// not here — Proxy runs on every route, so it stays cheap.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Run on everything except static assets and image files. Auth routes and
    // pages are all included so their session cookies refresh.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
