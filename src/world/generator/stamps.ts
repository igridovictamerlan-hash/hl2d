import type { Rect } from '../../core/math';
import type { Rng } from '../../core/rng';
import { GENERATOR } from '../../config/generator';
import { T, SOLID, type TileId } from '../tiles';
import type { Poi } from '../GameMap';
import type { GenGrid } from './GenGrid';
import type { GateSpec } from './layout';

/** Выход штампа: проходимые клетки на его краю и направление наружу. */
export interface Exit {
  tiles: { x: number; y: number }[];
  dx: number;
  dy: number;
}

const TEMPLATE_TILES: Record<string, TileId> = {
  M: T.METAL,
  '#': T.WALL,
  ',': T.INTERIOR,
  c: T.INTERIOR,
  D: T.DOOR,
  d: T.DOOR,
  ':': T.PLAZA,
  g: T.GATE,
  F: T.INTERIOR,
  k: T.BUNKER,
  o: T.WASTE,
  B: T.BARRIER,
  P: T.BUNKER,
  R: T.BUNKER,
  T: T.INTERIOR,
};

export interface StampResult {
  exits: Exit[];
  cells: Rect[];
}

/**
 * Переносит ASCII-шаблон в сетку (с блокировкой), ставит зоны и точки интереса.
 * zoneOf(ch) возвращает id зоны для символа шаблона.
 */
export function stampTemplate(
  g: GenGrid,
  rows: readonly string[],
  x0: number,
  y0: number,
  zoneOf: (ch: string, x: number, y: number) => number,
  pois: Poi[],
): StampResult {
  const h = rows.length;
  const w = rows[0].length;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      const t = TEMPLATE_TILES[ch] ?? T.WALL;
      g.set(x0 + x, y0 + y, t, true);
      g.zones[(y0 + y) * g.w + x0 + x] = zoneOf(ch, x, y);
      if (ch === 'F') pois.push({ type: 'nexus_desk', x: x0 + x, y: y0 + y });
      if (ch === 'P') pois.push({ type: 'checkpoint_post', x: x0 + x, y: y0 + y });
      if (ch === 'R') pois.push({ type: 'gate_post', x: x0 + x, y: y0 + y });
      if (ch === 'T') pois.push({ type: 'code_terminal', x: x0 + x, y: y0 + y });
    }
  }
  g.lockRect({ x: x0, y: y0, w, h });

  // Камеры: связные области 'c'.
  const cells: Rect[] = [];
  const seen = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rows[y][x] !== 'c' || seen[y * w + x]) continue;
      let minX = x, maxX = x, minY = y, maxY = y;
      const stack = [[x, y]];
      seen[y * w + x] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] || rows[ny][nx] !== 'c') continue;
          seen[ny * w + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      cells.push({ x: x0 + minX, y: y0 + minY, w: maxX - minX + 1, h: maxY - minY + 1 });
    }
  }

  // Выходы: группы проходимых клеток на краях шаблона.
  const exits: Exit[] = [];
  const passable = (ch: string) => SOLID[TEMPLATE_TILES[ch] ?? T.WALL] === 0;
  const scanSide = (coords: { x: number; y: number }[], dx: number, dy: number) => {
    let cur: Exit | null = null;
    for (const c of coords) {
      if (passable(rows[c.y][c.x])) {
        if (!cur) {
          cur = { tiles: [], dx, dy };
          exits.push(cur);
        }
        cur.tiles.push({ x: x0 + c.x, y: y0 + c.y });
      } else {
        cur = null;
      }
    }
  };
  const top = [], bottom = [], left = [], right = [];
  for (let x = 0; x < w; x++) {
    top.push({ x, y: 0 });
    bottom.push({ x, y: h - 1 });
  }
  for (let y = 1; y < h - 1; y++) {
    left.push({ x: 0, y });
    right.push({ x: w - 1, y });
  }
  scanSide(top, 0, -1);
  scanSide(bottom, 0, 1);
  scanSide(left, -1, 0);
  scanSide(right, 1, 0);
  return { exits, cells };
}

/**
 * Прокапывает проход от выхода наружу. Готово, когда в проходимое упёрлись минимум
 * minHits соседних клеток полосы (для узкой двери — все). Клетки, упёршиеся раньше, дальше не идут.
 * Возвращает false, если по пути заблокированная стена или слишком далеко (сетка не меняется).
 */
export function carveConnector(g: GenGrid, exit: Exit, maxLen: number, tile: TileId = T.FLOOR): boolean {
  const n = exit.tiles.length;
  const minHits = Math.min(n, 2);
  const stop = new Int32Array(n).fill(-1);
  for (let s = 1; s <= maxLen; s++) {
    for (let k = 0; k < n; k++) {
      if (stop[k] >= 0) continue;
      const x = exit.tiles[k].x + exit.dx * s;
      const y = exit.tiles[k].y + exit.dy * s;
      if (!g.inside(x, y)) return false;
      if (g.passable(x, y)) stop[k] = s;
      else if (g.isLocked(x, y)) return false;
    }
    // Есть ли minHits подряд упёршихся клеток?
    let run = 0;
    let ok = false;
    for (let k = 0; k < n; k++) {
      run = stop[k] >= 0 ? run + 1 : 0;
      if (run >= minHits) ok = true;
    }
    if (!ok) continue;
    for (let k = 0; k < n; k++) {
      const len = stop[k] >= 0 ? stop[k] : s + 1;
      for (let j = 1; j < len; j++) {
        const x = exit.tiles[k].x + exit.dx * j;
        const y = exit.tiles[k].y + exit.dy * j;
        if (!g.passable(x, y)) g.set(x, y, tile);
      }
    }
    return true;
  }
  return false;
}

/** Площадь раздачи: плитка + будка выдачи рационов у дальнего края. */
export function stampPlaza(g: GenGrid, plaza: Rect, side: 'N' | 'S', zone: number, pois: Poi[]): void {
  g.fillRect(plaza, T.PLAZA);
  g.setZoneRect(plaza, zone);
  const bw = 6;
  const bh = 3;
  const cx = plaza.x + Math.floor(plaza.w / 2);
  // Дальний от магистрали край площади.
  const by = side === 'N' ? plaza.y : plaza.y + plaza.h - bh;
  const booth = { x: cx - bw / 2, y: by, w: bw, h: bh };
  g.fillRect(booth, T.METAL, true);
  g.lockRect(booth);
  const wy = side === 'N' ? by + bh : by - 1;
  pois.push({ type: 'ration_window', x: cx, y: wy });
  pois.push({ type: 'plaza_center', x: cx, y: plaza.y + Math.floor(plaza.h / 2) });
  // Терминал найма — в углу площади у будки.
  pois.push({ type: 'recruit_terminal', x: plaza.x + 1, y: side === 'N' ? plaza.y + 1 : plaza.y + plaza.h - 2 });
}

/** Прямоугольник, который займёт проход от выхода длиной len. */
export function connectorArea(exit: Exit, len: number): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of exit.tiles) {
    for (const s of [0, len]) {
      x0 = Math.min(x0, t.x + exit.dx * s); x1 = Math.max(x1, t.x + exit.dx * s);
      y0 = Math.min(y0, t.y + exit.dy * s); y1 = Math.max(y1, t.y + exit.dy * s);
    }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Проход от выхода с проверкой прямого обзора: если через него открылась прямая длиннее
 * maxStraight — откат. Возвращает false при неудаче (сетка не изменена).
 */
export function carveConnectorChecked(g: GenGrid, exit: Exit, maxLen: number): boolean {
  const area = connectorArea(exit, maxLen);
  const snap = g.snapshot(area);
  if (carveConnector(g, exit, maxLen) && g.maxRunIn(area) <= GENERATOR.alley.maxStraight) return true;
  g.restore(snap);
  return false;
}

/**
 * Кольцевая стена запретной зоны с воротами-КПП. Позицию ворот на каждой стороне подбирает
 * перебором: оба прохода (внутрь и наружу) должны прокопаться, прямой обзор — в пределах нормы.
 */
export function stampRestricted(g: GenGrid, rect: Rect, gates: GateSpec[], rng: Rng, pois: Poi[]): number {
  const t = GENERATOR.restricted.wallThickness;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const ring = x < rect.x + t || y < rect.y + t || x >= rect.x + rect.w - t || y >= rect.y + rect.h - t;
      if (!ring) continue;
      g.set(x, y, T.METAL, true);
      g.locked[y * g.w + x] = 1;
    }
  }
  const maxLen = GENERATOR.connectorMax;
  const maxRun = GENERATOR.alley.maxStraight;
  let placed = 0;
  for (const gate of gates) {
    const horizontalSide = gate.side === 'N' || gate.side === 'S';
    const sideStart = horizontalSide ? rect.x : rect.y;
    const sideLen = horizontalSide ? rect.w : rect.h;
    const positions = [gate.pos];
    for (let k = 0; k < 24; k++) positions.push(sideStart + rng.int(6, sideLen - 6 - gate.width));

    const build = (pos: number) => {
      const cells: { x: number; y: number }[] = [];
      const inner: { x: number; y: number }[] = [];
      const outer: { x: number; y: number }[] = [];
      let dx = 0;
      let dy = 0;
      for (let k = 0; k < gate.width; k++) {
        for (let d = 0; d < t; d++) {
          let x = 0;
          let y = 0;
          if (gate.side === 'N') { x = pos + k; y = rect.y + d; dy = -1; }
          else if (gate.side === 'S') { x = pos + k; y = rect.y + rect.h - 1 - d; dy = 1; }
          else if (gate.side === 'W') { x = rect.x + d; y = pos + k; dx = -1; }
          else { x = rect.x + rect.w - 1 - d; y = pos + k; dx = 1; }
          cells.push({ x, y });
          if (d === 0) outer.push({ x, y });
          if (d === t - 1) inner.push({ x, y });
        }
      }
      const outExit: Exit = { tiles: outer, dx, dy };
      const inExit: Exit = { tiles: inner, dx: -dx, dy: -dy };
      const a1 = connectorArea(outExit, maxLen);
      const a2 = connectorArea(inExit, maxLen);
      const area: Rect = {
        x: Math.min(a1.x, a2.x), y: Math.min(a1.y, a2.y),
        w: Math.max(a1.x + a1.w, a2.x + a2.w) - Math.min(a1.x, a2.x),
        h: Math.max(a1.y + a1.h, a2.y + a2.h) - Math.min(a1.y, a2.y),
      };
      return { cells, outExit, inExit, area, mid: outer[Math.floor(outer.length / 2)] };
    };

    // Перебор позиций: оба прохода должны прокопаться; берём самую короткую прямую.
    let best = -1;
    let bestRun = Infinity;
    for (const pos of positions) {
      const b = build(pos);
      const snap = g.snapshot(b.area);
      for (const c of b.cells) g.set(c.x, c.y, T.GATE, true);
      const ok = carveConnector(g, b.outExit, maxLen) && carveConnector(g, b.inExit, maxLen);
      const run = ok ? g.maxRunIn(b.area) : Infinity;
      g.restore(snap);
      if (run < bestRun) {
        bestRun = run;
        best = pos;
      }
      if (run <= maxRun) break;
    }
    if (best >= 0 && bestRun < Infinity) {
      const b = build(best);
      for (const c of b.cells) g.set(c.x, c.y, T.GATE, true);
      carveConnector(g, b.outExit, maxLen);
      carveConnector(g, b.inExit, maxLen);
      pois.push({ type: 'restricted_gate', x: b.mid.x, y: b.mid.y });
    } else {
      // Прямой проход не получается — ставим ворота с «фартуком» в 1 клетку,
      // дальше их соединит проверка связности тоннелем с изломами.
      const b = build(positions[0]);
      for (const c of b.cells) g.set(c.x, c.y, T.GATE, true);
      for (const ex of [b.outExit, b.inExit]) {
        for (const tl of ex.tiles) g.set(tl.x + ex.dx, tl.y + ex.dy, T.FLOOR);
      }
      pois.push({ type: 'restricted_gate', x: b.mid.x, y: b.mid.y });
    }
    placed++;
  }
  return placed;
}

/**
 * Магазин ГСР: комната 6×4 в застройке недалеко от площади, дверь 2 тайла в переулок.
 * Возвращает false, если места не нашлось.
 */
export function stampShop(g: GenGrid, rng: Rng, cx: number, cy: number, zone: number, pois: Poi[]): boolean {
  const iw = 6;
  const ih = 4;
  const W = iw + 2;
  const H = ih + 2;
  for (let tries = 0; tries < 3000; tries++) {
    const r = rng.int(10, 45);
    const a = rng.range(0, Math.PI * 2);
    const x0 = Math.round(cx + Math.cos(a) * r) - (W >> 1);
    const y0 = Math.round(cy + Math.sin(a) * r) - (H >> 1);
    const rect: Rect = { x: x0, y: y0, w: W, h: H };
    if (!g.isSolidFree(rect)) continue;
    // Стороны: где снаружи двух соседних клеток стены — проходимо.
    const doors: { tiles: { x: number; y: number }[]; far: { x: number; y: number } }[] = [];
    for (let k = 1; k < W - 2; k++) {
      const top = [{ x: x0 + k, y: y0 }, { x: x0 + k + 1, y: y0 }];
      if (top.every((t) => g.passable(t.x, t.y - 1))) doors.push({ tiles: top, far: { x: x0 + (W >> 1), y: y0 + H - 2 } });
      const bot = [{ x: x0 + k, y: y0 + H - 1 }, { x: x0 + k + 1, y: y0 + H - 1 }];
      if (bot.every((t) => g.passable(t.x, t.y + 1))) doors.push({ tiles: bot, far: { x: x0 + (W >> 1), y: y0 + 1 } });
    }
    for (let k = 1; k < H - 2; k++) {
      const left = [{ x: x0, y: y0 + k }, { x: x0, y: y0 + k + 1 }];
      if (left.every((t) => g.passable(t.x - 1, t.y))) doors.push({ tiles: left, far: { x: x0 + W - 2, y: y0 + (H >> 1) } });
      const right = [{ x: x0 + W - 1, y: y0 + k }, { x: x0 + W - 1, y: y0 + k + 1 }];
      if (right.every((t) => g.passable(t.x + 1, t.y))) doors.push({ tiles: right, far: { x: x0 + 1, y: y0 + (H >> 1) } });
    }
    if (doors.length === 0) continue;
    const door = rng.pick(doors);
    g.fillRect({ x: x0 + 1, y: y0 + 1, w: iw, h: ih }, T.INTERIOR);
    for (const t of door.tiles) g.set(t.x, t.y, T.DOOR);
    g.setZoneRect(rect, zone);
    g.lockRect(rect);
    pois.push({ type: 'shop_counter', x: door.far.x, y: door.far.y });
    return true;
  }
  return false;
}
