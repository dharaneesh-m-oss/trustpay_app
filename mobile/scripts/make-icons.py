"""
Generates the app icon set.

The mark is a shield with a T cut out of it in negative space - protection and
the product name in one glyph, which is the only thing that survives being
rendered at 48px on a home screen.

It is drawn geometrically rather than typeset, so it stays crisp at every size
and does not depend on a font being installed. Everything is rendered at 4x and
downsampled, which is what gives the curves clean edges.

Run: python scripts/make-icons.py
"""

from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw

ASSETS = pathlib.Path(__file__).resolve().parent.parent / "assets"

# Graphite, matching the near-black the interface uses for primary actions.
INK_TOP = (34, 36, 41)
INK_BOTTOM = (11, 12, 14)
LIGHT = (255, 255, 255)

SUPERSAMPLE = 4


def shield_points(cx: float, cy: float, w: float, h: float, steps: int = 240):
    """
    Half-width as a function of depth, mirrored into a closed polygon.

    The sides stay near-vertical for the top 55% and then taper on a curve to a
    soft point. A straight-sided triangle reads as an arrow; the curve is what
    makes it read as a shield.
    """
    top = cy - h / 2
    corner = w * 0.20

    import math

    points: list[tuple[float, float]] = []
    # Top edge with rounded corners.
    for index in range(41):
        t = index / 40
        angle = math.pi + t * (math.pi / 2)  # 180deg -> 270deg
        points.append(
            (cx - w / 2 + corner + corner * math.cos(angle),
             top + corner + corner * math.sin(angle))
        )
    for index in range(41):
        t = index / 40
        angle = -math.pi / 2 + t * (math.pi / 2)  # 270deg -> 360deg
        points.append(
            (cx + w / 2 - corner + corner * math.cos(angle),
             top + corner + corner * math.sin(angle))
        )

    # Right side down, then the taper to the point.
    shoulder = top + h * 0.50
    points.append((cx + w / 2, shoulder))
    for index in range(1, steps + 1):
        t = index / steps
        half = (w / 2) * (1.0 - t ** 2.4) ** 0.55
        points.append((cx + half, shoulder + t * (h * 0.48)))

    # Left side, mirrored back up.
    for index in range(steps, 0, -1):
        t = index / steps
        half = (w / 2) * (1.0 - t ** 2.4) ** 0.55
        points.append((cx - half, shoulder + t * (h * 0.48)))
    points.append((cx - w / 2, shoulder))

    return points


def rounded_bar(draw: ImageDraw.ImageDraw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def draw_mark(size: int, mark_colour, scale: float = 0.62) -> Image.Image:
    """The shield with the T knocked out of it, on a transparent ground."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    cx = size / 2
    cy = size / 2
    width = size * scale * 0.80
    height = size * scale

    draw.polygon(shield_points(cx, cy, width, height), fill=mark_colour)

    # The T, cut in the background colour so it reads as negative space.
    stem_w = width * 0.175
    bar_w = width * 0.58
    bar_h = height * 0.115
    top = cy - height * 0.20
    radius = stem_w * 0.32

    rounded_bar(
        draw,
        (cx - bar_w / 2, top, cx + bar_w / 2, top + bar_h),
        radius,
        (0, 0, 0, 0),
    )
    rounded_bar(
        draw,
        (cx - stem_w / 2, top, cx + stem_w / 2, top + height * 0.46),
        radius,
        (0, 0, 0, 0),
    )

    return canvas


def graphite_ground(size: int) -> Image.Image:
    """A vertical graphite gradient - flat black looks cheap, this has depth."""
    ground = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        ground.putpixel(
            (0, y),
            tuple(
                int(INK_TOP[channel] + (INK_BOTTOM[channel] - INK_TOP[channel]) * t)
                for channel in range(3)
            ),
        )
    return ground.resize((size, size), Image.NEAREST)


def render(name: str, image: Image.Image, final: int) -> None:
    out = image.resize((final, final), Image.LANCZOS)
    out.save(ASSETS / name)
    print("  wrote", name, out.size, out.mode)


def main() -> None:
    big = 1024 * SUPERSAMPLE

    # --- full-bleed icon -----------------------------------------------------
    ground = graphite_ground(big).convert("RGBA")
    icon = Image.alpha_composite(ground, draw_mark(big, LIGHT, scale=0.60))
    render("icon.png", icon, 1024)
    render("favicon.png", icon, 96)

    # --- adaptive icon -------------------------------------------------------
    # The foreground must survive being masked to a circle, so the mark is
    # smaller here than in the full-bleed version.
    render("android-icon-background.png", graphite_ground(big).convert("RGBA"), 1024)
    render("android-icon-foreground.png", draw_mark(big, LIGHT, scale=0.40), 1024)

    mono = draw_mark(big, LIGHT, scale=0.40)
    render("android-icon-monochrome.png", mono, 1024)

    # --- splash --------------------------------------------------------------
    render("splash-icon.png", draw_mark(big, LIGHT, scale=0.52), 1024)


if __name__ == "__main__":
    main()
