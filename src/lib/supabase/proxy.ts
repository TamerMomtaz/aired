import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

// Session refresh for AIRED, run from the Next.js 16 Proxy (the renamed
// Middleware — see node_modules/next/dist/docs/.../proxy.md). The browser holds
// the Supabase session in cookies; on every request we read it, let the client
// rotate an expired access token, and write the fresh cookies back onto the
// response. Skipping this is the classic cause of users being randomly logged
// out, so the refresh call must run with nothing between it and the client.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        // The library asks us to attach no-store headers so a CDN never caches
        // one visitor's refreshed session token for another (CLAUDE.md §6 keeps
        // audio on R2, but app responses still pass through Vercel's edge).
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Do not run code between createServerClient and getClaims(): a refresh that
  // lands here writes new cookies onto `response`. getClaims verifies the JWT
  // locally (no round-trip to the Auth server on every navigation).
  await supabase.auth.getClaims();

  return response;
}
