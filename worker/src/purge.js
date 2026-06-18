// Storage purge for a discarded work (EDIT & TIDY — Discard). The Next.js action
// has already deleted the work row (and, by ON DELETE CASCADE, its volley / cert
// / play rows). This sweeps the heavy, work-unique BLOBS that no cascade can
// reach, so a discarded attempt leaves nothing stranded:
//   • R2 aired-masters/work/{id}/…   — the master copy
//   • R2 aired-hls/work/{id}/…       — the HLS playlist + segments
//   • Supabase masters/{path}        — the private transcode source (if known)
//
// All keys are derived from work_id (R2) or passed in (the master path), so the
// purge needs no DB row — correct precisely because the row is already gone.
// Artwork is intentionally NOT deleted here: an album cover_url may reference a
// song's artwork, so reclaiming the tiny public image is left alone to avoid
// breaking a cover. Each step is independent and best-effort; one failure is
// logged and does not abort the rest.

import { config } from "./config.js";
import { log, logErr } from "./logger.js";
import { deleteByPrefix } from "./r2.js";
import { deleteMasterObject } from "./supabase.js";

export async function purgeWork(workId, { masterStoragePath } = {}) {
  const prefix = `work/${workId}/`;
  const result = { workId, mastersDeleted: 0, hlsDeleted: 0, sourceDeleted: 0 };

  await Promise.all([
    deleteByPrefix({ bucket: config.r2MastersBucket, prefix })
      .then((n) => {
        result.mastersDeleted = n;
      })
      .catch((err) => logErr(`work=${workId} R2 masters purge failed`, err)),
    deleteByPrefix({ bucket: config.r2HlsBucket, prefix })
      .then((n) => {
        result.hlsDeleted = n;
      })
      .catch((err) => logErr(`work=${workId} R2 hls purge failed`, err)),
    deleteMasterObject(masterStoragePath)
      .then(({ removed }) => {
        result.sourceDeleted = removed;
      })
      .catch((err) => logErr(`work=${workId} master source purge failed`, err)),
  ]);

  log(
    `work=${workId} purged masters=${result.mastersDeleted} hls=${result.hlsDeleted} source=${result.sourceDeleted}`,
  );
  return result;
}
