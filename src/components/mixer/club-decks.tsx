"use client";

import type { MixSource } from "@/components/mixer/mixer-studio";

// The club booth at the top of the Mixer: two turntables carrying the first two
// songs of the set on spinning vinyl, a crossfader between them, and a light
// show that kicks in while the Mixer works. Pure decoration: it reads the set,
// it never changes it.
export function ClubDecks({ set, busy }: { set: MixSource[]; busy: boolean }) {
  const a = set[0];
  const b = set[1] ?? (set.length === 1 ? set[0] : undefined);
  return (
    <div className={`club-booth${busy ? " is-live" : ""}`} aria-hidden>
      <Deck side="A" song={a} />
      <div className="club-fader">
        <div className="club-eq">
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} style={{ animationDelay: `${-i * 0.17}s` }} />
          ))}
        </div>
        <div className="club-fader-track">
          <span className="club-fader-knob" />
        </div>
        <span className="club-fader-label">{busy ? "MIXING" : set.length ? `${set.length} IN THE SET` : "LOAD A TRACK"}</span>
      </div>
      <Deck side="B" song={b} />
    </div>
  );
}

function Deck({ side, song }: { side: "A" | "B"; song?: MixSource }) {
  return (
    <div className={`club-deck club-deck-${side.toLowerCase()}${song ? " is-loaded" : ""}`}>
      <div className="club-platter">
        <div className="club-vinyl">
          {song?.artworkUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={song.artworkUrl} alt="" className="club-label" />
          ) : (
            <span className="club-label club-label-empty">{side}</span>
          )}
        </div>
        <span className="club-arm" />
      </div>
      <span className="club-deck-title">{song ? song.title : `Deck ${side}`}</span>
    </div>
  );
}
