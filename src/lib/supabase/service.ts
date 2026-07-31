import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_URL } from "./config";

// SERVER-ONLY Supabase client that runs as the service role — it BYPASSES RLS.
// Never import this into a Client Component, and never reach for it where a
// session-bound client (./server) will do: RLS is the platform's primary
// authorization layer and every user-facing path must keep running through it.
//
// It exists for the one job RLS structurally cannot do: a request that carries
// no user session but is nonetheless authorized to write as a specific human —
// the delegated ingest door (POST /api/works/ingest), where a service token maps
// to the human authority that authorized the publish. There, ownership is
// established by the token → authority resolution BEFORE any write, and the
// DB triggers (enforce_publish_honesty, enforce_volley_origin,
// enforce_album_ownership) remain in force because triggers fire for every
// writer, service role included. Those triggers — not RLS — are what make a
// dishonest or cross-owner row impossible on this path.
//
// The key is a CLAUDE.md §1.7 secret: env var only, server only, never
// committed, never returned in a response, never logged.
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. It is required for the delegated ingest door and must be a server-only env var (.env.local locally, Vercel → Environment Variables).",
    );
  }

  return createSupabaseClient(SUPABASE_URL, key, {
    auth: {
      // No user session is involved: don't persist, refresh, or read one from
      // storage. Every request is authorized by the ingest token, not a cookie.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
