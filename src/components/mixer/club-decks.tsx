"use client";

import type { MixSource } from "@/components/mixer/mixer-studio";

// The MIXaTEE booth: two decks drawn as atoms, because every AIRED work is a
// carbon mind and a silicon mind together. Deck A is Carbon (6: shells 2·4),
// deck B is Silicon (14: shells 2·8·4). Each nucleus is the cover of a song in
// the set; the electrons spin, and race while the Mixer works. Between them a
// fader and EQ, and under them a set-power meter. Pure decoration: it reads the
// set, it never changes it.
const MAX = 6;

export function ClubDecks({ set, busy }: { set: MixSource[]; busy: boolean }) {
  const a = set[0];
  const b = set[1] ?? (set.length === 1 ? set[0] : undefined);
  const combo = set.length - new Set(set.map((s) => s.id)).size;
  return (
    <div className={`club-booth${busy ? " is-live" : ""}`} aria-hidden>
      <div className="club-booth-row">
        <Atom element="carbon" symbol="C" number={6} shells={[2, 4]} song={a} />
        <div className="club-fader">
          <div className="club-eq">
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} style={{ animationDelay: `${-i * 0.17}s` }} />
            ))}
          </div>
          <div className="club-fader-track">
            <span className="club-fader-knob" />
          </div>
          <span className="club-fader-label">{busy ? "FUSING" : "C + Si"}</span>
        </div>
        <Atom element="silicon" symbol="Si" number={14} shells={[2, 8, 4]} song={b} />
      </div>
      <div className="club-power">
        <span className="club-power-label">SET POWER</span>
        <span className="club-power-cells">
          {Array.from({ length: MAX }, (_, i) => (
            <span key={i} className={i < set.length ? "is-on" : ""} />
          ))}
        </span>
        <span className="club-power-count">
          {set.length}/{MAX}
        </span>
        {combo > 0 ? <span className="club-combo">COMBO ×{combo + 1}</span> : null}
      </div>
    </div>
  );
}

function Atom({
  element,
  symbol,
  number,
  shells,
  song,
}: {
  element: "carbon" | "silicon";
  symbol: string;
  number: number;
  shells: number[];
  song?: MixSource;
}) {
  return (
    <div className={`club-atom club-atom-${element}${song ? " is-loaded" : ""}`}>
      <div className="club-atom-body">
        {/* Three tilted orbits for the classic atom look. */}
        <span className="club-orbit club-orbit-1" />
        <span className="club-orbit club-orbit-2" />
        <span className="club-orbit club-orbit-3" />
        {/* The real electron shells, each spinning at its own speed. */}
        {shells.map((count, s) => (
          <span
            key={s}
            className="club-shell"
            style={{ inset: `${20 - s * 10}%`, animationDuration: `${4 + s * 2.5}s` }}
          >
            {Array.from({ length: count }, (_, e) => (
              <i key={e} style={{ transform: `rotate(${(360 / count) * e}deg)` }} />
            ))}
          </span>
        ))}
        <div className="club-nucleus">
          {song?.artworkUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={song.artworkUrl} alt="" />
          ) : null}
          <span className="club-element">
            <b>{symbol}</b>
            <small>{number}</small>
          </span>
        </div>
      </div>
      <span className="club-deck-title">
        <em>{element === "carbon" ? "Carbon" : "Silicon"}</em>
        {song ? song.title : "load a track"}
      </span>
    </div>
  );
}
