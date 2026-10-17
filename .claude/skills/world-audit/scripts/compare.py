#!/usr/bin/env python3
"""Склеить замеры одну под другой с подписями (до/после) — картинка для пользователя.

  python3 .claude/skills/world-audit/scripts/compare.py --out /tmp/hl2d-audit/compare.png \
      /tmp/hl2d-audit/heat_before.json "ДО: …" /tmp/hl2d-audit/heat_after.json "ПОСЛЕ: …"

Входы — heat_<тег>.json из density.viz.ts (лучше: все перерисовываются с ОБЩЕЙ нормировкой цвета — максимум из
всех прогонов, плюс шкала «людей в ячейке») или готовые PNG (каждая со своей нормировкой, как была).
Подпись "auto" — из density_<тег>.txt рядом (живых, самая людная ячейка жителей, доля у площади). Нужен Pillow.
"""
import argparse
import base64
import json
import math
import os
import re

from PIL import Image, ImageDraw, ImageFont

COLORS = [(255, 230, 120), (160, 255, 160), (150, 200, 255), (255, 170, 170)]
SCALE = 2


def font(size):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def tag_of(path):
    m = re.search(r"heat_(.+)\.(png|json)$", path)
    return m.group(1) if m else None


def auto_caption(path):
    tag = tag_of(path)
    txt = os.path.join(os.path.dirname(path), f"density_{tag}.txt") if tag else None
    if not txt or not os.path.exists(txt):
        return os.path.basename(path)
    text = open(txt, encoding="utf-8").read()
    parts = [tag.upper()]
    alive = re.search(r"всего живых (\d+)", text)
    res_peak = re.search(r"жителей \(без задержанных\) — (\d+)", text)
    near = re.search(r"у площади \(ближе \d+ тайлов\) в среднем ([\d.]+) жителей из ([\d.]+) \((\d+)%\)", text)
    if alive:
        parts.append(f"живых {alive.group(1)}")
    if res_peak:
        parts.append(f"самая людная ячейка — {res_peak.group(1)} жителей")
    if near:
        parts.append(f"у площади {near.group(3)}% жителей")
    return " · ".join(parts)


def render(d, maxv):
    """Перерисовать heat_<тег>.json: подложка ×SCALE, плотность с общей нормировкой, площадь и круг «у площади»."""
    w, h, c, gw = d["width"], d["height"], d["cell"], d["gw"]
    base = base64.b64decode(d["base"])
    heat = d["heat"]
    im = Image.new("RGB", (w * SCALE, h * SCALE))
    px = im.load()
    for y in range(h):
        for x in range(w):
            o = (y * w + x) * 3
            r, g, b = base[o], base[o + 1], base[o + 2]
            v = heat[(y // c) * gw + (x // c)] / maxv
            if v > 0.02:
                a = min(1.0, math.sqrt(v))
                r = r * (1 - a) + 255 * a
                g = g * (1 - a) + (230 - 200 * min(1.0, v)) * a
                b = b * (1 - a) + 40 * a
            col = (int(r), int(g), int(b))
            for dy in range(SCALE):
                for dx in range(SCALE):
                    px[x * SCALE + dx, y * SCALE + dy] = col
    if d.get("plaza"):
        dr = ImageDraw.Draw(im)
        cx, cy = d["plaza"][0] * SCALE, d["plaza"][1] * SCALE
        rr = d.get("near", 50) * SCALE
        dr.rectangle([cx - 4, cy - 4, cx + 4, cy + 4], fill=(255, 235, 60))
        dr.arc([cx - rr, cy - rr, cx + rr, cy + rr], 0, 360, fill=(255, 235, 60))
    return im


def legend(width, maxv, fnt):
    """Шкала: 0 … maxv людей в ячейке (средняя за прогон)."""
    im = Image.new("RGB", (width, 26), (20, 20, 20))
    d = ImageDraw.Draw(im)
    bar_w = min(260, width - 200)
    for i in range(bar_w):
        v = i / max(1, bar_w - 1)
        a = min(1.0, math.sqrt(v))
        r = 40 * (1 - a) + 255 * a
        g = 40 * (1 - a) + (230 - 200 * v) * a
        b = 40 * (1 - a) + 40 * a
        d.line([(8 + i, 6), (8 + i, 20)], fill=(int(r), int(g), int(b)))
    d.text((16 + bar_w, 5), f"0 … {maxv:.1f} людей в ячейке (средняя за прогон, общая шкала)", fill=(220, 220, 220), font=fnt)
    return im


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
    ap.add_argument("--maxv", type=float, default=None, help="общая нормировка (по умолчанию — максимум из JSON-входов)")
    ap.add_argument("items", nargs="+", help="файл подпись файл подпись …")
    a = ap.parse_args()
    if len(a.items) % 2:
        a.items.append("auto")
    pairs = [(a.items[i], a.items[i + 1]) for i in range(0, len(a.items), 2)]
    data = {p: json.load(open(p, encoding="utf-8")) for p, _ in pairs if p.endswith(".json")}
    maxv = a.maxv or max([d["max"] for d in data.values()] or [1.0])
    imgs = [render(data[p], maxv) if p in data else Image.open(p).convert("RGB") for p, _ in pairs]
    width = max(im.width for im in imgs)
    fnt = font(a.size)
    small = font(max(11, a.size - 3))
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    blocks = []
    for (path, cap), im in zip(pairs, imgs):
        text = auto_caption(path) if cap == "auto" else cap
        blocks.append((wrap(probe, text, fnt, width - 16), im))
    line_h = a.size + 4
    leg = legend(width, maxv, small) if data else None
    total = sum(len(t) * line_h + 12 + im.height for t, im in blocks) + (leg.height if leg else 0)
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
    if leg:
        out.paste(leg, (0, y))
    out.save(a.out)
    print(f"{a.out} {out.width}×{out.height}, нормировка {maxv:.1f}")


if __name__ == "__main__":
    main()
