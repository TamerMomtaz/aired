import { redirect } from "next/navigation";

import { AlbumsSection } from "@/components/manage/albums-section";
import { WorksSection } from "@/components/manage/works-section";
import { getManageData } from "@/lib/albums/queries";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Manage · AIRED" };

// Every creator's own workshop — NOT an admin screen. Here you build albums and
// file your works into them. The redirect is the UX guard; the real scoping is
// the data layer: getManageData reads only rows owned by the signed-in user, and
// RLS + the enforce_album_ownership trigger make sure a creator can only ever
// shape and fill their OWN albums. Seeing the catalog is public; organizing it
// is yours alone.
export default async function ManagePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/manage");

  // Send a not-yet-set-up creator through the guided first-run before Manage —
  // even one (Taim) who already has works but no named home (THE JOURNEY).
  const profile = await getCurrentProfile();
  if (profile && !profile.onboarded_at) redirect("/welcome");

  const supabase = await createClient();
  const { albums, works } = await getManageData(supabase, user.id);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-5 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">Manage</h1>
        <p className="text-sm text-muted">
          Your albums and your works. Build a cover, then file songs under it —
          or set a song loose as a single. Only you can organize your catalog.
        </p>
      </header>

      <AlbumsSection albums={albums} />
      <WorksSection works={works} albums={albums} />
    </main>
  );
}
