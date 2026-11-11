// Pull the AAC audio out of AIRED's HLS segments so the browser can decode it.
//
// The worker packages every song as MPEG-TS segments carrying ADTS-framed AAC
// (worker/src/ffmpeg.js). hls.js remuxes those for the <audio> element, but the
// mixer needs raw PCM in Web Audio, and decodeAudioData does not accept MPEG-TS.
// It DOES accept a bare ADTS stream, so we strip the transport wrapping: walk the
// 188-byte packets, follow PAT → PMT to the audio PID, and concatenate the PES
// payloads. Joining every segment's ADTS frames into ONE stream before decoding
// matters: decoding segments one by one would put an encoder-delay click at every
// six-second seam.

const PACKET = 188;
const SYNC = 0x47;
// PMT stream_type for AAC in ADTS (ISO/IEC 13818-7). 0x0f is what ffmpeg writes.
const STREAM_TYPE_AAC_ADTS = 0x0f;

function payloadStart(pkt: Uint8Array, off: number): number {
  const afc = (pkt[off + 3] >> 4) & 0x3;
  if (afc === 0 || afc === 2) return -1; // reserved, or adaptation field only
  if (afc === 3) return off + 5 + pkt[off + 4]; // skip the adaptation field
  return off + 4;
}

export function demuxAdts(ts: Uint8Array): Uint8Array {
  let pmtPid = -1;
  let audioPid = -1;
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (let off = 0; off + PACKET <= ts.length; off += PACKET) {
    if (ts[off] !== SYNC) {
      // Lost sync — scan forward to the next 0x47 that is followed by another.
      let next = off + 1;
      while (
        next + PACKET < ts.length &&
        !(ts[next] === SYNC && ts[next + PACKET] === SYNC)
      ) {
        next++;
      }
      off = next - PACKET;
      continue;
    }
    const pusi = (ts[off + 1] & 0x40) !== 0;
    const pid = ((ts[off + 1] & 0x1f) << 8) | ts[off + 2];
    let p = payloadStart(ts, off);
    const end = off + PACKET;
    if (p < 0 || p >= end) continue;

    if (pid === 0 && pmtPid < 0) {
      // PAT: pointer_field, then a table; first program's PMT PID.
      if (pusi) p += 1 + ts[p];
      const sectionLen = ((ts[p + 1] & 0x0f) << 8) | ts[p + 2];
      const progEnd = Math.min(p + 3 + sectionLen - 4, end);
      for (let q = p + 8; q + 4 <= progEnd; q += 4) {
        const program = (ts[q] << 8) | ts[q + 1];
        if (program !== 0) {
          pmtPid = ((ts[q + 2] & 0x1f) << 8) | ts[q + 3];
          break;
        }
      }
      continue;
    }

    if (pid === pmtPid && audioPid < 0) {
      if (pusi) p += 1 + ts[p];
      const sectionLen = ((ts[p + 1] & 0x0f) << 8) | ts[p + 2];
      const infoLen = ((ts[p + 10] & 0x0f) << 8) | ts[p + 11];
      const streamsEnd = Math.min(p + 3 + sectionLen - 4, end);
      let q = p + 12 + infoLen;
      let fallback = -1;
      while (q + 5 <= streamsEnd) {
        const type = ts[q];
        const esPid = ((ts[q + 1] & 0x1f) << 8) | ts[q + 2];
        const esInfo = ((ts[q + 3] & 0x0f) << 8) | ts[q + 4];
        if (type === STREAM_TYPE_AAC_ADTS) {
          audioPid = esPid;
          break;
        }
        if (fallback < 0 && (type === 0x03 || type === 0x04)) fallback = esPid;
        q += 5 + esInfo;
      }
      if (audioPid < 0) audioPid = fallback;
      continue;
    }

    if (pid !== audioPid || audioPid < 0) continue;

    if (pusi) {
      // PES header: 00 00 01 | stream_id | length(2) | flags(2) | hdr_len | …
      if (ts[p] !== 0 || ts[p + 1] !== 0 || ts[p + 2] !== 1) continue;
      p += 9 + ts[p + 8];
      if (p >= end) continue;
    }
    const chunk = ts.subarray(p, end);
    chunks.push(chunk);
    total += chunk.length;
  }

  const out = new Uint8Array(total);
  let w = 0;
  for (const c of chunks) {
    out.set(c, w);
    w += c.length;
  }
  return out;
}
