// Signed upload grants — how a full-length master reaches the private bucket.
//
// THE PROBLEM THIS SOLVES. The delegated door accepts an inline audio part, but
// a serverless request body is capped (4.5 MB on Vercel) — about three minutes
// of 192 kbps MP3. CLAUDE.md Rule 4 says there is NO song length cap, and a
// 12-minute track is a deliberate differentiator. So the inline path could not
// carry most of the music AIRED exists for, and the only alternative — putting
// the master in the bucket first — required the caller to already hold a
// Supabase session or the service-role key. A delegated caller holds neither.
// It holds an ingest token, and that is all it should ever need.
//
// So: the caller proves authority with the token it already has, and gets back a
// short-lived, folder-scoped URL it can PUT the master straight to. The bytes go
// browser/agent → Supabase Storage, never through the serverless function, so
// there is no request-body ceiling at all. Then it publishes with
// `audio.master_path`, the mode the door already had.
//
// WHAT THIS DOES NOT CHANGE — and must never change. This is only how the bytes
// arrive. Placement (the work files under the credited performer), the
// reciprocal ledger (the authorizing human written in as the hands, role
// `audit`, origin HUMAN), enforce_publish_honesty, guard_work_placement, and the
// draft-on-arrival rule are all downstream of ingestWork() and untouched here.
// Nobody is credited differently because their master took a different road.
//
// THE SCOPING GUARANTEE. The caller does NOT get to say where the object goes.
// The path is derived entirely from the token's own authority plus a fresh
// server-minted uuid; the only thing a caller influences is the file extension,
// and that is sanitized to a short alphanumeric. There is therefore no input —
// no `../`, no absolute path, no other artist's uuid — that can produce a grant
// outside the authority's own folder. That is a structural property of this
// function, not a validation rule that could be bypassed.
//
// Masters only, deliberately. The `artwork` bucket is PUBLIC-read: handing out
// signed write URLs to it would let any token host arbitrary public files under
// the platform's domain. `masters` is private and never served (Rule 6 — audio
// reaches listeners only as HLS from R2), so a grant there can only ever feed
// the pipeline it was meant for. Artwork stays inline, where the size ceiling is
// not a real constraint for cover images.
//
// SERVER ONLY.

import { createServiceClient } from "@/lib/supabase/service";
import type { DelegatedGrant } from "./tokens";

/** The private bucket the web upload writes to. Never served directly (Rule 6). */
export const MASTERS_BUCKET = "masters";

// Fixed by Supabase Storage: a signed upload URL is valid for two hours, and the
// client library exposes no way to shorten it. Reported to the caller so it can
// plan a long upload, and stated here so nobody reads "short-lived" as tunable.
export const SIGNED_UPLOAD_TTL_SECONDS = 7200;

export type UploadGrant = {
  /** PUT the master here. Carries its own token; needs no other credential. */
  url: string;
  /** The same token, for clients using supabase-js `uploadToSignedUrl`. */
  token: string;
  /** Pass this back as `audio.master_path` when publishing. */
  path: string;
  bucket: string;
  expiresInSeconds: number;
};

export type UploadGrantResult =
  | { ok: true; grant: UploadGrant }
  | { ok: false; status: 400 | 500; error: string };

// A caller-supplied filename is used for ONE thing: keeping the extension, so
// the object is recognisable and the transcoder sees a sane name. Everything
// else about it is discarded. Anything that is not 1–5 alphanumerics after the
// last dot falls back to a neutral default.
function safeExtension(filename: string | null | undefined): string {
  const raw = (filename ?? "").trim().toLowerCase();
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return "mp3";
  const ext = raw.slice(dot + 1).replace(/[^a-z0-9]/g, "");
  return ext.length >= 1 && ext.length <= 5 ? ext : "mp3";
}

/**
 * Where a master lands, given ONLY the token's authority and an advisory
 * filename. Exported and pure so the scoping guarantee is provable on its own,
 * with no network and no credentials: for every possible `filename`, the result
 * is `<authorityProfileId>/<uuid>/master.<ext>`.
 *
 * `filename` contributes its extension and nothing else — it is never joined
 * into the path — so `../`, an absolute path, or another artist's uuid inside it
 * cannot move the object. The folder uuid is minted here, never accepted.
 */
export function masterObjectPath(
  authorityProfileId: string,
  filename?: string | null,
): string {
  return `${authorityProfileId}/${crypto.randomUUID()}/master.${safeExtension(filename)}`;
}

/**
 * Mint a signed upload URL for a master, scoped to the token's own folder.
 *
 * `filename` is advisory — only its extension survives. The folder is always
 * `<authority profile id>/<fresh uuid>/`, so a grant can never point anywhere
 * the token does not own.
 */
export async function createMasterUploadGrant(
  grant: DelegatedGrant,
  filename?: string | null,
): Promise<UploadGrantResult> {
  const { authorityProfileId } = grant;

  // The bytes are uploaded by the HUMAN's credential, into the human's own
  // folder — the same convention the web upload writes, and the same one
  // ingestWork()'s ownedByAuthority() check requires. A performer has no session
  // and uploads nothing, so a performer-scoped folder would be unwritable.
  const path = masterObjectPath(authorityProfileId, filename);

  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(MASTERS_BUCKET)
    // upsert:false — the folder uuid is fresh, so there is nothing to overwrite,
    // and a grant that cannot overwrite cannot be replayed to clobber a master.
    .createSignedUploadUrl(path, { upsert: false });

  if (error || !data) {
    return {
      ok: false,
      status: 500,
      error: error?.message ?? "Couldn't create the upload URL.",
    };
  }

  return {
    ok: true,
    grant: {
      url: data.signedUrl,
      token: data.token,
      path: data.path ?? path,
      bucket: MASTERS_BUCKET,
      expiresInSeconds: SIGNED_UPLOAD_TTL_SECONDS,
    },
  };
}
