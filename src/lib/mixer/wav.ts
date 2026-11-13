// Encode a rendered mix as a 16-bit PCM WAV — the one format every phone, car
// and DAW opens — with a RIFF INFO chunk carrying the mix's provenance: which
// AIRED works it was built from, and who made them. The credits travel inside
// the file, not just on the page.

export type WavTags = {
  title: string; // INAM
  artist: string; // IART
  comment: string; // ICMT — the source works and their contributors
  software: string; // ISFT
  // ISBJ — how the set runs, part by part with times ("1:07 Song · cut ·
  // drop"), so a moment someone points at can be traced to what the Mixer did.
  setList?: string;
};

function infoChunk(tags: WavTags): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const fields: [string, string][] = [
    ["INAM", tags.title],
    ["IART", tags.artist],
    ["ICMT", tags.comment],
    ["ISFT", tags.software],
    ...(tags.setList ? ([["ISBJ", tags.setList]] as [string, string][]) : []),
  ];
  const parts: Uint8Array[] = [];
  for (const [id, value] of fields) {
    const text = enc.encode(value + "\0");
    const padded = text.length + (text.length % 2);
    const sub = new Uint8Array(8 + padded);
    const dv = new DataView(sub.buffer);
    sub.set(enc.encode(id), 0);
    dv.setUint32(4, text.length, true);
    sub.set(text, 8);
    parts.push(sub);
  }
  const bodyLen = 4 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(8 + bodyLen);
  const dv = new DataView(out.buffer);
  out.set(enc.encode("LIST"), 0);
  dv.setUint32(4, bodyLen, true);
  out.set(enc.encode("INFO"), 8);
  let w = 12;
  for (const p of parts) {
    out.set(p, w);
    w += p.length;
  }
  return out;
}

export function encodeWav(buf: AudioBuffer, tags: WavTags): Blob {
  const channels = buf.numberOfChannels;
  const frames = buf.length;
  const dataLen = frames * channels * 2;
  const info = infoChunk(tags);

  const header = new ArrayBuffer(36);
  const h = new DataView(header);
  const ascii = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) h.setUint8(o + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  h.setUint32(4, 4 + 24 + info.length + 8 + dataLen, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  h.setUint32(16, 16, true);
  h.setUint16(20, 1, true); // PCM
  h.setUint16(22, channels, true);
  h.setUint32(24, buf.sampleRate, true);
  h.setUint32(28, buf.sampleRate * channels * 2, true);
  h.setUint16(32, channels * 2, true);
  h.setUint16(34, 16, true);

  const dataHeader = new ArrayBuffer(8);
  const dh = new DataView(dataHeader);
  dh.setUint32(0, 0x61746164, true); // "data"
  dh.setUint32(4, dataLen, true);

  const pcm = new Int16Array(frames * channels);
  const chans = Array.from({ length: channels }, (_, c) => buf.getChannelData(c));
  for (let i = 0, w = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++, w++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      pcm[w] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
  }

  return new Blob([header, info, dataHeader, pcm], { type: "audio/wav" });
}
