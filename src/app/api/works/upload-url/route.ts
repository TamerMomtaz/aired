import { createMasterUploadGrant } from "@/lib/ingest/upload";
import {
  ingestConfigured,
  parseBearer,
  resolveIngestToken,
} from "@/lib/ingest/tokens";

// POST /api/works/upload-url — the door's other half, for full-length masters.
//
// CLAUDE.md Rule 4: no song length cap. A serverless request body is capped at
// 4.5 MB, which is roughly a three-minute MP3, so the inline audio part could
// never carry the 12-minute tracks the platform is built to accept. The fix is
// not a bigger request — it is no request: the caller PUTs the master straight
// to the private `masters` bucket and the bytes never touch this function.
//
// Getting into a private bucket used to need a Supabase session or the
// service-role key. A delegated caller has neither, and should never be handed
// the service key. So it presents the SAME bearer token the ingest door takes,
// and receives a short-lived URL scoped to its own folder. One credential, the
// one it already holds.
//
// The flow, end to end:
//   1. POST /api/works/upload-url      → { upload: { url, path, … } }
//   2. PUT <url> with the master bytes  (no size ceiling; direct to storage)
//   3. POST /api/works/ingest with audio.master_path = <path>
//      → lands as a DRAFT on the performer's rail, the authorizing human named
//        as the hands in its ledger. Identical to any other publish: this route
//        changes how the bytes arrive, never who is credited or where it files.
//
// Auth is the ingest door's, unchanged: constant-time token resolution, and a
// missing / blank / malformed / unknown token all get the same generic 401 with
// no detail. The presented token is never echoed or logged — and neither is the
// signed URL this route hands back, which is itself a credential.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized." }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "www-authenticate": 'Bearer realm="aired-ingest"',
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const token = parseBearer(request.headers.get("authorization"));
  if (!token) {
    return unauthorized();
  }
  const grant = resolveIngestToken(token);
  if (!grant) {
    if (!ingestConfigured()) {
      // Server-side only — the caller still sees a plain 401.
      console.error(
        "[upload-url] no delegated tokens are configured — set AIRED_INGEST_TOKENS (or AIRED_INGEST_SECRET + AIRED_INGEST_AUTHORITY).",
      );
    }
    return unauthorized();
  }

  // The body is optional and advisory. `filename` contributes its EXTENSION and
  // nothing else — the destination folder comes from the token's authority and a
  // server-minted uuid, so no value here can point the grant somewhere the token
  // does not own. A malformed body is simply ignored rather than rejected: there
  // is nothing in it we depend on.
  let filename: string | null = null;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as Record<string, unknown> | null;
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const value = body.filename;
        if (typeof value === "string") filename = value;
      }
    }
  } catch {
    filename = null;
  }

  let result: Awaited<ReturnType<typeof createMasterUploadGrant>>;
  try {
    result = await createMasterUploadGrant(grant, filename);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const misconfigured = detail.includes("SUPABASE_SERVICE_ROLE_KEY");
    console.error(`[upload-url] failed: ${detail}`);
    return json(
      {
        error: misconfigured
          ? "The delegated ingest door is not configured on this deployment."
          : "Couldn't create the upload URL.",
      },
      misconfigured ? 503 : 500,
    );
  }

  if (!result.ok) {
    return json({ error: result.error }, result.status);
  }

  const { url, token: uploadToken, path, bucket, expiresInSeconds } =
    result.grant;

  return json(
    {
      upload: {
        url,
        token: uploadToken,
        path,
        bucket,
        method: "PUT",
        expires_in_seconds: expiresInSeconds,
      },
      note: `PUT the master to upload.url, then POST /api/works/ingest with audio.master_path = "${path}". The master stays in the private bucket and is never served directly; the work still lands as a draft a human promotes.`,
    },
    201,
  );
}

// Same shape as the ingest door: anything but POST is a plain 405.
export async function GET(): Promise<Response> {
  return json({ error: "Use POST." }, 405);
}
