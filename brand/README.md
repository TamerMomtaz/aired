# AIRED — Brand Asset Kit (Metallic)

Warm, posh, hypnotic: brushed-steel badging and red lacquer on matte black.
Built from one idea — a single signal-red line, *the red line*, running through
a clean geometric wordmark. Sacred geometry behind, circuitry in the margins.

> **AI-ed and proud · credited, not thanked.**

## Files

| Asset | Size | File | Use |
|---|---|---|---|
| Profile mark | 1080 × 1080 | `png/aired-profile-1080.png` | Square avatar / profile picture (survives a circle crop) |
| Cover banner | 1640 × 856 | `png/aired-cover-1640x856.png` | Facebook / social page cover |
| App icon | 512 × 512 | `png/aired-icon-512.png` | Favicon / app icon / small avatar |

- **`aired-brand-kit.html`** — single self-contained file; all three marks are
  inline SVG (no external fonts, scripts, or images). The source of truth.
- **`svg/`** — standalone, infinitely scalable vector source for each mark.
- **`png/`** — exact-size raster exports (verified to the pixel).

## The metallic finish — tonal only, no new colors

Every metallic effect is built from **shades of the core palette** — no foreign
hues are introduced.

- **Wordmark "AIRED" — brushed/polished steel.** A vertical gradient runs from a
  bright highlight (`#f5f5f5`) at the top, through the base `#ededed`, down to
  `#6a6a6a` in the lower third. Each glyph is drawn three times — a dark bevel
  offset down, a bright specular offset up, and the steel face on top — so the
  letters read as raised/embossed metal.
- **The red line — polished lacquer / filament under glass.** A vertical sheen
  (`#ff3a30` highlight on top → core `#e10600` → `#b00500` shadow on the bottom)
  with a thin specular highlight, plus the existing luminous horizontal
  end-falloff (applied as a mask so colour and glow are independent).
- **Sacred geometry & filigree — bronze inlay.** Rings, hexagram and corner
  filigree carry a diagonal gold/bronze gradient (`#d9b87a` → `#7a5c2e`) so they
  shimmer like fine inlay rather than flat lines.
- **Cover tagline — silver.** A light-to-mid-grey gradient (`#f2f2f2` → `#8a8a8a`),
  thin and elegant.

## Palette (core — exact, and verified present in every PNG)

| Token | Hex | Role |
|---|---|---|
| Matte black | `#0A0A0A` | Background |
| Wordmark base | `#EDEDED` | Steel mid-tone |
| **Signal red** | `#E10600` | The red line — lacquer core |
| Muted | `#8A8A8A` | Supporting text |

Metallic shades used (all tonal variants of the above): `#F5F5F5 #6A6A6A`
(steel), `#FF3A30 #B00500` (lacquer), `#D9B87A #7A5C2E` (bronze inlay).

The wordmark is **drawn as custom monoline geometry** (no font dependency).

## Regenerate

```bash
cd brand
node render.cjs   # extracts each inline SVG → exact-size PNG + standalone .svg
node verify.cjs   # decodes the PNGs; asserts exact dimensions + that #0A0A0A,
                  # #E10600 and #EDEDED are all present at the expected points
```

Rendering uses headless Chromium via Playwright at deviceScaleFactor 1, so each
PNG is produced at its exact pixel dimensions with no scaling.

## Note on red

This kit uses **`#E10600`** (signal red) exactly as briefed. The app currently
tokenizes its accent as `--cert-red: #ff2d2d` (`src/app/globals.css`). If you
want the website and the brand marks to match perfectly, pick one value and
align both. I kept `#E10600` here per the brief.
