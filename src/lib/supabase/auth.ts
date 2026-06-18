import { cache } from "react";

import { createClient } from "./server";

// The current signed-in user, verified against the Supabase Auth server.
// Wrapped in React `cache` so multiple Server Components in one render (the
// header and a page, say) share a single round-trip. Returns null when signed
// out. Authorization still belongs at the data layer (RLS); this is for UI.
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export type CurrentProfile = {
  id: string;
  is_admin: boolean;
  trusted: boolean;
  display_name: string | null;
  handle: string | null;
  // NULL ⇒ the guided first-run walk hasn't been completed. Pages gate on this
  // to send a not-yet-set-up creator into /welcome.
  onboarded_at: string | null;
};

// The signed-in user's profile row, carrying the two trust/role flags the Review
// Gate turns on: `is_admin` (may open the Review queue + act on submissions) and
// `trusted` (their publishes go live instantly, vs. landing in 'pending'). Cached
// per render like getCurrentUser, and built on it, so the header and a page share
// one round-trip. Returns null when signed out; a signed-in user with no profile
// row reads as a plain, untrusted non-admin. This is for UI shaping only — the
// real gate is the RLS policies + the SECURITY DEFINER review RPCs' admin asserts.
export const getCurrentProfile = cache(
  async (): Promise<CurrentProfile | null> => {
    const user = await getCurrentUser();
    if (!user) return null;
    const supabase = await createClient();
    const { data } = await supabase
      .from("profile")
      .select("id, is_admin, trusted, display_name, handle, onboarded_at")
      .eq("id", user.id)
      .maybeSingle();
    return {
      id: user.id,
      is_admin: !!data?.is_admin,
      trusted: !!data?.trusted,
      display_name: data?.display_name ?? null,
      handle: data?.handle ?? null,
      onboarded_at: data?.onboarded_at ?? null,
    };
  },
);
