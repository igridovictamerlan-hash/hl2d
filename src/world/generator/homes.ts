import { hash2, type Rng } from '../../core/rng';
import type { District, Poi } from '../GameMap';
import { T } from '../tiles';
import { GENERATOR, HOUSES } from '../../config/generator';
import { computeLots } from '../houses';
import type { GenGrid } from './GenGrid';
import { CELL, planHome } from './interiors';

/**
 * Жилые дома: из участков застройки (computeLots) — прямоугольные, у переулка, в жилом квартале —
 * доля HOUSES.homes.share становится домом: стены в тайл, пол внутри, дверь в 2 тайла на переулок
 * (перед ней — 2 тайла проходимого, чтобы пройти якорем 2×2). Только добавляет проходимое, связанное
 * с переулком дверью, — связность не ломается. Внутри — планировка по полосе достатка (generator/interiors.ts:
 * district, без него — одна комната): комнаты — POI room, коммуналка — по жилью (POI home) на комнату. С later
 * перегородки и POI дома ставятся отложенно (генератор вызовет после связности; дом, сквозь который прошёл тоннель,
 * остаётся одной комнатой): пока выбираются участки, в тайлах дом — одна комната, и город вокруг тот же, что без
 * планировки. Возвращает число домов.
 */
export function addHomes(
  g: GenGrid,
  rng: Rng,
  seed: number,
  isResidential: (x: number, y: number) => boolean,
  pois: Poi[],
  district?: (x: number, y: number) => District | null,
  later?: (() => void)[],
): number {
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
    const inner = { x: l.x0 + 1, y: l.y0 + 1, w: w - 2, h: h - 2 };
    made++;
    if (!district) {
      pois.push({ type: 'home', ...inner });
      continue;
    }
    // План в своих координатах: c — вдоль стены с дверью, r — вглубь от неё.
    const side = d.dy === 0 ? (d.y === l.y0 ? 'N' : 'S') : d.x === l.x0 ? 'W' : 'E';
    const W = side === 'N' || side === 'S' ? inner.w : inner.h;
    const D = side === 'N' || side === 'S' ? inner.h : inner.w;
    const door = side === 'N' || side === 'S' ? d.x - inner.x : d.y - inner.y;
    const map = (c: number, r: number) =>
      side === 'N' ? { x: inner.x + c, y: inner.y + r }
      : side === 'S' ? { x: inner.x + c, y: inner.y + inner.h - 1 - r }
      : side === 'W' ? { x: inner.x + r, y: inner.y + c }
      : { x: inner.x + inner.w - 1 - r, y: inner.y + c };
    const plan = planHome(W, D, door, district(inner.x + (inner.w >> 1), inner.y + (inner.h >> 1)), hash2(seed, l.x0, l.y0));
    const rectOf = (q: { c0: number; r0: number; c1: number; r1: number }) => {
      const a = map(q.c0, q.r0);
      const b = map(q.c1, q.r1);
      return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x) + 1, h: Math.abs(b.y - a.y) + 1 };
    };
    /** Дом цел: стены, дверь и пол — как поставлены (тоннель связности не прошёл сквозь него, пол не засыпан). */
    const intact = () => {
      for (let y = l.y0; y <= l.y1; y++) {
        for (let x = l.x0; x <= l.x1; x++) {
          const edge = x === l.x0 || x === l.x1 || y === l.y0 || y === l.y1;
          const isDoor = (x === d.x && y === d.y) || (x === d.x + d.dx && y === d.y + d.dy);
          if (g.get(x, y) !== (isDoor ? T.DOOR : edge ? T.WALL : T.INTERIOR)) return false;
        }
      }
      return true;
    };
    const apply = () => {
      if (!intact()) {
        pois.push({ type: 'home', ...inner });
        return;
      }
      for (let r = 0; r < D; r++) {
        for (let c = 0; c < W; c++) {
          const v = plan.cells[r * W + c];
          const p = map(c, r);
          g.set(p.x, p.y, v === CELL.WALL ? T.WALL : v === CELL.DOOR ? T.DOOR : T.INTERIOR);
        }
      }
      const own = plan.rooms.length > 1 ? plan.rooms.filter((rm) => rm.dwelling) : [];
      if (plan.rooms.length > 1) for (const rm of plan.rooms) pois.push({ type: 'room', ...rectOf(rm), sub: rm.kind });
      if (own.length) for (const rm of own) pois.push({ type: 'home', ...rectOf(rm) });
      else pois.push({ type: 'home', ...inner });
    };
    if (later) later.push(apply);
    else apply();
  }
  return made;
}
