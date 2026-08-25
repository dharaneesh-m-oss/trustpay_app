"""Assembles the TrustPay walkthrough video.

Audio drives the edit. Each narration clip is measured first, then the picture
for that line is cut to exactly that length, so the voice never runs past what
it is describing — the usual failure when a script is written to guessed
timings.

The phone recording is portrait (392x850) and the deck slides are 16:9. Both are
placed on one 1920x1080 canvas: slides fill it, the phone sits centred on the
same near-black ground the app uses, so the cuts between them do not flash.

Run: python build.py
"""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent
WSL_ROOT = "/mnt/d/projects/TrustPay-main/video"
WSL_DECK = "/mnt/d/projects/TrustPay-main/deck"

W, H = 1920, 1080
BG = "0x0B0B0C"
PHONE_H = 880           # leaves room for the caption band
BAND = 150              # reserved strip at the bottom for captions
PAD_AFTER = 0.45        # breath between lines
FPS = 30


def wsl(cmd: str, timeout: int = 900) -> str:
    """Run one command inside WSL, where ffmpeg lives."""
    result = subprocess.run(
        ["wsl", "-d", "Ubuntu", "-e", "bash", "-lc", cmd],
        capture_output=True, text=True, timeout=timeout,
    )
    if result.returncode != 0:
        sys.stderr.write(result.stdout[-2000:] + result.stderr[-2000:])
        raise SystemExit(f"failed: {cmd[:90]}")
    return result.stdout.strip()


def duration(rel: str) -> float:
    out = wsl(
        f'ffprobe -v error -show_entries format=duration -of csv=p=0 "{WSL_ROOT}/{rel}"'
    )
    return float(out)


def ass_escape(text: str) -> str:
    return text.replace("\\", "").replace("{", "(").replace("}", ")")


def wrap(text: str, width: int = 74) -> str:
    """Two lines at most; a third line crowds the phone above it."""
    words, lines, line = text.split(), [], ""
    for word in words:
        candidate = f"{line} {word}".strip()
        if len(candidate) <= width:
            line = candidate
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return "\\N".join(lines[:3])


def timestamp(seconds: float) -> str:
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{int(hours)}:{int(minutes):02d}:{secs:05.2f}"


def main() -> None:
    plan = json.loads((ROOT / "script.json").read_text(encoding="utf-8"))
    segments = plan["segments"]

    (ROOT / "parts").mkdir(exist_ok=True)

    # --- measure first, then cut to fit -----------------------------------
    for seg in segments:
        seg["audio"] = f"audio/seg-{seg['id']}.wav"
        seg["dur"] = duration(seg["audio"]) + PAD_AFTER

    total = sum(s["dur"] for s in segments)
    print(f"total runtime: {total:.1f}s  ({total/60:.2f} min)")
    if total > 180:
        print("WARNING: over the three-minute limit")

    # --- picture ----------------------------------------------------------
    for seg in segments:
        out = f"parts/v-{seg['id']}.mp4"
        dur = seg["dur"]

        if seg["src"] == "app":
            # `-ss` before `-i` seeks fast; re-encoding anyway, so accuracy is
            # frame-exact rather than keyframe-bound.
            vf = (
                f"scale=-2:{PHONE_H},"
                f"pad={W}:{H}:(ow-iw)/2:{(H - BAND - PHONE_H) // 2}:color={BG},"
                f"fps={FPS},format=yuv420p"
            )
            cmd = (
                f'cd {WSL_ROOT} && ffmpeg -v error -ss {seg["start"]} -t {dur:.3f} '
                f'-i screen.mp4 -an -vf "{vf}" '
                f'-c:v libx264 -preset medium -crf 20 -r {FPS} "{out}" -y'
            )
        else:
            src = f"{WSL_DECK}/slide-{seg['slide']:02d}.jpg"
            vf = (
                f"scale={W}:{H - BAND}:force_original_aspect_ratio=decrease,"
                f"pad={W}:{H}:(ow-iw)/2:0:color={BG},"
                f"fps={FPS},format=yuv420p"
            )
            cmd = (
                f'cd {WSL_ROOT} && ffmpeg -v error -loop 1 -t {dur:.3f} -i "{src}" '
                f'-vf "{vf}" -c:v libx264 -preset medium -crf 20 -r {FPS} "{out}" -y'
            )
        wsl(cmd)
        print(f"  picture {seg['id']}  {dur:5.2f}s")

    # --- sound: narration plus its trailing pause -------------------------
    for seg in segments:
        out = f"parts/a-{seg['id']}.wav"
        cmd = (
            f'cd {WSL_ROOT} && ffmpeg -v error -i "{seg["audio"]}" '
            f'-af "apad=pad_dur={PAD_AFTER},aresample=48000" -t {seg["dur"]:.3f} '
            f'-c:a pcm_s16le -ar 48000 -ac 2 "{out}" -y'
        )
        wsl(cmd)

    # --- captions ---------------------------------------------------------
    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {W}\nPlayResY: {H}\n"
        "WrapStyle: 2\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour,"
        " Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV\n"
        # BorderStyle 3 draws a filled box behind the text, which keeps captions
        # readable over both the white slides and the dark app footage.
        "Style: Cap,Arial,38,&H00FFFFFF,&H00000000,&HC8000000,0,3,12,0,2,140,140,34\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Text\n"
    )
    lines, clock = [], 0.0
    for seg in segments:
        start, end = clock, clock + seg["dur"] - 0.10
        lines.append(
            f"Dialogue: 0,{timestamp(start)},{timestamp(end)},Cap,"
            f"{wrap(ass_escape(seg['text']))}"
        )
        clock += seg["dur"]
    (ROOT / "captions.ass").write_text(header + "\n".join(lines) + "\n", encoding="utf-8")
    print(f"  captions: {len(lines)} lines")

    # --- concat, mux, burn ------------------------------------------------
    (ROOT / "parts" / "video.txt").write_text(
        "".join(f"file 'v-{s['id']}.mp4'\n" for s in segments), encoding="utf-8"
    )
    (ROOT / "parts" / "audio.txt").write_text(
        "".join(f"file 'a-{s['id']}.wav'\n" for s in segments), encoding="utf-8"
    )

    wsl(
        f'cd {WSL_ROOT}/parts && ffmpeg -v error -f concat -safe 0 -i video.txt '
        f'-c copy ../silent.mp4 -y'
    )
    wsl(
        f'cd {WSL_ROOT}/parts && ffmpeg -v error -f concat -safe 0 -i audio.txt '
        f'-c copy ../voice.wav -y'
    )
    wsl(
        f'cd {WSL_ROOT} && ffmpeg -v error -i silent.mp4 -i voice.wav '
        f'-vf "subtitles=captions.ass" '
        f'-c:v libx264 -preset medium -crf 21 -pix_fmt yuv420p '
        f'-c:a aac -b:a 192k -ar 48000 -movflags +faststart '
        f'-shortest TrustPay-demo.mp4 -y',
        timeout=1800,
    )

    final = duration("TrustPay-demo.mp4")
    print(f"\nTrustPay-demo.mp4  {final:.1f}s  ({final/60:.2f} min)")


if __name__ == "__main__":
    main()
