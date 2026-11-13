import { after, NextResponse } from "next/server";

import { formatWorkLabel } from "@/lib/catalog";
import { triggerMixTranscode } from "@/lib/mixes/worker";
import { createClient } from "@/lib/supabase/server";
import { getWorkById } from "@/lib/works/queries";

// POST /api/mixes — keep a mix on the signer's AIRED account.
//
// The browser has already uploaded the rendered mix to the private `masters`
// bucket, inside the signer's own folder (storage RLS enforces that). This
// route records it, as the signer (table RLS), and asks the worker to turn it
// into a stream on R2. The credits are built HERE from the live source works,
// never taken from the client, so every maker of every source song is named
// exactly as the catalog names them (CLAUDE.md §3a) and nothing else is.
//
// Body: { master_path, title, duration_seconds, bpm?, energy?, dj_name?,
//         story?, planned_by?, source_work_ids: number[] }

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENERGIES = ["Lounge", "Club", "Peak"];

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t || null;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to keep mixes on AIRED." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const masterPath = typeof body.master_path === "string" ? body.master_path : "";
  if (!masterPath.startsWith(`${user.id}/`) || masterPath.includes("..")) {
    return NextResponse.json({ error: "Bad upload path." }, { status: 400 });
  }
  const title = text(body.title, 120);
  const duration = Number(body.duration_seconds);
  if (!title || !Number.isFinite(duration) || duration <= 0) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const ids = (Array.isArray(body.source_work_ids) ? body.source_work_ids : [])
    .map(Number)
    .filter((n) => Number.isSafeInteger(n) && n > 0);
  const unique = [...new Set(ids)].slice(0, 6);
  const works = (await Promise.all(unique.map((id) => getWorkById(supabase, id)))).filter((w) => w !== null);
  if (works.length === 0) return NextResponse.json({ error: "No source songs found." }, { status: 400 });
  const credits = works.map((w) => ({
    work_id: w.id,
    label: formatWorkLabel(w.id, w.title),
    by: w.contributors.map((c) => c.name).join(", ") || "AIRED",
  }));

  const energy = typeof body.energy === "string" && ENERGIES.includes(body.energy) ? body.energy : null;
  const bpm = Number(body.bpm);
  const { data, error } = await supabase
    .from("mix")
    .insert({
      owner_id: user.id,
      title,
      duration_seconds: Math.round(duration * 100) / 100,
      bpm: Number.isFinite(bpm) && bpm > 0 ? Math.round(bpm * 10) / 10 : null,
      energy,
      dj_name: text(body.dj_name, 40),
      story: text(body.story, 600),
      planned_by: body.planned_by === "brain" ? "brain" : "rules",
      source_work_ids: works.map((w) => w.id),
      credits,
      master_storage_path: masterPath,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[mixes] insert failed", error);
    return NextResponse.json({ error: "Couldn't save the mix." }, { status: 500 });
  }

  after(() => triggerMixTranscode(data.id));
  return NextResponse.json({ id: data.id });
}
