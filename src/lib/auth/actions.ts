"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

// Result returned to the form via useActionState. `error` shows inline; `notice`
// carries a non-error message (e.g. "check your email"). A redirect on success
// means the happy path never returns a value.
export type AuthState = { error?: string; notice?: string } | undefined;

// The site's own origin, for building auth redirect URLs. The `origin` header is
// present on same-origin form POSTs; we fall back to the forwarded host so this
// is correct behind Vercel's proxy and in local dev alike.
async function getOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function signIn(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: error.message };
  }

  // The root layout reads the user, so refresh it before leaving.
  revalidatePath("/", "layout");
  redirect("/registry");
}

export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: "Enter your email and password." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const supabase = await createClient();
  const origin = await getOrigin();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/callback?next=/registry` },
  });
  if (error) {
    return { error: error.message };
  }

  // If the project has email confirmation off, signUp returns a live session and
  // the user is already in. Otherwise we wait for them to confirm by email.
  if (data.session) {
    revalidatePath("/", "layout");
    redirect("/registry");
  }

  return {
    notice:
      "Check your email to confirm your account, then come back and log in.",
  };
}

// Google sign-in. This kicks off the OAuth handshake and redirects the browser
// to Google; the round-trip lands back on /auth/callback. Requires the Google
// provider to be enabled in the Supabase dashboard with OAuth credentials.
export async function signInWithGoogle(): Promise<void> {
  const supabase = await createClient();
  const origin = await getOrigin();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/auth/callback?next=/registry` },
  });
  if (error) {
    redirect(`/auth/auth-code-error?reason=${encodeURIComponent(error.message)}`);
  }
  if (data.url) {
    redirect(data.url);
  }
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
