// Tiny structured-ish logger. Everything is prefixed so transcode lines are
// easy to grep in Railway logs. We never log secret values.

function ts() {
  return new Date().toISOString();
}

export function log(msg) {
  console.log(`${ts()} [transcode] ${msg}`);
}

export function logErr(msg, err) {
  if (err) {
    console.error(`${ts()} [transcode] ERROR ${msg}: ${err?.stack ?? err}`);
  } else {
    console.error(`${ts()} [transcode] ERROR ${msg}`);
  }
}
