import { NextResponse } from "next/server";

import { safeNext } from "@/lib/auth/safe-redirect";
import { postAuthDestination } from "@/lib/identity/onboarding";
import { createClient } from "@/lib/supabase/server";

// The email one-time-token flow: magic links, recovery, and confirmation emails
// whose template points here with `?token_hash=&type=`. verifyOtp establishes
// the session. (The default Supabase confirmation template uses /auth/callback
// instead; this route covers the token_hash style and future password resets.)
type EmailOtpType =
  | "signup"
  | "invite"
  | "magiclink"
  | "recovery"
  | "email_change"
  | "email";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      const dest = await postAuthDestination(supabase, next);
      return NextResponse.redirect(`${origin}${dest}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}
