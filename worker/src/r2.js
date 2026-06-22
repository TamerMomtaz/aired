// Cloudflare R2 upload via the S3-compatible API.

import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

import { config } from "./config.js";

export const r2 = new S3Client({
  region: "auto", // R2 ignores region; "auto" is what Cloudflare documents.
  endpoint: config.r2Endpoint,
  forcePathStyle: true, // https://<account>.r2.cloudflarestorage.com/<bucket>/<key>
  credentials: {
    accessKeyId: config.r2AccessKeyId,
    secretAccessKey: config.r2SecretAccessKey,
  },
  // Newer AWS SDK v3 adds flexible (CRC32) checksums by default, which R2 has
  // rejected in some versions. Only send checksums when an operation requires
  // them — keeps lib-storage multipart uploads compatible with R2.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

// Upload a Buffer or a Node stream. lib-storage handles multipart for large
// streamed bodies (e.g. a 12-minute master), so this works for big files too.
// `contentDisposition` lets the share clip carry a friendly download filename
// when fetched straight off the CDN.
export async function uploadToR2({
  bucket,
  key,
  body,
  contentType,
  contentDisposition,
}) {
  const upload = new Upload({
    client: r2,
    params: {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ...(contentDisposition
        ? { ContentDisposition: contentDisposition }
        : {}),
    },
  });
  await upload.done();
  return { bucket, key };
}

// Stream one R2 object down to a local file (used to pull a song's master so
// ffmpeg can grab the clip's audio window from a plain local file — the proven
// transcode path, robust across audio containers). Returns the byte count.
export async function downloadFromR2({ bucket, key, destPath }) {
  const res = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!res.Body) {
    throw new Error(`R2 object ${bucket}/${key} returned no body`);
  }
  // On Node, the SDK's Body is a Readable stream — pipe it straight to disk.
  await pipeline(res.Body, createWriteStream(destPath));
  return { bytes: Number(res.ContentLength ?? 0) };
}

// Does an object exist? (HeadObject — used to skip re-rendering a cached clip.)
export async function objectExists({ bucket, key }) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === "NotFound") return false;
    throw err;
  }
}

// Delete every object under `prefix` in `bucket` (EDIT & TIDY — Discard). Lists
// in pages and batch-deletes (DeleteObjects takes up to 1000 keys per call), so
// a long track's many HLS segments are removed without a request per file. A
// missing/empty prefix simply deletes nothing — safe to call for a work that
// never finished transcoding. Returns the count removed.
export async function deleteByPrefix({ bucket, prefix }) {
  let continuationToken;
  let deleted = 0;

  do {
    const listed = await r2.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    const objects = (listed.Contents ?? [])
      .map((o) => ({ Key: o.Key }))
      .filter((o) => o.Key);

    if (objects.length > 0) {
      await r2.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects, Quiet: true },
        }),
      );
      deleted += objects.length;
    }

    continuationToken = listed.IsTruncated
      ? listed.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return deleted;
}

// Delete every object under `prefix` EXCEPT `exceptKey` — share-clip housekeeping
// (clip.js). When a song's teaser window changes, its clip is cached under a NEW
// versioned key; this sweeps the song's older windows (and any pre-versioning
// clip-{orientation}.mp4) once the new one is safely uploaded, so stale clips
// don't pile up. Best-effort and purely cosmetic: the app only ever requests the
// CURRENT window's key, so a leftover orphan is never served — failing this
// leaves a harmless extra file, never a wrong clip. Returns the count removed.
export async function deleteByPrefixExcept({ bucket, prefix, exceptKey }) {
  let continuationToken;
  let deleted = 0;

  do {
    const listed = await r2.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    const objects = (listed.Contents ?? [])
      .map((o) => ({ Key: o.Key }))
      .filter((o) => o.Key && o.Key !== exceptKey);

    if (objects.length > 0) {
      await r2.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects, Quiet: true },
        }),
      );
      deleted += objects.length;
    }

    continuationToken = listed.IsTruncated
      ? listed.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return deleted;
}
