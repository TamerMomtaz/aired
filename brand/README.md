# AIRED — brand kit

The **real** `AIRED.` lockup, rendered (not redrawn) straight from the live
landing/onboarding component so these files are indistinguishable from what the
site shows.

Source of truth: `src/components/onboarding/onboarding.tsx` → `ScreenOne` — the
white `AIRED` wordmark + red period above the glowing Red Line. Palette is
`src/app/globals.css`; typeface is **Geist** (`next/font/google`, weight 800),
the exact font the site self-hosts.

## Files

| File | Size | Use |
| --- | --- | --- |
| `aired-profile-1080.png` / `.svg` | 1080×1080 | Profile / avatar. Lockup centered inside the ~700px circle safe-zone. |
| `aired-cover-1640x856.png` / `.svg` | 1640×856 | Facebook / social cover. Lockup + tagline; bottom-left kept clear for the page avatar. |
| `aired-icon-512.png` / `.svg` | 512×512 | App / favicon icon. Word + red dot, no underline, sized to read down to ~48px. |

## Exact values (pulled from the repo, not guessed)

- Background `#0a0a0a` · wordmark `#ededed` · red dot + Red Line `#ff2d2d`
  (`--background`, `--foreground`, `--cert-red`).
- Wordmark: Geist, weight **800**, `letter-spacing: 0.16em`. The `.` is cert-red.
- Red Line: rounded bar, `box-shadow: 0 0 14px color-mix(in srgb, #ff2d2d 75%, transparent)`.
- Proportions taken from the desktop `text-6xl` reference (font 60 → underline
  96×3, gap 16, glow 14) and scaled uniformly, so the mark is identical to the
  landing page, just larger.
- Cover tagline: **AI-ed and proud · credited not thanked** (Geist 500, muted `#8a8a8a`).

## How they were made

PNGs are rendered in Chromium at **2× device scale** then downscaled
(Lanczos) for crisp edges; the wordmark uses the real Geist woff2. SVGs are
**outlined** (glyphs converted to vector paths in Geist 800/500) so they carry
no font dependency and render identically everywhere. Background `#0a0a0a`,
wordmark `#ededed`, and red `#ff2d2d` verified by pixel sampling.
