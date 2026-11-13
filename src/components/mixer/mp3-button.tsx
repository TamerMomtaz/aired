"use client";

import { useState } from "react";

import { wavToMp3 } from "@/lib/mixer/mp3";

// "MP3": makes an MP3 of a finished mix on this device and downloads it. The
// WAV stays the master; the MP3 is about a tenth of the size, for sharing.
export function Mp3Button({
  getWav,
  fileName,
  className,
}: {
  getWav: () => Promise<Blob | null>;
  fileName: string; // without extension
  className: string;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  async function make() {
    if (progress !== null) return;
    setFailed(false);
    setProgress(0);
    try {
      const wav = await getWav();
      if (!wav) throw new Error("no audio");
      const mp3 = await wavToMp3(wav, setProgress);
      const url = URL.createObjectURL(mp3);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileName}.mp3`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setFailed(true);
    } finally {
      setProgress(null);
    }
  }

  return (
    <button type="button" onClick={() => void make()} disabled={progress !== null} className={className}>
      {progress !== null ? `Making MP3… ${Math.round(progress * 100)}%` : failed ? "MP3 failed, try again" : "Download MP3"}
    </button>
  );
}
