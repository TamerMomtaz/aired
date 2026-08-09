"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  addWorkToMood,
  createMood,
  listMoodsForWork,
  type MoodChoice,
} from "@/lib/library/actions";

// "Add to a mood" — the sheet that puts a song into one of the listener's own
// runs, or starts a new one named on the spot.
//
// The mood list is fetched when the sheet OPENS, never rendered into the page
// behind every card. Follows the share sheet's shape (bottom sheet on a phone,
// centred dialog on a desktop) so the two feel like the same platform.

export function AddToMood({
  workId,
  title,
  signedIn,
  // Given, the trigger reads as a labelled pill beside Share and QR; omitted,
  // it's a bare "+" for tighter rows.
  label,
  triggerClassName = "",
}: {
  workId: number;
  title: string;
  signedIn: boolean;
  label?: string;
  triggerClassName?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [moods, setMoods] = useState<MoodChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // While the sheet is open: lock body scroll, close on Escape, focus the close
  // button so a keyboard user lands inside the dialog. (Same contract as the
  // share sheet.)
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Load the moods each time the sheet opens, so a mood made a moment ago on
  // another page is already here.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listMoodsForWork(workId).then((res) => {
      if (cancelled) return;
      if (res.ok) setMoods(res.moods);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [open, workId]);

  useEffect(() => {
    if (naming) nameRef.current?.focus();
  }, [naming]);

  function openSheet(e: React.MouseEvent) {
    // The trigger can sit over a card-level link; never let it navigate too.
    e.preventDefault();
    e.stopPropagation();
    if (!signedIn) {
      router.push(`/signup?next=${encodeURIComponent(pathname || "/")}`);
      return;
    }
    // Reset here rather than in the open effect: clearing state synchronously
    // inside an effect body cascades a second render for no reason.
    setNaming(false);
    setNewName("");
    setError(null);
    setOpen(true);
  }

  async function addTo(mood: MoodChoice) {
    if (mood.contains || busyId) return;
    setBusyId(mood.id);
    setError(null);
    const res = await addWorkToMood(mood.id, workId);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMoods((prev) =>
      (prev ?? []).map((m) => (m.id === mood.id ? { ...m, contains: true } : m)),
    );
    router.refresh();
  }

  async function createAndAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    const res = await createMood({ name, workId });
    setCreating(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNaming(false);
    setNewName("");
    setMoods((prev) => [{ id: res.moodId, name, contains: true }, ...(prev ?? [])]);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        aria-label={`Add ${title} to a mood`}
        title="Add to a mood"
        className={
          triggerClassName ||
          "flex size-9 items-center justify-center rounded-full text-muted transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cert-red/50 active:scale-95"
        }
      >
        <PlusIcon />
        {label}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Add ${title} to a mood`}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[80dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-2xl border border-white/10 bg-[#0d0d0d] p-5 shadow-2xl sm:rounded-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-base font-semibold text-foreground">
                  Add to a mood
                </h2>
                <p className="max-w-[16rem] truncate text-xs text-muted">
                  {title}
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="inline-flex size-8 items-center justify-center rounded-full border border-white/10 text-muted transition hover:border-white/25 hover:text-foreground"
              >
                <CloseIcon />
              </button>
            </div>

            {error ? (
              <p role="alert" className="text-xs text-cert-red">
                {error}
              </p>
            ) : null}

            {naming ? (
              <form onSubmit={createAndAdd} className="flex flex-col gap-2">
                <label
                  htmlFor={`new-mood-${workId}`}
                  className="text-xs uppercase tracking-[0.16em] text-muted/70"
                >
                  Name the mood
                </label>
                <input
                  id={`new-mood-${workId}`}
                  ref={nameRef}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={80}
                  placeholder="Late and honest"
                  className="rounded-lg border border-white/12 bg-white/[0.03] px-3 py-2.5 text-sm text-foreground placeholder:text-muted/40 focus:border-cert-red/60 focus:outline-none"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={!newName.trim() || creating}
                    className="rounded-lg bg-cert-red px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-40"
                  >
                    {creating ? "Making…" : "Make it"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNaming(false)}
                    className="rounded-lg border border-white/12 px-4 py-2 text-sm text-muted transition hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setNaming(true)}
                className="flex items-center gap-3 rounded-xl border border-dashed border-white/15 px-4 py-3 text-left text-sm text-foreground transition hover:border-cert-red/50 hover:bg-white/[0.03]"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-cert-red/15 text-cert-red">
                  <PlusIcon />
                </span>
                New mood
              </button>
            )}

            {moods === null ? (
              <p className="py-2 text-xs text-muted">Looking…</p>
            ) : moods.length === 0 ? (
              <p className="py-2 text-xs leading-relaxed text-muted">
                No moods yet. Name your first one and this song starts it.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {moods.map((mood) => (
                  <li key={mood.id}>
                    <button
                      type="button"
                      onClick={() => addTo(mood)}
                      disabled={mood.contains || busyId !== null}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-left text-sm text-foreground transition enabled:hover:border-white/25 enabled:hover:bg-white/[0.05] disabled:cursor-default"
                    >
                      <span className="min-w-0 truncate">{mood.name}</span>
                      {mood.contains ? (
                        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-cert-red">
                          <CheckIcon />
                          In it
                        </span>
                      ) : busyId === mood.id ? (
                        <span className="shrink-0 text-xs text-muted">
                          Adding…
                        </span>
                      ) : (
                        <span className="shrink-0 text-xs text-muted">Add</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[18px]"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m20 6-11 11-5-5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
