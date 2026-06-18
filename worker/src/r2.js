// Cloudflare R2 upload via the S3-compatible API.

import {
  DeleteObjectsCommand,
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
export async function uploadToR2({ bucket, key, body, contentType }) {
  const upload = new Upload({
    client: r2,
    params: { Bucket: bucket, Key: key, Body: body, ContentType: contentType },
  });
  await upload.done();
  return { bucket, key };
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
