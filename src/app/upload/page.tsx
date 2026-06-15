import Link from "next/link";
import { redirect } from "next/navigation";

import { UploadForm } from "@/components/upload/upload-form";
import { getCurrentUser } from "@/lib/supabase/auth";

export const metadata = { title: "Upload · AIRED" };

// Uploading is creator-only. Authorization still lives at the data layer (RLS);
// this redirect is for UX. Carry `next=/upload` so the listener-turned-maker
// lands back here the moment they finish logging in or signing up.
export default async function UploadPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/upload");

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-5 py-10">
      <header className="mb-8 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">
          Upload a work
        </h1>
        <p className="text-sm text-muted">
          Title, audio, artwork. It lands as a draft so you can declare its
          Volley Ledger — then it becomes an AIRED work.
        </p>
      </header>

      <UploadForm />

      <p className="mt-6 text-center text-xs text-muted/70">
        Haven&apos;t claimed your name yet?{" "}
        <Link
          href="/claim"
          className="text-foreground underline-offset-4 hover:underline"
        >
          Do that first
        </Link>{" "}
        so the ledger can credit you.
      </p>
    </main>
  );
}
