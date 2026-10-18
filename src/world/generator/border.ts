import { GENERATOR } from '../../config/generator';
import { T } from '../tiles';
import type { Poi } from '../GameMap';
import type { GenGrid } from './GenGrid';
import { avenueSegAt, type Avenue } from './layout';

/**
 * Стена Верхнего города (вариант B): Стена Протектората толщиной wealth.wall с x = upperX от северной до южной
 * городской стены. Переулки её не пересекают (линия решётки на ней пуста), сквозь неё идут только проспекты: на
 * каждом — пост, проём open тайлов посередине асфальта (тайлы ворот), по бокам — стена. Стена и ворота заблокированы
 * (lock): детали застройки и тоннели связности их не трогают; асфальт у ворот на gateClear тайлов по обе стороны —
 * тоже (ларьки и клумбы не встанут в проезд). POI: border_gate (проём: x, y — левый верхний тайл, w, h, face 'E' —
 * сторона Верхнего города), border_post — места часовых (по два на пост, с восточной стороны, по краям проёма),
 * border_booth — будка поста (стена у южного края проёма). Возвращает число постов.
 */
export function buildBorderWall(g: GenGrid, upperX: number, avenues: readonly Avenue[], pois: Poi[]): number {
  const D = GENERATOR.wealth;
  const b = g.border;
  const x0 = upperX;
  const x1 = upperX + D.wall - 1;
  const gateRow = new Uint8Array(g.h);
  let posts = 0;
  for (const av of avenues) {
    if (!av.horizontal || av.band.x + av.band.w <= x1 + 1) continue;
    // Асфальт сразу западнее и сразу восточнее стены (на стыке участков края проспекта сдвигаются): проём —
    // посередине их общей части, на всякий случай проезд через стену прорезается асфальтом.
    const w = avenueSegAt(av, x0 - 1);
    const e = avenueSegAt(av, x1 + 1);
    const ya = Math.min(w.offset, e.offset);
    const yb = Math.max(w.offset + w.width, e.offset + e.width) - 1;
    const mid = (Math.max(w.offset, e.offset) + Math.min(w.offset + w.width, e.offset + e.width)) / 2;
    const oy = Math.max(ya + 1, Math.min(yb - D.open, Math.round(mid - D.open / 2)));
    for (let y = oy; y < oy + D.open; y++) {
      gateRow[y] = 1;
      // Подъезд к проёму — асфальт и заблокирован: дома вдоль проспекта не встанут вплотную к проёму.
      for (let x = x0 - 2; x <= x1 + 2; x++) {
        if (!g.passable(x, y)) g.set(x, y, T.STREET);
        g.locked[y * g.w + x] = 1;
      }
    }
    pois.push({ type: 'border_gate', x: x0, y: oy, w: D.wall, h: D.open, face: 'E' });
    // Часовые — с восточной стороны, у краёв проёма; будка — на стене у южного края проёма.
    pois.push({ type: 'border_post', x: x1 + 2, y: oy, face: 'W' });
    pois.push({ type: 'border_post', x: x1 + 2, y: oy + D.open - 2, face: 'W' });
    pois.push({ type: 'border_booth', x: x0, y: oy + D.open, w: D.wall, h: Math.max(1, yb - (oy + D.open) + 1) });
    posts++;
    // Асфальт у ворот — без ларьков и клумб; только общая часть проспекта по обе стороны стены (края, где участки
    // проспекта разной ширины, не трогаем — иначе у стены остаются карманы в тайл, которые нельзя засыпать).
    for (let y = Math.max(w.offset, e.offset); y < Math.min(w.offset + w.width, e.offset + e.width); y++) {
      for (let x = x0 - D.gateClear; x <= x1 + D.gateClear; x++) if (g.get(x, y) === T.STREET) g.locked[y * g.w + x] = 1;
    }
  }
  for (let y = b; y < g.h - b; y++) {
    for (let x = x0; x <= x1; x++) {
      g.set(x, y, gateRow[y] ? T.GATE : T.METAL, true);
      g.locked[y * g.w + x] = 1;
    }
  }
  return posts;
}
