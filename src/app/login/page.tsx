import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { getCurrentUser } from "@/lib/supabase/auth";

export const metadata = { title: "Log in · AIRED" };

export default async function LoginPage() {
  // Already signed in? Nothing to do here.
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
        <p className="text-sm text-muted">Welcome back. Log in to your ledger.</p>
      </header>

      <AuthForm mode="login" />
    </main>
  );
}
