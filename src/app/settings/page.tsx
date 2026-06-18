import { redirect } from "next/navigation";

import { IdentityEditor } from "@/components/identity/identity-editor";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Your identity · AIRED" };

// The always-available identity editor. How an existing artist completes or
// updates the same fields the first-run walk sets — display name, handle,
// mascot, bio, avatars — outside that walk. Every write is the user editing
// their OWN profile (profile_self_upd); no elevated powers, and never touches
// the onboarding flag.
export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/settings");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profile")
    .select("display_name, handle, mascot_name, mascot_avatar_url, bio, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-5 py-10">
      <header className="mb-8 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">Your identity</h1>
        <p className="text-sm text-muted">
          Your artist name, handle, and mascot — the home listeners search and
          follow. Edit any of it anytime.
        </p>
      </header>

      <IdentityEditor
        initial={{
          displayName: profile?.display_name ?? "",
          handle: profile?.handle ?? "",
          bio: profile?.bio ?? "",
          avatarUrl: profile?.avatar_url ?? null,
          mascotName: profile?.mascot_name ?? "",
          mascotAvatarUrl: profile?.mascot_avatar_url ?? null,
        }}
      />
    </main>
  );
}
