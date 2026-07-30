// Who may act on a work — the artist, or the hands that carried it.
//
// Reciprocal provenance gives a work TWO honest human-facing facts, and they are
// not the same person:
//
//   • `creator_id`             — THE ARTIST. Whose rail, catalog, and albums the
//                                work belongs to. For a delegated publish this is
//                                the credited PERFORMER (an AI performer has a
//                                first-class artist identity here, exactly like a
//                                carbon artist).
//   • `published_by_authority` — THE HANDS. The human whose delegated token
//                                carried the work to shore. NULL on a hand upload,
//                                where the session user is already both.
//
// An AI performer has no session and never signs in, so if only `creator_id`
// could act on a work, a delegated draft would be unreachable by anyone: nobody
// could promote it, edit it, or discard it. That would quietly break the whole
// no-autonomy guarantee — a human MUST still be the one who publishes. So the
// carrying human keeps the human-in-the-loop rights over what they carried.
//
// This is the ONE definition of that predicate on the app side; its structural
// twin lives in RLS (see the performer_placement_and_carrier_rights migration),
// which is what actually enforces it. Keep the two in step.

/** The columns any manageability question needs. */
export type WorkPlacement = {
  creator_id: string | null;
  published_by_authority?: string | null;
};

/**
 * True when `userId` is the work's artist, or the human who carried it here.
 * Mirrors the `creator_id = auth.uid() or published_by_authority = auth.uid()`
 * predicate the RLS policies use.
 */
export function canManageWork(
  work: WorkPlacement | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (!work || !userId) return false;
  return work.creator_id === userId || work.published_by_authority === userId;
}

/** True when the work sits on someone else's rail and this user merely carried it. */
export function isCarriedForAnother(
  work: WorkPlacement | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (!work || !userId) return false;
  return (
    work.published_by_authority === userId && work.creator_id !== userId
  );
}

/**
 * The same predicate as a PostgREST `.or()` filter: works I am the artist of,
 * plus works I carried for a performer. `userId` is always a server-verified
 * uuid from the session, never caller input, so it needs no escaping.
 */
export function manageableWorkFilter(userId: string): string {
  return `creator_id.eq.${userId},published_by_authority.eq.${userId}`;
}
