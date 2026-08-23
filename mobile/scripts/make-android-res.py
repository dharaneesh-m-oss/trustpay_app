"""
Regenerates the Android launcher resources from assets/.

`expo prebuild` normally does this, but rerunning prebuild would overwrite the
ABI-split configuration in the generated build.gradle. Writing the densities
directly is narrower and leaves the rest of the native project alone.

Two families, at different base sizes:
  - ic_launcher / ic_launcher_round  48dp  (the legacy square and round icons)
  - adaptive layers                 108dp  (background, foreground, monochrome)

Adaptive layers are 108dp because the launcher crops to the middle 72dp and may
animate within that margin, so anything important has to sit inside the middle
66%. The foreground asset is already drawn small enough to survive it.

Run: python scripts/make-android-res.py
"""

from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
OUT = ROOT / "android-res"

DENSITIES = {
    "mdpi": 1.0,
    "hdpi": 1.5,
    "xhdpi": 2.0,
    "xxhdpi": 3.0,
    "xxxhdpi": 4.0,
}

LEGACY_DP = 48
ADAPTIVE_DP = 108


def load(name: str) -> Image.Image:
    return Image.open(ASSETS / name).convert("RGBA")


def circular(image: Image.Image) -> Image.Image:
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, image.size[0] - 1, image.size[1] - 1), fill=255)
    out = Image.new("RGBA", image.size, (0, 0, 0, 0))
    out.paste(image, (0, 0), mask)
    return out


def write(image: Image.Image, density: str, name: str, dp: int) -> None:
    size = int(dp * DENSITIES[density])
    folder = OUT / ("mipmap-" + density)
    folder.mkdir(parents=True, exist_ok=True)
    resized = image.resize((size, size), Image.LANCZOS)
    resized.save(folder / (name + ".webp"), "WEBP", quality=95, method=6)


def main() -> None:
    icon = load("icon.png")
    foreground = load("android-icon-foreground.png")
    background = load("android-icon-background.png")
    monochrome = load("android-icon-monochrome.png")

    for density in DENSITIES:
        write(icon, density, "ic_launcher", LEGACY_DP)
        write(circular(icon), density, "ic_launcher_round", LEGACY_DP)
        write(background, density, "ic_launcher_background", ADAPTIVE_DP)
        write(foreground, density, "ic_launcher_foreground", ADAPTIVE_DP)
        write(monochrome, density, "ic_launcher_monochrome", ADAPTIVE_DP)

    print("wrote", sum(1 for _ in OUT.rglob("*.webp")), "files into", OUT)


if __name__ == "__main__":
    main()
