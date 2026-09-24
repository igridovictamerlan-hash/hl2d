import type { Rng } from '../../core/rng';
import type { Rect } from '../../core/math';
import { GENERATOR } from '../../config/generator';
import { T, SOLID, type TileId } from '../tiles';
import type { Poi } from '../GameMap';
import type { GenGrid } from './GenGrid';

/**
 * Детали застройки поверх лабиринта: дворы-колодцы, сквозные подъезды и арки,
 * тупиковые отростки, заводские дворы, чистка «шипов» стен.
 */

const DIRS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
] as const;

type Dir = (typeof DIRS)[number];

/** Полоса шириной w, идущая в направлении d от (x, y); o — смещение поперёк. */
const stripTile = (x: number, y: number, d: Dir, s: number, o: number) => ({
  x: x + d.dx * s + Math.abs(d.dy) * o,
  y: y + d.dy * s + Math.abs(d.dx) * o,
});

/**
 * Длина тоннеля сквозь стену: шаги 0..L-1 — незаблокированная стена с глухими боками,
 * шаг L — целиком проходим. -1, если так не получается.
 */
function tunnelLength(g: GenGrid, x: number, y: number, d: Dir, w: number, maxLen: number): number {
  for (let s = 0; s <= maxLen; s++) {
    let all = true;
    let any = false;
    for (let o = 0; o < w; o++) {
      const t = stripTile(x, y, d, s, o);
      if (!g.inside(t.x, t.y)) return -1;
      if (g.passable(t.x, t.y)) any = true;
      else {
        all = false;
        if (g.isLocked(t.x, t.y)) return -1;
      }
    }
    if (all) return s >= 1 ? s : -1;
    if (any) return -1;
    // Бока тоннеля должны быть стеной — иначе это не проход сквозь дом.
    const l = stripTile(x, y, d, s, -1);
    const r = stripTile(x, y, d, s, w);
    if (g.passable(l.x, l.y) || g.passable(r.x, r.y)) return -1;
  }
  return -1;
}

/** Арка (открытый проход) или подъезд (коридор с дверями на концах). */
function carvePassage(g: GenGrid, x: number, y: number, d: Dir, w: number, len: number, arch: boolean): void {
  for (let s = 0; s < len; s++) {
    const end = s === 0 || s === len - 1;
    const t: TileId = arch || len < 3 ? T.ARCH : end ? T.DOOR : T.INTERIOR;
    for (let o = 0; o < w; o++) {
      const p = stripTile(x, y, d, s, o);
      g.set(p.x, p.y, t);
    }
  }
}

/** Ограниченный BFS по проходимым клеткам: достижима ли цель за maxSteps шагов. */
class LocalBfs {
  private mark: Uint32Array;
  private gen = 0;
  private queue: Int32Array;

  constructor(private g: GenGrid) {
    this.mark = new Uint32Array(g.w * g.h);
    this.queue = new Int32Array(g.w * g.h);
  }

  reachable(sx: number, sy: number, tx: number, ty: number, maxSteps: number): boolean {
    const g = this.g;
    this.gen++;
    const target = ty * g.w + tx;
    let head = 0;
    let tail = 0;
    const start = sy * g.w + sx;
    this.mark[start] = this.gen;
    this.queue[tail++] = start;
    let depthEnd = tail;
    let depth = 0;
    while (head < tail) {
      if (head === depthEnd) {
        depth++;
        if (depth > maxSteps) return false;
        depthEnd = tail;
      }
      const i = this.queue[head++];
      if (i === target) return true;
      const x = i % g.w;
      const y = (i - x) / g.w;
      const ns = [i - 1, i + 1, i - g.w, i + g.w];
      const ok = [x > 0, x < g.w - 1, y > 0, y < g.h - 1];
      for (let k = 0; k < 4; k++) {
        const n = ns[k];
        if (!ok[k] || this.mark[n] === this.gen || SOLID[g.tiles[n]] === 1) continue;
        this.mark[n] = this.gen;
        this.queue[tail++] = n;
      }
    }
    return false;
  }
}

/** Случайная стена на краю переулка: возвращает клетку стены и направление вглубь дома. */
function randomAlleyEdge(
  g: GenGrid,
  rng: Rng,
  allowed: (x: number, y: number) => boolean,
): { x: number; y: number; d: Dir } | null {
  for (let tries = 0; tries < 60; tries++) {
    const x = rng.int(g.border, g.w - g.border - 1);
    const y = rng.int(g.border, g.h - g.border - 1);
    if (g.passable(x, y) || g.isLocked(x, y) || !allowed(x, y)) continue;
    const d = rng.pick(DIRS);
    const bx = x - d.dx;
    const by = y - d.dy;
    if (g.get(bx, by) === T.FLOOR) return { x, y, d };
  }
  return null;
}

export interface FeatureStats {
  courtyards: number;
  passages: number;
  arches: number;
  stubs: number;
  yards: number;
}

export function addFeatures(
  g: GenGrid,
  rng: Rng,
  opts: {
    isResidential: (x: number, y: number) => boolean;
    isIndustrial: (x: number, y: number) => boolean;
    pois: Poi[];
  },
): FeatureStats {
  const C = GENERATOR;
  const stats: FeatureStats = { courtyards: 0, passages: 0, arches: 0, stubs: 0, yards: 0 };
  const bfs = new LocalBfs(g);

  const maxRun = C.alley.maxStraight;
  /** Вырезает деталь; если через неё открылся слишком длинный прямой обзор — откатывает. */
  const tryCarve = (area: Rect, carve: () => void): boolean => {
    const snap = g.snapshot(area);
    carve();
    if (g.maxRunIn(area) <= maxRun) return true;
    g.restore(snap);
    return false;
  };
  const stripRect = (x: number, y: number, d: Dir, len: number, w: number): Rect => {
    const a = stripTile(x, y, d, 0, 0);
    const b = stripTile(x, y, d, len - 1, w - 1);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x) + 1, h: Math.abs(b.y - a.y) + 1 };
  };
  const passage = (x: number, y: number, d: Dir, len: number, arch: boolean): boolean => {
    if (!tryCarve(stripRect(x, y, d, len, 2), () => carvePassage(g, x, y, d, 2, len, arch))) return false;
    if (arch || len < 3) stats.arches++;
    else stats.passages++;
    return true;
  };

  // 1. Заводские дворы — открытые площадки, примыкающие к проезду.
  const yardTarget = rng.int(C.industrial.yards[0], C.industrial.yards[1]);
  for (let tries = 0; tries < 400 && stats.yards < yardTarget; tries++) {
    const e = randomAlleyEdge(g, rng, opts.isIndustrial);
    if (!e) continue;
    const depth = rng.int(C.industrial.yardSize[0], C.industrial.yardSize[1]);
    const width = rng.int(C.industrial.yardSize[0], C.industrial.yardSize[1]);
    const shift = rng.int(0, width - 3);
    const p0 = stripTile(e.x, e.y, e.d, 0, -shift);
    const p1 = stripTile(e.x, e.y, e.d, depth - 1, width - 1 - shift);
    const r: Rect = { x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), w: Math.abs(p1.x - p0.x) + 1, h: Math.abs(p1.y - p0.y) + 1 };
    if (!g.isSolidFree(r)) continue;
    // Открыта только сторона, откуда пришли; вокруг остальных — минимум 2 тайла глухой стены.
    let ok = true;
    for (let y = r.y - 2; y < r.y + r.h + 2 && ok; y++) {
      for (let x = r.x - 2; x < r.x + r.w + 2; x++) {
        if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) continue;
        const behind = e.d.dx !== 0 ? (e.d.dx > 0 ? x < r.x : x >= r.x + r.w) : e.d.dy > 0 ? y < r.y : y >= r.y + r.h;
        if (!behind && g.passable(x, y)) {
          ok = false;
          break;
        }
      }
    }
    if (!ok || !tryCarve(r, () => g.fillRect(r, T.FLOOR))) continue;
    opts.pois.push({ type: 'industrial_yard', x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });
    stats.yards++;
  }

  // 2. Дворы-колодцы: замкнутый двор внутри квартала, вход через арку или подъезд.
  const cc = C.courtyards;
  for (let tries = 0; tries < 1500 && stats.courtyards < cc.count; tries++) {
    const cw = rng.int(cc.size[0], cc.size[1]);
    const ch = rng.int(cc.size[0], cc.size[1]);
    const x = rng.int(g.border + cc.margin, g.w - g.border - cc.margin - cw);
    const y = rng.int(g.border + cc.margin, g.h - g.border - cc.margin - ch);
    if (!opts.isResidential(x + (cw >> 1), y + (ch >> 1))) continue;
    const r: Rect = { x, y, w: cw, h: ch };
    if (!g.isSolidFree({ x: x - cc.margin, y: y - cc.margin, w: cw + cc.margin * 2, h: ch + cc.margin * 2 })) continue;
    g.fillRect(r, T.COURTYARD);
    // Кандидаты входов со всех сторон, от коротких к длинным.
    const links: { x: number; y: number; d: Dir; len: number }[] = [];
    for (const d of DIRS) {
      const along = d.dx !== 0 ? ch : cw;
      for (let k = 0; k < 3; k++) {
        const o = rng.int(0, along - 2);
        const sx = d.dx > 0 ? x + cw : d.dx < 0 ? x - 1 : x + o;
        const sy = d.dy > 0 ? y + ch : d.dy < 0 ? y - 1 : y + o;
        const len = tunnelLength(g, sx, sy, d, 2, cc.maxLink);
        if (len > 0) links.push({ x: sx, y: sy, d, len });
      }
    }
    links.sort((a, b) => a.len - b.len);
    const first = links.find((l) => passage(l.x, l.y, l.d, l.len, rng.chance(0.6)));
    if (!first) {
      g.fillRect(r, T.WALL);
      continue;
    }
    if (rng.chance(cc.secondLinkChance)) {
      links.find(
        (l) =>
          l.d !== first.d &&
          tunnelLength(g, l.x, l.y, l.d, 2, cc.maxLink) === l.len &&
          passage(l.x, l.y, l.d, l.len, rng.chance(0.5)),
      );
    }
    stats.courtyards++;
  }

  // 3. Сквозные подъезды и арки между переулками — срезки, где обход длинный.
  const pc = C.passages;
  let made = 0;
  for (let tries = 0; tries < 3000 && made < pc.count; tries++) {
    const e = randomAlleyEdge(g, rng, (px, py) => opts.isResidential(px, py) || opts.isIndustrial(px, py));
    if (!e) continue;
    const back2 = stripTile(e.x, e.y, e.d, -1, 1);
    if (g.get(back2.x, back2.y) !== T.FLOOR) continue;
    const len = tunnelLength(g, e.x, e.y, e.d, 2, pc.maxLength);
    if (len < 2) continue;
    const from = stripTile(e.x, e.y, e.d, -1, 0);
    const to = stripTile(e.x, e.y, e.d, len, 0);
    if (bfs.reachable(from.x, from.y, to.x, to.y, pc.minDetour)) continue;
    if (passage(e.x, e.y, e.d, len, rng.chance(pc.archChance))) made++;
  }

  // 4. Тупиковые отростки.
  const de = C.deadEnds;
  for (let tries = 0; tries < 2000 && stats.stubs < de.count; tries++) {
    const e = randomAlleyEdge(g, rng, (px, py) => opts.isResidential(px, py) || opts.isIndustrial(px, py));
    if (!e) continue;
    const back2 = stripTile(e.x, e.y, e.d, -1, 1);
    if (g.get(back2.x, back2.y) !== T.FLOOR) continue;
    const len = rng.int(de.length[0], de.length[1]);
    const a = stripTile(e.x, e.y, e.d, 0, -1);
    const b = stripTile(e.x, e.y, e.d, len, 2);
    const box: Rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x) + 1, h: Math.abs(b.y - a.y) + 1 };
    if (!g.isSolidFree(box)) continue;
    const stub = stripRect(e.x, e.y, e.d, len, 2);
    if (tryCarve(stub, () => g.fillRect(stub, T.FLOOR))) stats.stubs++;
  }

  return stats;
}

/**
 * Убирает одиночные «шипы» стен, оставшиеся от наложения изломов (≥3 соседа — переулок/асфальт).
 * Сначала помечает, потом удаляет — иначе удаление каскадом «съедает» тонкую стену целиком
 * и сливает параллельные переулки. Вызывается сразу после вырезания лабиринта.
 */
export function removeWallSpikes(g: GenGrid): number {
  const marks: { x: number; y: number; t: TileId }[] = [];
  for (let y = g.border; y < g.h - g.border; y++) {
    for (let x = g.border; x < g.w - g.border; x++) {
      if (g.passable(x, y) || g.isLocked(x, y)) continue;
      let n = 0;
      let street = 0;
      for (const d of DIRS) {
        const t = g.get(x + d.dx, y + d.dy);
        if (t === T.FLOOR) n++;
        else if (t === T.STREET) {
          n++;
          street++;
        }
      }
      if (n >= 3) marks.push({ x, y, t: street >= 2 ? T.STREET : T.FLOOR });
    }
  }
  for (const m of marks) g.set(m.x, m.y, m.t);
  return marks.length;
}
