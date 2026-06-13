import Link from "next/link";

export const metadata = { title: "Sign-in problem · AIRED" };

export default async function AuthCodeErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-12 text-center">
      <h1 className="text-xl font-semibold text-foreground">
        We couldn&apos;t finish signing you in
      </h1>
      <p className="text-sm leading-relaxed text-muted">
        The link may have expired or already been used. Please try again.
        {reason ? (
          <span className="mt-2 block text-xs text-muted/70">{reason}</span>
        ) : null}
      </p>
      <div className="flex flex-col gap-2">
        <Link
          href="/login"
          className="rounded-lg bg-cert-red px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110"
        >
          Back to log in
        </Link>
        <Link
          href="/"
          className="text-sm text-muted underline-offset-4 hover:underline"
        >
          Return home
        </Link>
      </div>
    </main>
  );
}
