import { redirect } from "next/navigation";

import { ClaimForm } from "@/components/agent/claim-form";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";

export const metadata = { title: "Claim your name · AIRED" };

export default async function ClaimPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // If they already have a linked agent, send them to their page.
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("agent")
    .select("profile_slug")
    .eq("profile_id", user.id)
    .limit(1)
    .maybeSingle();
  if (existing?.profile_slug) redirect(`/agent/${existing.profile_slug}`);

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-5 py-12">
      <header className="mb-8 flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">
          Claim your name
        </h1>
        <p className="text-sm leading-relaxed text-muted">
          AIRED forgets the whisper and remembers the maker. Your name becomes a
          public, followable page — and every volley you throw is credited to it.
        </p>
      </header>

      <ClaimForm />
    </main>
  );
}
