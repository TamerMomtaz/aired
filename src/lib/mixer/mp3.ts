// Turn a finished mix (our WAV) into an MP3, on the listener's device.
//
// The WAV stays the master (MixaTee keeps it, nothing is lost). The MP3 is for
// sharing and for phones and cars: about a tenth of the size at 192 kbps. The
// credits inside the WAV (RIFF INFO) are carried over as ID3 tags, so every
// maker of every source song still travels with the file.

type Tags = { title: string; artist: string; comment: string; software: string };

const KBPS = 192;
const BLOCK = 1152 * 40; // samples per encode step; yield to the page between

function readWav(buf: ArrayBuffer): { channels: number; sampleRate: number; pcm: Int16Array; tags: Tags } {
  const dv = new DataView(buf);
  const id = (o: number) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (id(0) !== "RIFF" || id(8) !== "WAVE") throw new Error("Not a WAV file");
  let channels = 2;
  let sampleRate = 44100;
  let pcm: Int16Array | null = null;
  const tags: Tags = { title: "", artist: "", comment: "", software: "" };
  const dec = new TextDecoder();
  for (let o = 12; o + 8 <= buf.byteLength; ) {
    const cid = id(o);
    const len = dv.getUint32(o + 4, true);
    const body = o + 8;
    if (cid === "fmt ") {
      channels = dv.getUint16(body + 2, true);
      sampleRate = dv.getUint32(body + 4, true);
      if (dv.getUint16(body + 14, true) !== 16) throw new Error("Only 16-bit WAV is supported");
    } else if (cid === "data") {
      const n = Math.floor(Math.min(len, buf.byteLength - body) / 2);
      pcm = body % 2 === 0 ? new Int16Array(buf, body, n) : new Int16Array(buf.slice(body, body + n * 2));
    } else if (cid === "LIST" && id(body) === "INFO") {
      for (let p = body + 4; p + 8 <= body + len; ) {
        const fid = id(p);
        const flen = dv.getUint32(p + 4, true);
        const text = dec.decode(new Uint8Array(buf, p + 8, flen)).replace(/\0+$/, "");
        if (fid === "INAM") tags.title = text;
        if (fid === "IART") tags.artist = text;
        if (fid === "ICMT") tags.comment = text;
        if (fid === "ISFT") tags.software = text;
        p += 8 + flen + (flen % 2);
      }
    }
    o = body + len + (len % 2);
  }
  if (!pcm) throw new Error("The WAV has no audio");
  return { channels, sampleRate, pcm, tags };
}

// A minimal ID3v2.3 tag: title, artist, comment (the credits) and encoder,
// all as UTF-16 text so Arabic names come through intact.
function id3(tags: Tags): Uint8Array {
  const utf16 = (s: string) => {
    const out = new Uint8Array(2 + s.length * 2);
    out[0] = 0xff;
    out[1] = 0xfe; // BOM, little-endian
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      out[2 + i * 2] = c & 0xff;
      out[3 + i * 2] = c >> 8;
    }
    return out;
  };
  const frame = (fid: string, payload: Uint8Array) => {
    const f = new Uint8Array(10 + payload.length);
    for (let i = 0; i < 4; i++) f[i] = fid.charCodeAt(i);
    new DataView(f.buffer).setUint32(4, payload.length);
    f.set(payload, 10);
    return f;
  };
  const text = (s: string) => {
    const t = utf16(s);
    const p = new Uint8Array(1 + t.length + 2); // encoding byte, text, UTF-16 terminator
    p[0] = 1;
    p.set(t, 1);
    return p;
  };
  const comment = (s: string) => {
    const desc = utf16("");
    const t = utf16(s);
    const p = new Uint8Array(1 + 3 + desc.length + 2 + t.length);
    p[0] = 1;
    p.set([0x65, 0x6e, 0x67], 1); // "eng"
    p.set(desc, 4);
    p.set(t, 4 + desc.length + 2);
    return p;
  };
  const frames = [
    tags.title && frame("TIT2", text(tags.title)),
    tags.artist && frame("TPE1", text(tags.artist)),
    tags.comment && frame("COMM", comment(tags.comment)),
    frame("TSSE", text(tags.software || "AIRED Mixer")),
  ].filter((f): f is Uint8Array<ArrayBuffer> => !!f);
  const size = frames.reduce((n, f) => n + f.length, 0);
  const out = new Uint8Array(10 + size);
  out.set([0x49, 0x44, 0x33, 3, 0, 0], 0); // "ID3" v2.3, no flags
  // Sync-safe size: 7 bits per byte.
  out[6] = (size >> 21) & 0x7f;
  out[7] = (size >> 14) & 0x7f;
  out[8] = (size >> 7) & 0x7f;
  out[9] = size & 0x7f;
  let w = 10;
  for (const f of frames) {
    out.set(f, w);
    w += f.length;
  }
  return out;
}

export async function wavToMp3(wav: Blob, onProgress?: (fraction: number) => void): Promise<Blob> {
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const { channels, sampleRate, pcm, tags } = readWav(await wav.arrayBuffer());
  const frames = Math.floor(pcm.length / channels);
  const enc = new Mp3Encoder(Math.min(2, channels), sampleRate, KBPS);
  const parts: BlobPart[] = [id3(tags) as Uint8Array<ArrayBuffer>];
  const left = new Int16Array(BLOCK);
  const right = new Int16Array(BLOCK);
  for (let f = 0; f < frames; f += BLOCK) {
    const n = Math.min(BLOCK, frames - f);
    for (let i = 0; i < n; i++) {
      const k = (f + i) * channels;
      left[i] = pcm[k];
      right[i] = channels > 1 ? pcm[k + 1] : pcm[k];
    }
    const out = channels > 1 ? enc.encodeBuffer(left.subarray(0, n), right.subarray(0, n)) : enc.encodeBuffer(left.subarray(0, n));
    if (out.length) parts.push(new Uint8Array(out));
    onProgress?.(Math.min(1, (f + n) / frames));
    await new Promise((r) => setTimeout(r, 0));
  }
  const tail = enc.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  return new Blob(parts, { type: "audio/mpeg" });
}
