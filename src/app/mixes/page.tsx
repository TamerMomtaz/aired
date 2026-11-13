import type { Metadata } from "next";
import Link from "next/link";

import { AccountMixes } from "@/components/mixes/account-mixes";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { MIX_COLUMNS, type AccountMix } from "@/lib/mixes/types";

export const metadata: Metadata = {
  title: "My mixes · AIRED",
  description: "The mixes you made in the AIRED Mixer, kept on your account.",
};

export const dynamic = "force-dynamic";

// MY MIXES: every mix the signed-in person kept on AIRED. Private unless they
// switch Share on for one.
export default async function MyMixesPage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
        <h1 className="text-2xl font-semibold text-foreground">My mixes</h1>
        <p className="mt-2 text-sm text-muted">
          <Link href="/login?next=/mixes" className="underline">
            Sign in
          </Link>{" "}
          to see the mixes you kept on AIRED.
        </p>
      </main>
    );
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("mix")
    .select(MIX_COLUMNS)
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });
  const mixes = (data ?? []) as unknown as AccountMix[];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
      <header className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">My mixes</h1>
        <p className="text-sm text-muted">
          The mixes you kept on AIRED. They play on any device you sign in on. Only you can hear them, unless you
          switch Share on for one.
        </p>
      </header>
      {mixes.length ? (
        <AccountMixes mixes={mixes} owner />
      ) : (
        <p className="rounded-xl border border-white/10 p-5 text-sm text-muted">
          No mixes here yet. Make one in the{" "}
          <Link href="/mix" className="underline">
            Mixer
          </Link>
          , then tap <strong>Keep on AIRED</strong> in your MixaTee.
        </p>
      )}
    </main>
  );
}
