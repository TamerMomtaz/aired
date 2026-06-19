# AIRED — brand / social assets

The AIRED mark: the **AIRED** wordmark (Geist, weight 800) with a **cert-red
square** as the period and the **Red Line** beneath it, on near-black — the same
lockup the app renders (`src/lib/branding/aired-mark.tsx`, the home hero). Colors
come straight from `src/app/globals.css`:

| token        | value     | use            |
| ------------ | --------- | -------------- |
| `--background` | `#0a0a0a` | near-black bg  |
| `--foreground` | `#ededed` | wordmark       |
| `--cert-red`   | `#ff2d2d` | period + Red Line |

## Files

| file | size | use |
| ---- | ---- | --- |
| `aired-fb-profile.png`       | 1080×1080 | Facebook **profile picture** — lockup kept inside the circular crop |
| `aired-fb-cover.png`         | 1640×624  | Facebook **cover photo** — lockup + “AI-ed and proud.” tagline |
| `aired-fb-cover-minimal.png` | 1640×624  | Facebook **cover photo** — lockup only (logo, no tagline) |

Cover assets are 2× the 820×312 display size and keep the lockup centered so it
survives Facebook's desktop **and** mobile crops.

## Regenerate

```bash
python3 -m pip install Pillow
python3 brand/generate_social.py
```

The script fetches the official [Geist](https://github.com/vercel/geist-font)
variable font (OFL-1.1) into `brand/fonts/` on first run (git-ignored), then
renders every asset 2× and downscales with LANCZOS for crisp edges. Tweak the
ratios in `lockup_metrics()` to adjust tracking, the period square, or the line.
