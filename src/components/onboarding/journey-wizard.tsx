"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  emptyPick,
  ImageField,
  type ImagePick,
  resolveImagePick,
} from "@/components/identity/image-field";
import { HandleHint, useHandleCheck } from "@/components/identity/handle-field";
import { createAlbum, setAlbumCoverUpload } from "@/lib/albums/actions";
import { uploadArtworkImage } from "@/lib/artwork/upload-client";
import {
  completeOnboarding,
  saveArtistIdentity,
  saveMascot,
} from "@/lib/identity/actions";
import { handleError, slugifyHandle } from "@/lib/identity/handle";

// THE JOURNEY — the guided first-run, a real four-step walk (not a settings
// page). Every write is the user editing their OWN profile / creating their OWN
// album, through the owner-RLS server actions. Step 1 (name + handle) is
// required; mascot and album can be skipped; step 4 stamps onboarded_at so the
// walk never runs again. Mirrors the editor/island styling already in the app.

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-base text-foreground outline-none transition placeholder:text-muted/60 focus:border-cert-red/60 focus:bg-white/[0.07] focus:ring-1 focus:ring-cert-red/40 disabled:opacity-60";
const labelText = "text-xs font-medium text-muted";
const primaryBtn =
  "rounded-lg bg-cert-red px-5 py-2.5 text-sm font-medium text-white shadow-[0_0_18px_-6px_var(--cert-red)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
const ghostBtn =
  "rounded-lg border border-white/12 px-4 py-2.5 text-sm text-muted transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60";

type Initial = {
  displayName: string;
  handle: string;
  suggestedHandle: string;
  bio: string;
  avatarUrl: string | null;
  mascotName: string;
  mascotAvatarUrl: string | null;
};

type Step = 1 | 2 | 3 | 4;
const TOTAL = 4;

export function JourneyWizard({
  initial,
  hasWorks,
}: {
  initial: Initial;
  hasWorks: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [handle, setHandle] = useState(
    initial.handle || initial.suggestedHandle,
  );
  const [handleTouched, setHandleTouched] = useState(!!initial.handle);
  const [bio, setBio] = useState(initial.bio);
  const [avatar, setAvatar] = useState<ImagePick>(emptyPick(initial.avatarUrl));

  // Step 2
  const [mascotName, setMascotName] = useState(initial.mascotName);
  const [mascotAvatar, setMascotAvatar] = useState<ImagePick>(
    emptyPick(initial.mascotAvatarUrl),
  );

  // Step 3
  const [albumTitle, setAlbumTitle] = useState("");
  const [albumDesc, setAlbumDesc] = useState("");
  const [albumCover, setAlbumCover] = useState<ImagePick>(emptyPick());

  // Keep the handle slug-shaped, and auto-fill it from the name until the user
  // edits the handle themselves.
  function onNameChange(value: string) {
    setDisplayName(value);
    if (!handleTouched) setHandle(slugifyHandle(value));
  }
  function onHandleChange(value: string) {
    setHandleTouched(true);
    setHandle(slugifyHandle(value));
  }

  const handleFmtError = useMemo(
    () => (handle ? handleError(handle) : null),
    [handle],
  );
  const { avail } = useHandleCheck(handle, handleFmtError);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Something went wrong — try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  function submitStep1() {
    if (!displayName.trim()) {
      setError("Give your artist a name.");
      return;
    }
    if (handleFmtError) {
      setError(handleFmtError);
      return;
    }
    run(async () => {
      const avatarUrl = await resolveImagePick(avatar);
      const res = await saveArtistIdentity({ displayName, handle, bio, avatarUrl });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setStep(2);
    });
  }

  function submitStep2(skip: boolean) {
    if (skip) {
      setError(null);
      setStep(3);
      return;
    }
    run(async () => {
      const mascotAvatarUrl = await resolveImagePick(mascotAvatar);
      const res = await saveMascot({ mascotName, mascotAvatarUrl });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setStep(3);
    });
  }

  // Finish step 3 (create the album, or skip), then stamp onboarded_at and land
  // on "You're home". Completing here means closing the tab on the last screen
  // still counts as done — the walk never re-runs.
  function finishSetup(opts: { createAlbumStep: boolean }) {
    run(async () => {
      if (opts.createAlbumStep) {
        if (!albumTitle.trim()) {
          setError("Name your first album, or skip this step.");
          return;
        }
        const created = await createAlbum({
          title: albumTitle,
          description: albumDesc,
        });
        if (!created.ok) {
          setError(created.error);
          return;
        }
        // Optional device cover — best effort; never block the walk on it.
        if (albumCover.file) {
          try {
            const { publicUrl } = await uploadArtworkImage(albumCover.file);
            await setAlbumCoverUpload(created.albumId, publicUrl);
          } catch {
            // Cover is optional; the album is created regardless.
          }
        }
      }
      const done = await completeOnboarding();
      if (!done.ok) {
        setError(done.error);
        return;
      }
      setStep(4);
    });
  }

  const handOff = hasWorks
    ? { href: "/manage", label: "File your songs in Manage" }
    : { href: "/upload", label: "Upload your first work" };

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-5 py-10">
      <Progress step={step} />

      {step === 1 ? (
        <Section
          eyebrow="Step 1 of 4"
          title="Name your artist"
          blurb="This is the name listeners search and follow — the home every work you make is credited to. You can change it later."
        >
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Artist name</span>
            <input
              className={inputClass}
              value={displayName}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="e.g. Kahotia"
              maxLength={80}
              disabled={busy}
              autoFocus
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Handle</span>
            <div className="flex items-center gap-2">
              <span className="select-none text-sm text-muted/70">
                ai-red.io/artist/
              </span>
              <input
                className={inputClass}
                value={handle}
                onChange={(e) => onHandleChange(e.target.value)}
                placeholder="your-handle"
                maxLength={32}
                disabled={busy}
                inputMode="text"
                autoCapitalize="none"
                spellCheck={false}
              />
            </div>
            <HandleHint handle={handle} fmtError={handleFmtError} avail={avail} />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Bio (optional)</span>
            <textarea
              className={`${inputClass} min-h-20 resize-y`}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="A line or two about you and your sound."
              maxLength={600}
              disabled={busy}
            />
          </label>

          <ImageField
            label="Avatar (optional)"
            pick={avatar}
            onPick={setAvatar}
            disabled={busy}
            shape="round"
          />

          <Nav>
            <span />
            <button
              type="button"
              className={primaryBtn}
              onClick={submitStep1}
              disabled={busy || !displayName.trim() || !!handleFmtError}
            >
              {busy ? "Saving…" : "Continue →"}
            </button>
          </Nav>
        </Section>
      ) : null}

      {step === 2 ? (
        <Section
          eyebrow="Step 2 of 4"
          title="Your mascot"
          blurb="The emblem of your voices — the name your AI collaborators sing under (the founder's is “Kahotia”). Optional, but it gives your sound a face."
        >
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Mascot name (optional)</span>
            <input
              className={inputClass}
              value={mascotName}
              onChange={(e) => setMascotName(e.target.value)}
              placeholder="Name your emblem"
              maxLength={80}
              disabled={busy}
              autoFocus
            />
          </label>

          <ImageField
            label="Mascot image (optional)"
            pick={mascotAvatar}
            onPick={setMascotAvatar}
            disabled={busy}
            shape="round"
          />

          <Nav>
            <button
              type="button"
              className={ghostBtn}
              onClick={() => {
                setError(null);
                setStep(1);
              }}
              disabled={busy}
            >
              ← Back
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={ghostBtn}
                onClick={() => submitStep2(true)}
                disabled={busy}
              >
                Skip
              </button>
              <button
                type="button"
                className={primaryBtn}
                onClick={() => submitStep2(false)}
                disabled={busy}
              >
                {busy ? "Saving…" : "Continue →"}
              </button>
            </div>
          </Nav>
        </Section>
      ) : null}

      {step === 3 ? (
        <Section
          eyebrow="Step 3 of 4"
          title="Create your first album"
          blurb="Your home slot — the cover your songs land under. Give it a name now; you can add songs, a cover, and more albums anytime."
        >
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Album title</span>
            <input
              className={inputClass}
              value={albumTitle}
              onChange={(e) => setAlbumTitle(e.target.value)}
              placeholder="e.g. Ionganica AI-red"
              maxLength={200}
              disabled={busy}
              autoFocus
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Description (optional)</span>
            <textarea
              className={`${inputClass} min-h-16 resize-y`}
              value={albumDesc}
              onChange={(e) => setAlbumDesc(e.target.value)}
              placeholder="What ties this album together?"
              maxLength={2000}
              disabled={busy}
            />
          </label>

          <ImageField
            label="Cover (optional)"
            pick={albumCover}
            onPick={setAlbumCover}
            disabled={busy}
            shape="square"
          />

          <Nav>
            <button
              type="button"
              className={ghostBtn}
              onClick={() => {
                setError(null);
                setStep(2);
              }}
              disabled={busy}
            >
              ← Back
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={ghostBtn}
                onClick={() => finishSetup({ createAlbumStep: false })}
                disabled={busy}
              >
                Skip for now
              </button>
              <button
                type="button"
                className={primaryBtn}
                onClick={() => finishSetup({ createAlbumStep: true })}
                disabled={busy || !albumTitle.trim()}
              >
                {busy ? "Creating…" : "Create album →"}
              </button>
            </div>
          </Nav>
        </Section>
      ) : null}

      {step === 4 ? (
        <Section
          eyebrow="Step 4 of 4"
          title="You're home"
          blurb={
            hasWorks
              ? "Your artist page is live. Now file the works you've already made into your home — and tidy up any loose ones — in Manage."
              : "Your artist page is live and your first album is waiting. Upload a work and it files straight into the album you just made."
          }
        >
          <div className="flex flex-col gap-3 rounded-xl border border-cert-red/30 bg-cert-red/[0.05] px-5 py-6 text-center">
            <span
              aria-hidden
              className="mx-auto h-[3px] w-16 rounded-full bg-cert-red"
              style={{
                boxShadow:
                  "0 0 12px color-mix(in srgb, var(--cert-red) 70%, transparent)",
              }}
            />
            <p className="text-sm leading-relaxed text-foreground">
              Welcome to AIRED, {displayName.trim() || "artist"}. AI-ed and proud.
            </p>
          </div>

          <Nav>
            <button
              type="button"
              className={ghostBtn}
              onClick={() => router.push("/")}
              disabled={busy}
            >
              Explore first
            </button>
            <button
              type="button"
              className={primaryBtn}
              onClick={() => router.push(handOff.href)}
              disabled={busy}
            >
              {handOff.label} →
            </button>
          </Nav>
        </Section>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-cert-red">
          {error}
        </p>
      ) : null}
    </main>
  );
}

function Section({
  eyebrow,
  title,
  blurb,
  children,
}: {
  eyebrow: string;
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-[0.18em] text-cert-red/80">
          {eyebrow}
        </span>
        <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">
          {title}
        </h1>
        <p className="text-sm leading-relaxed text-muted">{blurb}</p>
      </header>
      {children}
    </section>
  );
}

function Nav({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 flex items-center justify-between gap-3">{children}</div>
  );
}

function Progress({ step }: { step: Step }) {
  return (
    <div
      role="group"
      aria-label={`Step ${step} of ${TOTAL}`}
      className="flex items-center gap-2"
    >
      {Array.from({ length: TOTAL }, (_, i) => i + 1).map((i) => (
        <span
          key={i}
          aria-hidden
          className={[
            "h-1.5 flex-1 rounded-full transition-all duration-300",
            i === step
              ? "bg-cert-red"
              : i < step
                ? "bg-foreground/40"
                : "bg-white/12",
          ].join(" ")}
          style={
            i === step
              ? {
                  boxShadow:
                    "0 0 8px color-mix(in srgb, var(--cert-red) 70%, transparent)",
                }
              : undefined
          }
        />
      ))}
    </div>
  );
}
