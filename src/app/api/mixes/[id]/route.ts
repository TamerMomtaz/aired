import { after, NextResponse } from "next/server";

import { MIX_ID_RE } from "@/lib/mixes/types";
import { purgeMixStorage } from "@/lib/mixes/worker";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/mixes/:id — rename a mix or switch its Share on/off.
// DELETE /api/mixes/:id — delete a mix and its stream.
// Both run as the signer, so RLS lets them touch only their own mixes.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function signedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!MIX_ID_RE.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { supabase, user } = await signedIn();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const patch: { title?: string; shared?: boolean } = {};
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim().slice(0, 120);
  if (typeof body.shared === "boolean") patch.shared = body.shared;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const { data, error } = await supabase
    .from("mix")
    .update(patch)
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id, title, shared")
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Couldn't change that mix." }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!MIX_ID_RE.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { supabase, user } = await signedIn();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { data, error } = await supabase
    .from("mix")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id, master_storage_path")
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Couldn't delete that mix." }, { status: 404 });
  after(() => purgeMixStorage(data.id, data.master_storage_path));
  return NextResponse.json({ ok: true });
}
