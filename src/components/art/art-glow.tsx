// Let the art glow (Tee's mood lift, Nov 2026): a soft, blurred copy of a cover
// sits behind it, so every card casts light in its own colours, like a row of
// lit records. Pure decoration: hidden from screen readers, never tappable.
// The parent must be `relative isolate` so the glow stays behind its cover.
export function ArtGlow({ src }: { src: string | null | undefined }) {
  if (!src) return null;
  return (
    <span
      aria-hidden
      className="art-glow"
      style={{ backgroundImage: `url(${JSON.stringify(src)})` }}
    />
  );
}
