"use server";

import { createClient } from "@/lib/supabase/server";

// Record one real listen — server-side, never a client counter (the task's whole
// point). The PlayerProvider calls this once a track has actually been listened
// to past the threshold (~15s, or 25% of a short track). All the honesty lives in
// the `record_play` RPC (CLAUDE.md-style atomic logic in one SECURITY DEFINER
// function): it counts only LIVE works, debounces to one play per (session, work)
// per rolling hour so seeking/replaying can't spam it, and attributes the play to
// the verified session's user (auth.uid()) — never a client-supplied id.
//
// Fire-and-forget from the client: we don't revalidate here (no need to refresh
// the page mid-listen), so the new count simply shows on the next render.
export async function recordPlay(
  workId: number,
  sessionId: string,
): Promise<{ recorded: boolean }> {
  if (!Number.isInteger(workId) || workId <= 0) {
    return { recorded: false };
  }
  const sid = (sessionId ?? "").trim();
  if (!sid || sid.length > 100) {
    return { recorded: false };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_play", {
    p_work_id: workId,
    p_session_id: sid,
  });

  if (error) {
    return { recorded: false };
  }
  return { recorded: data === true };
}
