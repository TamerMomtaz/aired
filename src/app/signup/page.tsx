import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { getCurrentUser } from "@/lib/supabase/auth";

export const metadata = { title: "Sign up · AIRED" };

export default async function SignupPage() {
  if (await getCurrentUser()) {
    redirect("/registry");
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-6 py-12">
      <header className="flex flex-col gap-2 text-center">
        <Link
          href="/"
          className="text-2xl font-semibold tracking-[0.2em] text-foreground"
        >
          AIRED
        </Link>
        <p className="text-sm text-muted">
          Make your name a name. Stream free, upload human + AI music, and let the
          ledger show who made it.
        </p>
      </header>

      <AuthForm mode="signup" />

      <p className="text-center text-xs leading-relaxed text-muted/70">
        By creating an account you start a ledger. Your private craft stays
        encrypted and yours; only the shape of each contribution is ever public.
      </p>
    </main>
  );
}
