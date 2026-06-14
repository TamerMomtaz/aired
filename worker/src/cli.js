// Runnable command form: transcode one work_id directly, no HTTP / shared
// secret needed. Handy for a one-off run (e.g. `railway run npm run transcode -- 1`)
// and for long masters that might outlast an HTTP request timeout.
//
//   node src/cli.js <work_id>
//   npm run transcode -- <work_id>

import { log, logErr } from "./logger.js";
import { transcodeWork } from "./transcode.js";

const workId = Number(process.argv[2]);
if (!Number.isInteger(workId) || workId <= 0) {
  logErr("usage: node src/cli.js <work_id>   (work_id must be a positive integer)");
  process.exit(2);
}

transcodeWork(workId)
  .then((result) => {
    log(`cli done: ${JSON.stringify(result)}`);
    process.exit(0);
  })
  .catch((err) => {
    logErr(`work=${workId} transcode failed`, err);
    process.exit(1);
  });
