import type { Rng } from '../../core/rng';
import type { Poi } from '../GameMap';
import { T } from '../tiles';
import { GENERATOR, HOUSES } from '../../config/generator';
import { computeLots } from '../houses';
import type { GenGrid } from './GenGrid';

/**
 * Жилые дома: из участков застройки (computeLots) — прямоугольные, у переулка, в жилом квартале —
 * доля HOUSES.homes.share становится домом: стены в тайл, пол внутри, дверь в 2 тайла на переулок
 * (перед ней — 2 тайла проходимого, чтобы пройти якорем 2×2). Только добавляет проходимое, связанное
 * с переулком дверью, — связность не ломается.
 */
export function addHomes(g: GenGrid, rng: Rng, seed: number, isResidential: (x: number, y: number) => boolean, pois: Poi[]): number {
  const H = HOUSES.homes;
  const { lots } = computeLots(g.w, g.h, g.tiles, seed);
  const open = (x: number, y: number) => g.inside(x, y) && g.passable(x, y) && g.get(x, y) !== T.DOOR;
  let made = 0;
  for (const l of lots) {
    const w = l.x1 - l.x0 + 1;
    const h = l.y1 - l.y0 + 1;
    if (l.tiles !== w * h || Math.min(w, h) < H.minSide || w * h < H.minArea || Math.max(w, h) > H.max[0] || Math.min(w, h) > H.max[1]) continue;
    if (!isResidential(l.x0 + (w >> 1), l.y0 + (h >> 1)) || !rng.chance(H.share)) continue;
    let locked = false;
    for (let y = l.y0; y <= l.y1 && !locked; y++) for (let x = l.x0; x <= l.x1; x++) if (g.isLocked(x, y)) locked = true;
    if (locked) continue;
    // Сторона с переулком: 2 соседних тайла снаружи (в глубину 2) проходимы — там дверь.
    const doors: { x: number; y: number; dx: number; dy: number }[] = [];
    for (let x = l.x0 + 1; x <= l.x1 - 2; x++) {
      if (open(x, l.y0 - 1) && open(x + 1, l.y0 - 1) && open(x, l.y0 - 2) && open(x + 1, l.y0 - 2)) doors.push({ x, y: l.y0, dx: 1, dy: 0 });
      if (open(x, l.y1 + 1) && open(x + 1, l.y1 + 1) && open(x, l.y1 + 2) && open(x + 1, l.y1 + 2)) doors.push({ x, y: l.y1, dx: 1, dy: 0 });
    }
    for (let y = l.y0 + 1; y <= l.y1 - 2; y++) {
      if (open(l.x0 - 1, y) && open(l.x0 - 1, y + 1) && open(l.x0 - 2, y) && open(l.x0 - 2, y + 1)) doors.push({ x: l.x0, y, dx: 0, dy: 1 });
      if (open(l.x1 + 1, y) && open(l.x1 + 1, y + 1) && open(l.x1 + 2, y) && open(l.x1 + 2, y + 1)) doors.push({ x: l.x1, y, dx: 0, dy: 1 });
    }
    if (!doors.length) continue;
    const d = rng.pick(doors);
    // Как у деталей застройки: открыл прострел длиннее нормы (дверь в створ переулка) — откат.
    const area = { x: l.x0 - 2, y: l.y0 - 2, w: w + 4, h: h + 4 };
    const snap = g.snapshot(area);
    g.fillRect({ x: l.x0 + 1, y: l.y0 + 1, w: w - 2, h: h - 2 }, T.INTERIOR);
    g.set(d.x, d.y, T.DOOR);
    g.set(d.x + d.dx, d.y + d.dy, T.DOOR);
    if (g.maxRunIn(area) > GENERATOR.alley.maxStraight) {
      g.restore(snap);
      continue;
    }
    pois.push({ type: 'home', x: l.x0 + 1, y: l.y0 + 1, w: w - 2, h: h - 2 });
    made++;
  }
  return made;
}
