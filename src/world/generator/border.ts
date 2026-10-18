import { GENERATOR } from '../../config/generator';
import { T, type TileId } from '../tiles';
import type { Poi } from '../GameMap';
import type { GenGrid } from './GenGrid';
import { avenueSegAt, type Avenue } from './layout';

/**
 * Стена Верхнего города (вариант B): Стена Протектората толщиной wealth.wall с x = upperX от северной до южной
 * городской стены. Переулки её не пересекают (линия решётки на ней пуста), сквозь неё идут только проспекты: на
 * каждом — КПП во всю общую ширину асфальта по обе стороны стены: две полосы (проёмы — тайлы ворот), между ними —
 * островок из стены и двух стеклянных будок (wealth.booth: по одной с каждой стороны стены, стёкла — укрытие, видно
 * насквозь; дверь — в торце, от стены), на полосах — шлагбаумы (картинка); асфальт тесный — КПП шире него. Стена, будки и подъезды
 * заблокированы (lock): детали застройки и тоннели связности их не трогают; асфальт у ворот на gateClear тайлов по
 * обе стороны — тоже (ларьки и клумбы не встанут в проезд). POI: border_gate (x, y — левый верхний тайл проёма, w, h —
 * вся ширина КПП, face 'E' — сторона Верхнего города; id — первый ряд островка от y, его высота — wealth.booth),
 * border_post — места часовых (внутри будок, якорь 2×2 = пол будки), border_booth — будка (x, y, w, h; face — дверь).
 * Возвращает число постов.
 */
export function buildBorderWall(g: GenGrid, upperX: number, avenues: readonly Avenue[], pois: Poi[]): number {
  const D = GENERATOR.wealth;
  const B = D.booth;
  const b = g.border;
  const x0 = upperX;
  const x1 = upperX + D.wall - 1;
  const gateRow = new Uint8Array(g.h);
  let posts = 0;
  const put = (x: number, y: number, t: TileId) => {
    g.set(x, y, t, true);
    g.locked[y * g.w + x] = 1;
  };
  // Будка: стеклянные стены (укрытие), пол 2×2, дверь 2 тайла в торце со стороны face; часовой — на полу.
  const booth = (bx: number, by: number, face: 'E' | 'W') => {
    for (let y = by; y < by + B; y++) for (let x = bx; x < bx + B; x++) put(x, y, y === by || y === by + B - 1 || x === bx || x === bx + B - 1 ? T.BARRIER : T.INTERIOR);
    const dx = face === 'E' ? bx + B - 1 : bx;
    for (let y = by + 1; y < by + B - 1; y++) put(dx, y, T.DOOR);
    pois.push({ type: 'border_booth', x: bx, y: by, w: B, h: B, face });
    pois.push({ type: 'border_post', x: bx + 1, y: by + 1, face: face === 'E' ? 'S' : 'N' });
  };
  for (const av of avenues) {
    if (!av.horizontal || av.band.x + av.band.w <= x1 + 1) continue;
    // Асфальт сразу западнее и сразу восточнее стены (на стыке участков края проспекта сдвигаются): КПП — в их общей
    // части, на всякий случай проезды через стену прорезаются асфальтом.
    const w = avenueSegAt(av, x0 - 1);
    const e = avenueSegAt(av, x1 + 1);
    let cy0 = Math.max(w.offset, e.offset);
    let cy1 = Math.min(w.offset + w.width, e.offset + e.width) - 1;
    // Две полосы не уже 2 тайлов и островок посередине; тесно — КПП шире общей части (асфальт прорезается).
    while (cy1 - cy0 + 1 < B + 4) {
      if ((cy1 - cy0) % 2) cy0--;
      else cy1++;
    }
    const cw = cy1 - cy0 + 1;
    const reach = B + 1; // подъезд по обе стороны стены — на длину будки и ещё тайл
    const i0 = cy0 + ((cw - B) >> 1);
    for (let y = cy0; y <= cy1; y++) {
      const island = y >= i0 && y < i0 + B;
      if (!island) gateRow[y] = 1;
      for (let x = x0 - reach; x <= x1 + reach; x++) {
        if (!island && !g.passable(x, y)) g.set(x, y, T.STREET, true);
        g.locked[y * g.w + x] = 1;
      }
    }
    booth(x0 - B, i0, 'W');
    booth(x1 + 1, i0, 'E');
    pois.push({ type: 'border_gate', x: x0, y: cy0, w: D.wall, h: cw, face: 'E', id: i0 - cy0 });
    posts++;
    // Асфальт у ворот — без ларьков и клумб; только общая часть проспекта по обе стороны стены (края, где участки
    // проспекта разной ширины, не трогаем — иначе у стены остаются карманы в тайл, которые нельзя засыпать).
    for (let y = cy0; y <= cy1; y++) {
      for (let x = x0 - D.gateClear; x <= x1 + D.gateClear; x++) if (g.get(x, y) === T.STREET) g.locked[y * g.w + x] = 1;
    }
  }
  for (let y = b; y < g.h - b; y++) {
    for (let x = x0; x <= x1; x++) put(x, y, gateRow[y] ? T.GATE : T.METAL);
  }
  return posts;
}
