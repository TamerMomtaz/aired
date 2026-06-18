import { redirect } from "next/navigation";

import { JourneyWizard } from "@/components/onboarding/journey-wizard";
import { slugifyHandle } from "@/lib/identity/handle";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Welcome to AIRED" };

// THE JOURNEY — the guided first-run walk. Shown to a signed-in user whose
// profile.onboarded_at IS NULL: name your artist (+ handle), your mascot, your
// first album, then home. Every write is the user editing their OWN profile /
// creating their OWN album — no elevated powers. The founder (backfilled
// onboarded_at) and anyone who's finished never lands here: they're redirected
// straight out. A signed-out visitor is sent to log in first.
export default async function WelcomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/welcome");

  const supabase = await createClient();
  const [{ data: profile }, { count: workCount }] = await Promise.all([
    supabase
      .from("profile")
      .select(
        "display_name, handle, mascot_name, mascot_avatar_url, bio, avatar_url, onboarded_at",
      )
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("work")
      .select("id", { count: "exact", head: true })
      .eq("creator_id", user.id),
  ]);

  // Already home — never show the walk twice.
  if (profile?.onboarded_at) redirect("/");

  // Suggest a handle from any existing display name so step 1 starts pre-filled.
  const suggestedHandle =
    profile?.handle ?? slugifyHandle(profile?.display_name ?? "");

  return (
    <JourneyWizard
      initial={{
        displayName: profile?.display_name ?? "",
        handle: profile?.handle ?? "",
        suggestedHandle,
        bio: profile?.bio ?? "",
        avatarUrl: profile?.avatar_url ?? null,
        mascotName: profile?.mascot_name ?? "",
        mascotAvatarUrl: profile?.mascot_avatar_url ?? null,
      }}
      hasWorks={(workCount ?? 0) > 0}
    />
  );
}
