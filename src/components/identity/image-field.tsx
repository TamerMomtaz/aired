"use client";

import { useEffect, useMemo, useRef } from "react";

import { uploadArtworkImage } from "@/lib/artwork/upload-client";

// A device-image picker with a live preview, shared by the first-run wizard and
// the identity editor (avatar, mascot image, album cover). Uploads happen at
// submit time via resolveImagePick, mirroring the work editor: small images go
// straight to the public `artwork` bucket from the browser.

export type ImagePick = {
  file: File | null;
  existing: string | null;
  cleared: boolean;
};

export function emptyPick(existing: string | null = null): ImagePick {
  return { file: null, existing, cleared: false };
}

// Resolve a pick to the Editable an identity action expects: a string (a freshly
// uploaded URL), null (cleared), or undefined (left as-is).
export async function resolveImagePick(
  pick: ImagePick,
): Promise<string | null | undefined> {
  if (pick.file) {
    const { publicUrl } = await uploadArtworkImage(pick.file);
    return publicUrl;
  }
  if (pick.cleared) return null;
  return undefined;
}

const fileClass =
  "w-full rounded-lg border border-dashed border-white/15 bg-white/[0.03] px-3.5 py-3 text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-white/15 disabled:opacity-50";

export function ImageField({
  label,
  pick,
  onPick,
  disabled,
  shape,
}: {
  label: string;
  pick: ImagePick;
  onPick: (next: ImagePick) => void;
  disabled: boolean;
  shape: "round" | "square";
}) {
  const previewUrl = useMemo(
    () => (pick.file ? URL.createObjectURL(pick.file) : null),
    [pick.file],
  );
  // Revoke the object URL on change/unmount (cleanup only — no setState here).
  const lastUrl = useRef<string | null>(null);
  useEffect(() => {
    lastUrl.current = previewUrl;
    return () => {
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
    };
  }, [previewUrl]);

  const shown = pick.file ? previewUrl : pick.cleared ? null : pick.existing;
  const radius = shape === "round" ? "rounded-full" : "rounded-lg";

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="flex items-center gap-3">
        {shown ? (
          // A blob: preview and a stored https URL both render with a plain <img>.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shown}
            alt=""
            width={64}
            height={64}
            className={`size-16 shrink-0 border border-white/10 object-cover ${radius}`}
          />
        ) : (
          <div
            className={`flex size-16 shrink-0 items-center justify-center border border-dashed border-white/12 text-[9px] uppercase tracking-[0.16em] text-muted/50 ${radius}`}
          >
            none
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <input
            className={fileClass}
            type="file"
            accept="image/*"
            disabled={disabled}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              onPick({ ...pick, file: f, cleared: f ? false : pick.cleared });
            }}
          />
          {(pick.existing || pick.file) && !pick.cleared ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick({ ...pick, file: null, cleared: true })}
              className="self-start text-[11px] text-muted underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
            >
              Remove
            </button>
          ) : pick.cleared ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick({ ...pick, cleared: false })}
              className="self-start text-[11px] text-muted underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
            >
              Keep current
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
