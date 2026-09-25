import type { GameMap } from './GameMap';
import { SOLID, T } from './tiles';
import { buildAnchorWalk, labelComponents, findUnreachableTiles } from './connectivity';

/** Метрики сгенерированной карты — показываются в панели карты и проверяются тестами. */
export interface MapStats {
  seed: number;
  attempt: number;
  genMs: number;
  widthTiles: number;
  heightTiles: number;
  /** Доля непроходимых тайлов (здания и стены). */
  buildingRatio: number;
  walkableTiles: number;
  /** Самый длинный прямой участок переулка, в тайлах. */
  longestAlleyRun: number;
  avenues: number;
  deadEnds: number;
  /** Узкие (2 тайла) рёбра лабиринта. */
  chokepoints: number;
  courtyards: number;
  passages: number;
  arches: number;
  stubs: number;
  industrialYards: number;
  initialComponents: number;
  tunnels: number;
  fragmentsFilled: number;
  unreachableRemoved: number;
  components: number;
}

/** Тайлы, из которых состоит «переулок» для измерения прямых участков. */
export const ALLEY = new Uint8Array(256);
for (const t of [T.FLOOR, T.ARCH, T.DOOR, T.GATE, T.COURTYARD]) ALLEY[t] = 1;

/** Самая длинная непрерывная прямая (по строке или столбцу) из тайлов переулка. */
export function longestAlleyRun(tiles: Uint8Array, w: number, h: number): number {
  let best = 0;
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      run = ALLEY[tiles[y * w + x]] ? run + 1 : 0;
      if (run > best) best = run;
    }
  }
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y < h; y++) {
      run = ALLEY[tiles[y * w + x]] ? run + 1 : 0;
      if (run > best) best = run;
    }
  }
  return best;
}

export function buildingRatio(tiles: Uint8Array): number {
  let solid = 0;
  for (let i = 0; i < tiles.length; i++) solid += SOLID[tiles[i]];
  return solid / tiles.length;
}

/** Проверка любой карты (в т.ч. загруженной и поправленной руками). */
export interface MapCheck {
  buildingRatio: number;
  longestAlleyRun: number;
  /** Компоненты связности по якорям 2×2 (должна быть 1). */
  components: number;
  /** Проходимые тайлы, куда персонаж не может попасть. */
  unreachableTiles: number;
}

/**
 * links — пары якорей (ax, ay), связанных люками: компоненты по обе стороны люка считаются одной
 * (город и канализация — одна карта, если все люки ведут куда надо).
 */
export function analyzeMap(tiles: Uint8Array, w: number, h: number, links: readonly [number, number, number, number][] = []): MapCheck {
  const walk = buildAnchorWalk(tiles, w, h);
  const aw = w - 1;
  const { labels, sizes } = labelComponents(walk, aw, h - 1);
  // Объединение компонент через люки (система непересекающихся множеств).
  const parent = sizes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const [ax, ay, bx, by] of links) {
    const a = labels[ay * aw + ax];
    const b = labels[by * aw + bx];
    if (a >= 0 && b >= 0) parent[find(a)] = find(b);
  }
  const total = new Map<number, number>();
  sizes.forEach((n, i) => total.set(find(i), (total.get(find(i)) ?? 0) + n));
  let mainRoot = -1;
  for (const [r, n] of total) if (mainRoot < 0 || n > total.get(mainRoot)!) mainRoot = r;
  // Главная компонента после объединения: все её части получают метку mainRoot, остальные — «чужие».
  if (mainRoot >= 0) for (let i = 0; i < labels.length; i++) if (labels[i] >= 0) labels[i] = find(labels[i]) === mainRoot ? mainRoot : -2;
  return {
    buildingRatio: buildingRatio(tiles),
    longestAlleyRun: longestAlleyRun(tiles, w, h),
    components: total.size,
    unreachableTiles: mainRoot < 0 ? 0 : findUnreachableTiles(tiles, w, h, labels, mainRoot).length,
  };
}

/** Связи люков карты для analyzeMap. */
export function hatchLinks(map: GameMap): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const p of map.pois) {
    if (p.type !== 'hatch') continue;
    const q = map.pois.find((o) => o.type === 'sewer_hatch' && o.id === p.id);
    if (q) out.push([p.x, p.y, q.x, q.y]);
  }
  return out;
}
