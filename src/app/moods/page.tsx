import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { MoodCreateForm } from "@/components/library/mood-create-form";
import { ShelfTabs } from "@/components/library/shelf-tabs";
import { getMyMoods, type MoodSummary } from "@/lib/library/queries";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Moods Feed · AIRED" };

// The listener's own runs. Where the Volley Ledger is the makers' sequence, a
// mood is the listener's — same instinct that order carries meaning, pointed the
// other way. Private: nobody else can see these, by RLS, not by omission.
export default async function MoodsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/moods");

  const supabase = await createClient();
  const moods = await getMyMoods(supabase, user.id);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:py-10">
      {/* The other half of the phone's single Shelf entry — see /adorned. */}
      <ShelfTabs />

      <header className="mb-7 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">
            Moods Feed
          </h1>
          <p className="text-sm text-muted">
            Your own runs through the catalog, in the order you meant them.
          </p>
        </div>
        <MoodCreateForm />
      </header>

      {moods.length > 0 ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {moods.map((mood) => (
            <li key={mood.id}>
              <MoodCard mood={mood} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-white/12 px-6 py-16 text-center">
          <p className="max-w-md text-sm leading-relaxed text-muted">
            No moods yet. Name one above, then add songs to it from{" "}
            <span className="text-foreground">Add to a mood</span> on any
            song&rsquo;s page.
          </p>
          <Link
            href="/"
            className="rounded-lg border border-white/12 px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-white/[0.06]"
          >
            Go listening
          </Link>
        </div>
      )}
    </main>
  );
}

// A mood reads as a stack of the art it holds — up to four covers in a quilt,
// so the shelf is recognizable at a glance rather than a column of words.
function MoodCard({ mood }: { mood: MoodSummary }) {
  const covers = mood.coverUrls.slice(0, 4);

  return (
    <Link
      href={`/moods/${mood.id}`}
      className="group flex flex-col gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-3 transition hover:border-white/15 hover:bg-white/[0.04]"
    >
      <div className="relative aspect-square overflow-hidden rounded-lg border border-white/8">
        {covers.length > 0 ? (
          <div
            className={`grid h-full w-full ${covers.length > 1 ? "grid-cols-2 grid-rows-2" : ""}`}
          >
            {covers.map((url, i) => (
              <div key={`${mood.id}-${i}`} className="relative h-full w-full">
                <Image
                  src={url}
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 120px, 25vw"
                  className="object-cover transition group-hover:scale-[1.02]"
                  unoptimized
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-white/[0.04] to-transparent text-[10px] uppercase tracking-[0.18em] text-muted/50">
            empty
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {/* Same reason as the mood page's title: a name with no spaces has
            nowhere to wrap. The clamp already stopped it escaping the card —
            break-words is what makes the second line readable instead of blank. */}
        <span className="line-clamp-2 h-[2.5rem] text-sm font-medium leading-tight break-words text-foreground">
          {mood.name}
        </span>
        <span className="font-mono text-[11px] text-muted/60">
          {mood.songCount} {mood.songCount === 1 ? "song" : "songs"}
        </span>
      </div>
    </Link>
  );
}
