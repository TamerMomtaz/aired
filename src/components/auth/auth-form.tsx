"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { signIn, signInWithGoogle, signUp, type AuthState } from "@/lib/auth/actions";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-base text-foreground outline-none transition placeholder:text-muted/60 focus:border-cert-red/60 focus:bg-white/[0.07] focus:ring-1 focus:ring-cert-red/40";

const primaryBtnClass =
  "w-full rounded-lg bg-cert-red px-4 py-2.5 text-sm font-medium text-white shadow-[0_0_18px_-6px_var(--cert-red)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";

type Mode = "login" | "signup";

const COPY: Record<
  Mode,
  { submit: string; pending: string; togglePrompt: string; toggleHref: string; toggleCta: string }
> = {
  login: {
    submit: "Log in",
    pending: "Logging in…",
    togglePrompt: "New here?",
    toggleHref: "/signup",
    toggleCta: "Create an account",
  },
  signup: {
    submit: "Create account",
    pending: "Creating…",
    togglePrompt: "Already have an account?",
    toggleHref: "/login",
    toggleCta: "Log in",
  },
};

export function AuthForm({ mode, next }: { mode: Mode; next?: string }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    mode === "login" ? signIn : signUp,
    undefined,
  );
  const copy = COPY[mode];

  return (
    <div className="flex w-full flex-col gap-5">
      <form action={signInWithGoogle}>
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <GoogleButton />
      </form>

      <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-muted/70">
        <span className="h-px flex-1 bg-white/10" />
        or
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <form action={formAction} className="flex flex-col gap-3">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Email</span>
          <input
            className={inputClass}
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@domain.com"
            required
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Password</span>
          <input
            className={inputClass}
            type="password"
            name="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
            minLength={mode === "signup" ? 8 : undefined}
            required
          />
        </label>

        {state?.error ? (
          <p role="alert" className="text-sm text-cert-red">
            {state.error}
          </p>
        ) : null}

        {state?.notice ? (
          <p className="rounded-lg border border-cert-red/30 bg-cert-red/10 px-3 py-2 text-sm text-foreground">
            {state.notice}
          </p>
        ) : null}

        <button className={primaryBtnClass} type="submit" disabled={pending}>
          {pending ? copy.pending : copy.submit}
        </button>
      </form>

      <p className="text-center text-sm text-muted">
        {copy.togglePrompt}{" "}
        <Link
          href={
            next ? `${copy.toggleHref}?next=${encodeURIComponent(next)}` : copy.toggleHref
          }
          className="text-foreground underline-offset-4 hover:underline"
        >
          {copy.toggleCta}
        </Link>
      </p>
    </div>
  );
}

// Its own component so useFormStatus can read the Google form's pending state.
function GoogleButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-white/12 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <GoogleMark />
      {pending ? "Connecting…" : "Continue with Google"}
    </button>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-4">
      <path
        fill="#FFC107"
        d="M43.6 20.5h-1.9V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 1 1 0-24c3.1 0 5.8 1.1 8 3l5.7-5.7A20 20 0 1 0 24 44c11 0 20-8 20-20 0-1.3-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8A12 12 0 0 1 24 12c3.1 0 5.8 1.1 8 3l5.7-5.7A20 20 0 0 0 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A12 12 0 0 1 12.7 28l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C39.9 39 44 32.5 44 24c0-1.3-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}
