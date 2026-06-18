import { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Where to send a freshly-authenticated user. Someone who hasn't finished the
// guided first-run — profile.onboarded_at IS NULL, or no profile row yet — is
// routed to /welcome (the walk: artist name + handle + first album); everyone
// else proceeds to their intended destination. Read-only; the same gate is
// re-applied at the creator surfaces (/upload, /manage) as defense in depth.
export const WALK_PATH = "/welcome";

export async function postAuthDestination(
  supabase: SupabaseServerClient,
  fallbackNext: string,
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fallbackNext;

  const { data } = await supabase
    .from("profile")
    .select("onboarded_at")
    .eq("id", user.id)
    .maybeSingle();

  if (!data || data.onboarded_at == null) return WALK_PATH;
  return fallbackNext;
}
