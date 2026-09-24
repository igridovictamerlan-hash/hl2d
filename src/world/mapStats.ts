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

export function analyzeMap(tiles: Uint8Array, w: number, h: number): MapCheck {
  const walk = buildAnchorWalk(tiles, w, h);
  const { labels, sizes } = labelComponents(walk, w - 1, h - 1);
  const main = sizes.length ? sizes.indexOf(Math.max(...sizes)) : -1;
  return {
    buildingRatio: buildingRatio(tiles),
    longestAlleyRun: longestAlleyRun(tiles, w, h),
    components: sizes.length,
    unreachableTiles: main < 0 ? 0 : findUnreachableTiles(tiles, w, h, labels, main).length,
  };
}
