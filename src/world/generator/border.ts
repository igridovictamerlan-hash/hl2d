import { GENERATOR } from '../../config/generator';
import { T, type TileId } from '../tiles';
import type { Poi } from '../GameMap';
import type { GenGrid } from './GenGrid';
import { avenueSegAt, type Avenue } from './layout';

/**
 * Стена Верхнего города (вариант B): Стена Протектората толщиной wealth.wall с x = upperX от северной до южной
 * городской стены. Переулки её не пересекают (линия решётки на ней пуста), сквозь неё идут только проспекты: на
 * каждом — блок-пост (wealth.post) во всю ширину асфальта (тесно — шире, асфальт прорезается). Сквозь стену две
 * полосы по lane тайлов (тайлы ворот): въезд в Верхний город — южная, выезд — северная; между ними островок: с запада —
 * бетонный нос (блоки), с востока — площадка досмотра (бетон) с перилами вдоль выезда и столом досмотра вдоль въезда.
 * На подходе к въезду — змейка из блоков (проход не уже 2 тайлов), севернее полос за стеной — здание поста (комнаты,
 * дверь к выезду, окно), южнее — огневая точка из мешков (открыта к полосе). Всё — заблокировано (lock): детали
 * застройки, дома вдоль проспекта и тоннели связности его не трогают. POI: border_gate (проём: x, y — левый верхний
 * тайл, w, h — ширина КПП, face 'E' — сторона Верхнего города; id — первый ряд островка от y), border_check (проход:
 * от носа островка до конца площадки досмотра — здесь проверяют документы и досматривают вещи), border_post — RCT (проверка документов у въезда и
 * выезда), border_duty — дежурные SU.03 (за столом досмотра и в огневой точке), border_booth — здание поста, border_table
 * — стол досмотра, border_nest — огневая точка (x, y, w, h). Возвращает число постов.
 */
export function buildBorderWall(g: GenGrid, upperX: number, avenues: readonly Avenue[], pois: Poi[]): number {
  const D = GENERATOR.wealth;
  const P = D.post;
  const b = g.border;
  const x0 = upperX;
  const x1 = upperX + D.wall - 1;
  const gateRow = new Uint8Array(g.h);
  let posts = 0;
  const put = (x: number, y: number, t: TileId) => {
    g.set(x, y, t, true);
    g.locked[y * g.w + x] = 1;
  };
  const fill = (x: number, y: number, w: number, h: number, t: TileId) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(xx, yy, t);
  };
  for (const av of avenues) {
    if (!av.horizontal || av.band.x + av.band.w <= x1 + 1) continue;
    // Асфальт сразу западнее и сразу восточнее стены (на стыке участков края проспекта сдвигаются): блок-пост — в их
    // общей части; тесно — шире (асфальт прорезается).
    const w = avenueSegAt(av, x0 - 1);
    const e = avenueSegAt(av, x1 + 1);
    let cy0 = Math.max(w.offset, e.offset);
    let cy1 = Math.min(w.offset + w.width, e.offset + e.width) - 1;
    while (cy1 - cy0 + 1 < 2 * P.lane + P.island) {
      if ((cy1 - cy0) % 2) cy0--;
      else cy1++;
    }
    const cw = cy1 - cy0 + 1;
    const i0 = cy0 + P.lane; // островок: ряды i0..i1
    const i1 = cy1 - P.lane;
    const E = x1 + 1; // первый столбец за стеной (Верхний город)
    const xw = x0 - P.west; // начало подхода с запада
    const xe = E + P.east; // конец площадки досмотра
    // Полосы — асфальт от подхода до конца площадки, островок — с запада нос из блоков, с востока бетон.
    for (let y = cy0; y <= cy1; y++) {
      const island = y >= i0 && y <= i1;
      if (!island) gateRow[y] = 1;
      for (let x = xw - 2; x <= xe + 2; x++) {
        if (x >= x0 && x <= x1) continue;
        if (!island) put(x, y, T.STREET);
        else if (x >= x0 - P.nose && x < x0) put(x, y, T.BARRIER);
        else if (x >= E && x < xe) put(x, y, T.BUNKER);
        else if (!g.passable(x, y)) put(x, y, T.STREET);
        else g.locked[y * g.w + x] = 1;
      }
    }
    // Перила вдоль выезда (у стены — проход часового выезда) и стол досмотра вдоль въезда (у стены — место RCT).
    fill(E + 3, i0, xe - E - 3, 1, T.BARRIER);
    fill(E + P.table[0], i1, P.table[1], 1, T.BARRIER);
    pois.push({ type: 'border_table', x: E + P.table[0], y: i1, w: P.table[1], h: 1, face: 'S' });
    // Змейка на подходе к въезду: блоки поочерёдно у южного и северного края полосы (проход — 2 тайла).
    // У южного края — только если за полосой сплошное (иначе под блоком остался бы ряд асфальта, куда не пролезть).
    for (let k = 0; k < P.chicane; k++) {
      const bx = x0 - P.nose - 3 - k * 4;
      const south = k % 2 === 0;
      if (south && (g.passable(bx - 1, cy1 + 1) || g.passable(bx, cy1 + 1))) continue;
      fill(bx - 1, south ? cy1 : cy1 - P.lane + 1, 2, 1, T.BARRIER);
    }
    // Здание поста — севернее выезда за стеной: стены, пол, дверь к выезду, окно (стекло) в южной стене.
    const H = P.house;
    const hy = cy0 - H.h;
    fill(E, hy, H.w, H.h, T.WALL);
    fill(E + 1, hy + 1, H.w - 2, H.h - 2, T.INTERIOR);
    fill(E + H.w - 4, cy0 - 1, 2, 1, T.DOOR);
    fill(E + 2, cy0 - 1, 3, 1, T.BARRIER);
    // Мебель вдоль северной стены (пирамида, стол, койки) — ряд в тайл, под ней свободный пол в 3 ряда.
    fill(E + 1, hy + 1, H.w - 2, 1, T.BARRIER);
    pois.push({ type: 'border_booth', x: E, y: hy, w: H.w, h: H.h, face: 'S' });
    // Огневая точка — южнее въезда, вплотную к стене: мешки буквой П, открыта к полосе.
    const N = P.nest;
    fill(E, cy1 + 1, N.w, N.h, T.BARRIER);
    fill(E + 1, cy1 + 1, N.w - 2, N.h - 1, T.BUNKER);
    pois.push({ type: 'border_nest', x: E, y: cy1 + 1, w: N.w, h: N.h, face: 'N' });
    // Посты: RCT — документы у въезда (за стеной у стола) и у выезда; SU.03 — за столом досмотра и в огневой точке.
    pois.push({ type: 'border_post', x: E, y: i1 - 1, face: 'S' });
    pois.push({ type: 'border_post', x: E, y: i0, face: 'N' });
    pois.push({ type: 'border_duty', x: E + P.table[0] + 1, y: i1 - 2, face: 'S' });
    pois.push({ type: 'border_duty', x: E + 1, y: cy1 + 1, face: 'N' });
    pois.push({ type: 'border_gate', x: x0, y: cy0, w: D.wall, h: cw, face: 'E', id: i0 - cy0 });
    pois.push({ type: 'border_check', x: x0 - P.nose, y: cy0, w: xe - x0 + P.nose, h: cw });
    posts++;
    // Асфальт у ворот — без ларьков и клумб; только общая часть проспекта по обе стороны стены.
    for (let y = cy0; y <= cy1; y++) {
      for (let x = x0 - D.gateClear; x <= x1 + D.gateClear; x++) if (g.get(x, y) === T.STREET) g.locked[y * g.w + x] = 1;
    }
  }
  for (let y = b; y < g.h - b; y++) {
    for (let x = x0; x <= x1; x++) put(x, y, gateRow[y] ? T.GATE : T.METAL);
  }
  return posts;
}
