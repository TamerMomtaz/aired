// REEL JOBS — a small in-memory render queue with progress. A full-song lyric
// video (up to 12:00) takes minutes to render, so it is a JOB the app polls —
// "queued · 2nd in line", "rendering 37%" — never a request held open, never a
// blocking spinner.
//
// Two lanes, so a long render never stands in front of a teaser:
//   snippet  ≤50s reels, seconds each      (config.reelSnippetConcurrency)
//   full     whole songs, minutes each     (config.reelFullConcurrency)
//
// R2 is the source of truth for "done": a finished job is simply forgotten and
// the next poll finds the MP4 in the bucket. A FAILED job is remembered for a
// while so polls can report the failure instead of silently re-queueing it on
// every tick; a deliberate retry forgets it first. In-memory on purpose: a
// worker restart drops the queue, and the app's next poll re-enqueues (a render
// is idempotent by its R2 key).

import { logErr } from "./logger.js";

const FAILED_TTL_MS = 10 * 60_000;

export function createJobQueue(limits) {
  const jobs = new Map(); // key → job
  const waiting = Object.fromEntries(Object.keys(limits).map((l) => [l, []]));
  const running = Object.fromEntries(Object.keys(limits).map((l) => [l, 0]));

  function start(job) {
    running[job.lane]++;
    job.state = "rendering";
    job.startedAt = Date.now();
    const report = (fraction) => {
      if (Number.isFinite(fraction)) job.progress = Math.min(1, Math.max(0, fraction));
    };
    Promise.resolve()
      .then(() => job.run(report))
      .then(
        () => {
          jobs.delete(job.key);
        },
        (err) => {
          logErr(`reel ${job.key} failed`, err);
          job.state = "failed";
          job.error = err?.message ?? String(err);
          setTimeout(() => {
            if (jobs.get(job.key) === job) jobs.delete(job.key);
          }, FAILED_TTL_MS).unref();
        },
      )
      .finally(() => {
        running[job.lane]--;
        pump(job.lane);
      });
  }

  function pump(lane) {
    while (running[lane] < limits[lane] && waiting[lane].length > 0) {
      start(waiting[lane].shift());
    }
  }

  // A job as the app sees it.
  function view(job) {
    const position = job.state === "queued" ? waiting[job.lane].indexOf(job) + 1 : 0;
    return {
      state: job.state,
      progress: job.progress,
      position,
      error: job.error ?? null,
    };
  }

  return {
    // The current status of the job for `key`, or null if there is none.
    status(key) {
      const job = jobs.get(key);
      return job ? view(job) : null;
    },

    // Queue a render (a no-op returning the existing status if `key` is
    // already queued, rendering, or recently failed).
    enqueue({ key, lane, run }) {
      const existing = jobs.get(key);
      if (existing) return view(existing);
      if (!(lane in limits)) throw new Error(`unknown lane "${lane}"`);
      const job = { key, lane, run, state: "queued", progress: 0, enqueuedAt: Date.now() };
      jobs.set(key, job);
      waiting[lane].push(job);
      pump(lane);
      return view(job);
    },

    // Drop a FAILED job so a retry can enqueue it afresh.
    forgetFailed(key) {
      const job = jobs.get(key);
      if (job?.state === "failed") jobs.delete(key);
    },
  };
}
