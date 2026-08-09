"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { toggleAdornment } from "@/lib/library/actions";

// Which songs the signed-in listener has ADORNED, held once for the whole app.
//
// Why a shared set rather than per-button state: the same song can be on screen
// twice at once — a card in the feed and the now-playing bar above it — and a
// heart tapped in one place has to fill in the other immediately. One set means
// they cannot disagree.
//
// The set is seeded server-side on every full render (see the root layout) and
// reconciled against what the server action actually did on every tap, so an
// optimistic paint never survives being wrong.

type AdornedContextValue = {
  isAdorned: (workId: number) => boolean;
  toggle: (workId: number) => void;
  // False for a signed-out visitor: the heart still shows, but tapping it goes
  // to sign-up rather than pretending to keep something.
  signedIn: boolean;
};

const AdornedContext = createContext<AdornedContextValue | null>(null);

export function useAdorned(): AdornedContextValue {
  const ctx = useContext(AdornedContext);
  if (!ctx) {
    throw new Error("useAdorned must be used within <AdornedProvider>");
  }
  return ctx;
}

export function AdornedProvider({
  initialIds,
  signedIn,
  children,
}: {
  initialIds: number[];
  signedIn: boolean;
  children: React.ReactNode;
}) {
  const [ids, setIds] = useState<Set<number>>(() => new Set(initialIds));

  // The set is also read synchronously inside toggle(), where reading `ids`
  // would close over a stale render. One ref, kept in step.
  const idsRef = useRef(ids);
  const apply = useCallback((next: Set<number>) => {
    idsRef.current = next;
    setIds(next);
  }, []);

  // A fresh server render — a hard load, a sign-in, a revalidate — carries the
  // truth. Adopt it when its CONTENT changes, not merely its identity: a prop
  // array is a new object on every render and would otherwise stomp an in-flight
  // optimistic tap on every unrelated re-render.
  const seedKey = initialIds.join(",");
  const lastSeed = useRef(seedKey);
  useEffect(() => {
    if (lastSeed.current === seedKey) return;
    lastSeed.current = seedKey;
    apply(new Set(initialIds));
  }, [seedKey, initialIds, apply]);

  const toggle = useCallback(
    (workId: number) => {
      const wasAdorned = idsRef.current.has(workId);
      const optimistic = new Set(idsRef.current);
      if (wasAdorned) optimistic.delete(workId);
      else optimistic.add(workId);
      apply(optimistic);

      void toggleAdornment(workId)
        .then((res) => {
          // Settle on what the database says, whatever we guessed. On failure
          // the heart springs back — the UI telling the truth IS the error
          // message here; there is no toast to lie in.
          const settled = new Set(idsRef.current);
          const adorned = res.ok ? res.adorned : wasAdorned;
          if (adorned) settled.add(workId);
          else settled.delete(workId);
          apply(settled);
          if (!res.ok) console.error("[adorn]", res.error);
        })
        .catch((err) => {
          const reverted = new Set(idsRef.current);
          if (wasAdorned) reverted.add(workId);
          else reverted.delete(workId);
          apply(reverted);
          console.error("[adorn]", err);
        });
    },
    [apply],
  );

  const value = useMemo<AdornedContextValue>(
    () => ({
      isAdorned: (workId: number) => ids.has(workId),
      toggle,
      signedIn,
    }),
    [ids, toggle, signedIn],
  );

  return (
    <AdornedContext.Provider value={value}>{children}</AdornedContext.Provider>
  );
}
