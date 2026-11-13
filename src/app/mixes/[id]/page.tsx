import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AccountMixes } from "@/components/mixes/account-mixes";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { MIX_COLUMNS, MIX_ID_RE, type AccountMix } from "@/lib/mixes/types";

export const dynamic = "force-dynamic";

// One mix. Its maker always sees it; anyone else only when it is shared (RLS
// decides). Every source song and its makers are credited on the page.
async function load(id: string): Promise<{ mix: AccountMix; owner: boolean } | null> {
  if (!MIX_ID_RE.test(id)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("mix").select(`${MIX_COLUMNS}, owner_id`).eq("id", id).maybeSingle();
  if (!data) return null;
  const user = await getCurrentUser();
  const { owner_id, ...mix } = data as unknown as AccountMix & { owner_id: string };
  return { mix: mix as AccountMix, owner: !!user && user.id === owner_id };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const found = await load((await params).id);
  if (!found) return { title: "Mix · AIRED" };
  const { mix } = found;
  return {
    title: `${mix.title} · AIRED Mix`,
    description: `An AIRED Mix${mix.dj_name ? ` by ${mix.dj_name}` : ""}, built from ${mix.credits.map((c) => c.label).join(", ")}.`,
  };
}

export default async function MixPage({ params }: { params: Promise<{ id: string }> }) {
  const found = await load((await params).id);
  if (!found) notFound();
  const { mix, owner } = found;
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
      <header className="mb-6 flex flex-col gap-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-cert-red">
          AIRED Mix{mix.dj_name ? ` · mixed by ${mix.dj_name}` : ""}
        </p>
        <h1 className="text-2xl font-semibold text-foreground">{mix.title}</h1>
        {mix.story ? <p className="mt-1 text-sm text-foreground/90">{mix.story}</p> : null}
      </header>
      <AccountMixes mixes={[mix]} owner={owner} />
      <p className="mt-6 text-xs text-muted">
        Made in the AIRED Mixer from the songs above
        {mix.planned_by === "brain" ? ", set planned by the AIRED DJ brain (Claude, Anthropic)" : ""}.{" "}
        {owner ? (
          <Link href="/mixes" className="underline">
            All my mixes
          </Link>
        ) : (
          <Link href="/mix" className="underline">
            Make your own mix
          </Link>
        )}
      </p>
    </main>
  );
}
