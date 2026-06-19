# AIRED — Brand Asset Kit

Dark, mystical-technical marks built from one idea: a single signal-red line —
*the red line* — running through a clean geometric wordmark. Sacred geometry
behind, circuitry in the margins, matte black everywhere else.

> **AI-ed and proud · credited, not thanked.**

## Files

| Asset | Size | File | Use |
|---|---|---|---|
| Profile mark | 1080 × 1080 | `png/aired-profile-1080.png` | Square avatar / profile picture (safe to circle-crop) |
| Cover banner | 1640 × 856 | `png/aired-cover-1640x856.png` | Facebook / social page cover |
| App icon | 512 × 512 | `png/aired-icon-512.png` | Favicon / app icon / small avatar |

- **`aired-brand-kit.html`** — single self-contained file; all three marks are
  inline SVG (no external fonts, scripts, or images). Open it to preview and
  download. This is the source of truth.
- **`svg/`** — standalone, infinitely scalable vector source for each mark.
- **`png/`** — exact-size raster exports (verified to the pixel).

## Palette (exact)

| Token | Hex | Role |
|---|---|---|
| Matte black | `#0A0A0A` | Background |
| Wordmark | `#EDEDED` | "AIRED" letterforms |
| **Signal red** | `#E10600` | The red line — the one accent |
| Bronze | `#B08D57` | Faint circuit filigree (cover only) |
| Muted | `#8A8A8A` | Supporting text |

The wordmark is **drawn as geometry** (custom monoline paths), not set in a
font, so it renders identically on every device with zero font dependencies.

## Regenerate

```bash
cd brand
node render.cjs   # extracts each inline SVG → exact-size PNG + standalone .svg
node verify.cjs   # decodes the PNGs, asserts exact dimensions + exact colors
```

Rendering uses headless Chromium via Playwright at deviceScaleFactor 1, so each
PNG is produced at its exact pixel dimensions with no scaling.

## Note on red

This kit uses **`#E10600`** (signal red) exactly as briefed. The app currently
tokenizes its accent as `--cert-red: #ff2d2d` (`src/app/globals.css`). They are
close but not identical — if you want the website and the brand marks to match,
pick one value and align both. I kept `#E10600` here per the brief.
