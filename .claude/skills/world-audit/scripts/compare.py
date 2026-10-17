#!/usr/bin/env python3
"""Склеить картинки замеров одну под другой с подписями (до/после) — для пользователя.

  python3 .claude/skills/world-audit/scripts/compare.py --out /tmp/hl2d-audit/compare.png \
      /tmp/hl2d-audit/heat_before.png "ДО: …" /tmp/hl2d-audit/heat_after.png "ПОСЛЕ: …"

Подпись "auto" — из density_<тег>.txt рядом с картинкой (живых и самая людная ячейка). Длинные подписи переносятся.
Нужен Pillow (в контейнере стоит).
"""
import argparse
import os
import re

from PIL import Image, ImageDraw, ImageFont

COLORS = [(255, 230, 120), (160, 255, 160), (150, 200, 255), (255, 170, 170)]


def font(size):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def auto_caption(png):
    m = re.search(r"heat_(.+)\.png$", png)
    txt = os.path.join(os.path.dirname(png), f"density_{m.group(1)}.txt") if m else None
    if not txt or not os.path.exists(txt):
        return os.path.basename(png)
    lines = open(txt, encoding="utf-8").read().splitlines()
    alive = re.search(r"всего живых (\d+)", lines[0])
    peak = re.search(r"ячейка [^:]+: (\d+)", lines[1]) if len(lines) > 1 else None
    tag = m.group(1)
    parts = [tag.upper()]
    if alive:
        parts.append(f"живых {alive.group(1)}")
    if peak:
        parts.append(f"самая людная ячейка {peak.group(1)} чел.")
    return " · ".join(parts)


def wrap(draw, text, fnt, width):
    out, line = [], ""
    for word in text.split():
        probe = f"{line} {word}".strip()
        if draw.textlength(probe, font=fnt) <= width:
            line = probe
        else:
            if line:
                out.append(line)
            line = word
    if line:
        out.append(line)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--size", type=int, default=15)
    ap.add_argument("items", nargs="+", help="картинка подпись картинка подпись …")
    a = ap.parse_args()
    if len(a.items) % 2:
        a.items.append("auto")
    pairs = [(a.items[i], a.items[i + 1]) for i in range(0, len(a.items), 2)]
    imgs = [Image.open(p).convert("RGB") for p, _ in pairs]
    width = max(im.width for im in imgs)
    fnt = font(a.size)
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    blocks = []
    for (path, cap), im in zip(pairs, imgs):
        text = auto_caption(path) if cap == "auto" else cap
        blocks.append((wrap(probe, text, fnt, width - 16), im))
    line_h = a.size + 4
    total = sum(len(t) * line_h + 12 + im.height for t, im in blocks)
    out = Image.new("RGB", (width, total), (20, 20, 20))
    d = ImageDraw.Draw(out)
    y = 0
    for k, (text, im) in enumerate(blocks):
        y += 6
        for line in text:
            d.text((8, y), line, fill=COLORS[k % len(COLORS)], font=fnt)
            y += line_h
        y += 6
        out.paste(im, (0, y))
        y += im.height
    out.save(a.out)
    print(f"{a.out} {out.width}×{out.height}")


if __name__ == "__main__":
    main()
