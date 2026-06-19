#!/usr/bin/env python3
"""Generate AIRED social assets (Facebook profile picture + cover photo).

The mark is the AIRED wordmark (Geist, weight 800) with a cert-red square as the
period and the Red Line beneath it, on near-black — the same lockup the site
renders (see src/lib/branding/aired-mark.tsx and the home hero). Brand values are
pulled straight from src/app/globals.css.

Rendered 2x and downscaled with LANCZOS for crisp anti-aliased edges.
"""

import os
import urllib.request
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_PATH = os.path.join(HERE, "fonts", "Geist.ttf")
# Official Geist variable font (OFL-1.1), the same typeface the app loads via
# next/font. Downloaded on demand so it need not be committed.
FONT_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/geist/Geist%5Bwght%5D.ttf"
OUT = HERE


def ensure_font():
    if os.path.exists(FONT_PATH):
        return
    os.makedirs(os.path.dirname(FONT_PATH), exist_ok=True)
    print("fetching Geist font ->", FONT_PATH)
    urllib.request.urlretrieve(FONT_URL, FONT_PATH)

# AIRED palette — cert-red on near-black (globals.css).
BG = (10, 10, 10)        # #0a0a0a  --background
FG = (237, 237, 237)     # #ededed  --foreground
RED = (255, 45, 45)      # #ff2d2d  --cert-red
SUB = (176, 176, 176)    # tagline grey, a touch brighter than --muted for cover legibility

SS = 2  # supersample factor


def geist(px, weight=800):
    f = ImageFont.truetype(FONT_PATH, px)
    try:
        f.set_variation_by_axes([weight])
    except Exception:
        pass
    return f


def lockup_metrics(cap, tracking_ratio=0.12, dot_ratio=0.26,
                   line_w_ratio=0.60, line_h_ratio=0.05, gap_below_ratio=0.42):
    """Geometry for a lockup whose capital letters are `cap` px tall."""
    # Pick a font size whose 'AIRED' cap height == cap.
    probe = geist(1000, 800)
    pb = probe.getbbox("AIRED")
    probe_cap = pb[3] - pb[1]
    font_px = max(1, round(1000 * cap / probe_cap))
    font = geist(font_px, 800)

    text = "AIRED"
    tracking = cap * tracking_ratio
    advances = [font.getlength(ch) for ch in text]
    word_w = sum(advances) + tracking * (len(text) - 1)

    sq = cap * dot_ratio
    gap_dot = tracking * 1.15
    total_w = word_w + gap_dot + sq

    line_w = total_w * line_w_ratio
    line_h = max(2.0, cap * line_h_ratio)
    gap_below = cap * gap_below_ratio
    height = cap + gap_below + line_h

    lsb_a = font.getbbox("A")[0]  # left side bearing of A, for optical centering

    return dict(font=font, text=text, advances=advances, tracking=tracking,
                word_w=word_w, sq=sq, gap_dot=gap_dot, total_w=total_w,
                line_w=line_w, line_h=line_h, gap_below=gap_below,
                height=height, cap=cap, lsb_a=lsb_a)


def draw_lockup(canvas, cx, lockup_cy, cap, with_line=True, **ratios):
    """Draw the lockup so its bounding box is centered at (cx, lockup_cy)."""
    m = lockup_metrics(cap, **ratios)
    draw = ImageDraw.Draw(canvas)

    # Wordmark cap-block center sits above the lockup center by half the stuff below.
    cy = lockup_cy - (m["gap_below"] + m["line_h"]) / 2
    baseline_y = cy + cap / 2

    # Optical centering: inked content runs from (start_x + lsb_a) to the square's
    # right edge; center that span on cx.
    start_x = cx - m["total_w"] / 2 - m["lsb_a"] / 2

    x = start_x
    for i, ch in enumerate(m["text"]):
        draw.text((x, baseline_y), ch, font=m["font"], fill=FG, anchor="ls")
        x += m["advances"][i] + m["tracking"]

    # Red square "period", bottom-aligned to the baseline.
    sx0 = start_x + m["word_w"] + m["gap_dot"]
    draw.rectangle([sx0, baseline_y - m["sq"], sx0 + m["sq"], baseline_y], fill=RED)

    if with_line:
        ly0 = baseline_y + m["gap_below"]
        lh = m["line_h"]
        rad = lh / 2
        box = [cx - m["line_w"] / 2, ly0, cx + m["line_w"] / 2, ly0 + lh]
        # Soft red glow behind the line.
        glow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        ImageDraw.Draw(glow).rounded_rectangle(box, radius=rad, fill=RED + (255,))
        glow = glow.filter(ImageFilter.GaussianBlur(lh * 1.7))
        canvas.alpha_composite(glow)
        canvas.alpha_composite(glow)
        # Crisp line on top.
        draw.rounded_rectangle(box, radius=rad, fill=RED + (255,))
    return m


def fit_cap(target_w, max_diag=None):
    """Cap height giving the lockup a `target_w` total width, clamped to max_diag."""
    base = lockup_metrics(100.0)
    cap = 100.0 * target_w / base["total_w"]
    if max_diag is not None:
        m = lockup_metrics(cap)
        diag = (m["total_w"] ** 2 + m["height"] ** 2) ** 0.5
        if diag > max_diag:
            cap *= max_diag / diag
    return cap


def new_canvas(w, h):
    return Image.new("RGBA", (w, h), BG + (255,))


def finish(canvas, w, h, path):
    img = canvas.resize((w, h), Image.LANCZOS).convert("RGB")
    img.save(path, "PNG")
    print("wrote", path, f"{w}x{h}")


def make_profile(size=1080):
    w = h = size * SS
    c = new_canvas(w, h)
    # Keep the whole lockup inside Facebook's circular crop: bound the diagonal.
    cap = fit_cap(target_w=0.72 * w, max_diag=0.86 * w)
    draw_lockup(c, w / 2, h / 2, cap)
    finish(c, size, size, os.path.join(OUT, "aired-fb-profile.png"))


def make_cover(filename, with_tagline=True, W=1640, H=624):
    w, h = W * SS, H * SS
    c = new_canvas(w, h)
    if with_tagline:
        cap = fit_cap(target_w=0.40 * w)
        m0 = lockup_metrics(cap)
        tag_px = round(cap * 0.30)
        tag_font = geist(tag_px, 600)
        tag = "AI-ed and proud."
        gap_tag = cap * 0.62
        tb = tag_font.getbbox(tag)
        tag_h = tb[3] - tb[1]
        group_h = m0["height"] + gap_tag + tag_h
        top = (h - group_h) / 2
        lockup_cy = top + m0["height"] / 2
        draw_lockup(c, w / 2, lockup_cy, cap)
        ty = top + m0["height"] + gap_tag
        # Track the tagline out a little for a confident, wordmark-echoing feel.
        draw_tracked(c, w / 2, ty, tag, tag_font, SUB, track=tag_px * 0.04, anchor_top=True)
    else:
        cap = fit_cap(target_w=0.46 * w, max_diag=0.92 * h)
        draw_lockup(c, w / 2, h / 2, cap)
    finish(c, W, H, os.path.join(OUT, filename))


def draw_tracked(canvas, cx, y, text, font, fill, track=0.0, anchor_top=False):
    """Draw `text` centered on cx with extra letter tracking."""
    draw = ImageDraw.Draw(canvas)
    advances = [font.getlength(ch) for ch in text]
    total = sum(advances) + track * (len(text) - 1)
    x = cx - total / 2
    anchor = "la" if anchor_top else "ls"
    for i, ch in enumerate(text):
        draw.text((x, y), ch, font=font, fill=fill, anchor=anchor)
        x += advances[i] + track


if __name__ == "__main__":
    ensure_font()
    make_profile()
    make_cover("aired-fb-cover.png", with_tagline=True)
    make_cover("aired-fb-cover-minimal.png", with_tagline=False)
