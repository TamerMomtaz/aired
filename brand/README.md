# AIRED brand kit — metallic edition

Warm-metallic-posh: chrome / brushed-steel badging on matte black. Luxury, not
severe. Built from the core palette only — no new hues, just light-to-shadow
shading of the existing brand colors.

## Marks (in `out/`)

| File | Size | Use | Circle-crop safe |
| --- | --- | --- | --- |
| `aired-profile-1080.{svg,png}` | 1080 × 1080 | profile / avatar | ✅ |
| `aired-cover-1640x856.{svg,png}` | 1640 × 856 | banner / cover | — |
| `aired-icon-512.{svg,png}` | 512 × 512 | app / favicon tile | ✅ |

Each mark ships as a **standalone SVG** (all type outlined to vector paths — no
font dependency) and a **pixel-exact PNG**.

## Palette (the only colours)

| Token | Hex | Role |
| --- | --- | --- |
| Matte black | `#0a0a0a` | background |
| Signal red | `#e10600` | the Red Line (mid stop of the lacquer) |
| Wordmark base | `#ededed` | wordmark (mid stop of the metal) |

Metallic shading endpoints (tints/shades of the above — not new colours):
metal `#f5f5f5`→`#6a6a6a`, bevel `#fbfbfb`/`#050505`, red lacquer
`#ff3a30`→`#b00500`, bronze inlay `#d9b87a`→`#7a5c2e`, silver serif
`#f2f2f2`→`#9a9a9a`.

## Treatment

- **Wordmark "AIRED"** — brushed/polished metal: vertical light→shadow gradient,
  raised emboss (1px specular top edge + dark bottom bevel), faint brushed
  striations inside the strokes.
- **Red Line** — polished red lacquer / filament under glass: vertical sheen plus
  a luminous end-falloff that fades the tips into glow.
- **Sacred geometry (rings + hexagram) & bronze filigree** — thin gold/bronze
  metal inlay with a faint highlight edge, so they shimmer like fine inlay.
- **Cover tagline serif** — subtle silver gradient, thin and elegant.

## Regenerate

```bash
cd brand
npm install      # @resvg/resvg-js + opentype.js (dev only; not in the app build)
npm run build    # writes out/*.svg + out/*.png
npm run verify   # asserts exact dimensions + palette (source and rendered pixels)
```

`generate.mjs` is the single source of truth; tweak the palette/treatment there.
The kit is committed so it never has to be reconstructed from memory again.

## Fonts (`fonts/`, bundled for reproducibility)

- **Montserrat ExtraBold** — wordmark. SIL Open Font License 1.1.
- **EB Garamond Medium** — cover tagline. SIL Open Font License 1.1.

Both are outlined into the SVGs, so the exported marks carry no font dependency;
the files are kept only so the generator runs offline.
