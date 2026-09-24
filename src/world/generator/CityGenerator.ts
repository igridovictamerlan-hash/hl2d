import { Rng, hash2 } from '../../core/rng';
import type { Rect } from '../../core/math';
import { GENERATOR } from '../../config/generator';
import { WORLD } from '../../config/world';
import { QUARTER_NAMES, ZONE_NAMES } from '../../config/names';
import { T } from '../tiles';
import { GameMap, type Poi, type Zone, type ZoneKind } from '../GameMap';
import { ensureConnectivity } from '../connectivity';
import { buildingRatio, longestAlleyRun, type MapStats } from '../mapStats';
import { GenGrid } from './GenGrid';
import { planLayout, avenueOffsetAt, avenueRects } from './layout';
import { Lattice, assignRegions, growMaze, addLoops, finalizeEdges, carveLattice } from './lattice';
import { stampPlaza, stampTemplate, stampRestricted, carveConnector, carveConnectorChecked } from './stamps';
import { NEXUS_TEMPLATE, CHECKPOINT_TEMPLATE, rotateTemplate, mirrorTemplate } from './templates';
import { addFeatures, removeWallSpikes } from './features';

/**
 * Генератор переулочного города. Порядок шагов:
 *  1. План: магистрали, линии решётки, углы запретной зоны и промзоны, площадь, Нексус.
 *  2. Решётка с дрожанием → лабиринт «растущее дерево» от магистралей + петли.
 *  3. Вырезание переулков (Z-изломы), магистралей, чистка «шипов».
 *  4. Зоны, штампы (площадь, Нексус, кольцо запретной зоны), выходы из штампов.
 *  5. Дворы-колодцы, подъезды/арки, тупики, заводские дворы.
 *  6. Связность (flood fill по якорям 2×2 + тоннели), метрики, проверка.
 * Результат детерминирован по seed.
 */
/** Печать причин неудачных попыток (для тестов): globalThis.__HL2D_DEBUG_GEN = true. */
const DEBUG_GEN = (globalThis as { __HL2D_DEBUG_GEN?: boolean }).__HL2D_DEBUG_GEN === true;

export function generateCity(seed: number): GameMap {
  const attempts = GENERATOR.validation.attempts;
  const maxRun = GENERATOR.alley.maxStraight;
  let best: GameMap | null = null;
  let bestScore = Infinity;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const map = generateAttempt(seed, attempt);
      const problems = validateMap(map);
      const excess = Math.max(0, map.stats!.longestAlleyRun - maxRun);
      if (problems.length === 0 && excess === 0) return map;
      if (DEBUG_GEN) console.warn(`seed ${seed} попытка ${attempt}:`, [...problems, `прямая ${map.stats!.longestAlleyRun}`].join('; '));
      // Лучшая из неидеальных: сначала жёсткие требования, потом длина прямой.
      const score = problems.length * 1000 + excess;
      if (score < bestScore) {
        bestScore = score;
        best = map;
      }
    } catch (e) {
      lastError = e;
      if (DEBUG_GEN) console.warn(`seed ${seed} попытка ${attempt}:`, (e as Error).message);
    }
  }
  if (best) return best;
  throw lastError ?? new Error('Не удалось сгенерировать карту');
}

/** Список нарушений требований к карте (пустой — всё хорошо). */
export function validateMap(map: GameMap): string[] {
  const s = map.stats;
  const out: string[] = [];
  if (!s) return ['нет статистики'];
  if (s.components !== 1) out.push(`компонент связности: ${s.components}`);
  const [lo, hi] = GENERATOR.validation.buildingRatio;
  if (s.buildingRatio < lo || s.buildingRatio > hi) out.push(`доля зданий ${(s.buildingRatio * 100).toFixed(1)}%`);
  const need: [Poi['type'], number][] = [
    ['ration_window', 1], ['plaza_center', 1], ['nexus_gate', 1], ['nexus_desk', 1], ['cell', 4], ['restricted_gate', 1],
    ['checkpoint_post', 4], ['outlands_exit', 2],
  ];
  for (const [type, n] of need) if (map.poisOf(type).length < n) out.push(`нет точки ${type}`);
  return out;
}

const shrink = (r: Rect, d: number): Rect => ({ x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d });

function generateAttempt(seed: number, attempt: number): GameMap {
  const t0 = performance.now();
  const G = GENERATOR;
  const W = WORLD.widthTiles;
  const H = WORLD.heightTiles;
  const rng = new Rng(hash2(seed, attempt, 0x5eed));
  const g = new GenGrid(W, H, G.border);
  const pois: Poi[] = [];

  // 1. План.
  const layout = planLayout(rng.fork(1), W, H);

  // 2. Решётка и лабиринт.
  const lat = Lattice.build(rng.fork(2), layout.xs, layout.ys);
  for (const n of lat.nodes) {
    if (n.j === layout.hLine) {
      n.y = avenueOffsetAt(layout.hAvenue, n.x + 1) + 2;
      n.onAvenue = true;
    }
    if (layout.vAvenue && n.i === layout.vLine) {
      n.x = avenueOffsetAt(layout.vAvenue, n.y + 1) + 2;
      n.onAvenue = true;
    }
  }
  const restrictedInner = shrink(layout.restricted, G.restricted.wallThickness + 1);
  assignRegions(lat, {
    restricted: layout.restricted,
    restrictedInner,
    voids: [layout.nexus, ...layout.checkpoints.map((c) => c.rect)],
    industrial: layout.industrial,
  });
  const starts: number[] = [];
  lat.nodes.forEach((n, k) => n.onAvenue && starts.push(k));
  const gate = layout.restrictedGates[0];
  if (gate) {
    const gx = gate.side === 'N' || gate.side === 'S' ? gate.pos : layout.restricted.x + layout.restricted.w / 2;
    const gy = gate.side === 'E' || gate.side === 'W' ? gate.pos : layout.restricted.y + layout.restricted.h / 2;
    let best = -1;
    let bestD = Infinity;
    lat.nodes.forEach((n, k) => {
      if (n.region !== 'restricted') return;
      const d = Math.hypot(n.x - gx, n.y - gy);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    if (best >= 0) starts.push(best);
  }
  growMaze(lat, rng.fork(3), starts);
  addLoops(lat, rng.fork(4));
  finalizeEdges(lat, rng.fork(5));

  // 3. Вырезание.
  const carve = carveLattice(g, lat);
  const avenues = [layout.hAvenue, ...(layout.vAvenue ? [layout.vAvenue] : [])];
  for (const av of avenues) for (const r of avenueRects(av)) g.fillRect(r, T.STREET);
  removeWallSpikes(g);

  // 4. Зоны.
  const zones: Zone[] = [];
  const addZone = (kind: ZoneKind, name: string, char: string): number => {
    zones.push({ id: zones.length, kind, name, char });
    return zones.length - 1;
  };
  const names = rng.fork(7).shuffle([...QUARTER_NAMES]);
  const quarterZones = layout.quarterSeeds.map((_, k) =>
    addZone('residential', names[k % names.length], String.fromCharCode(97 + k)),
  );
  const zHAv = addZone('avenue', ZONE_NAMES.avenue[0], 'A');
  const zVAv = layout.vAvenue ? addZone('avenue', ZONE_NAMES.avenue[1], 'B') : zHAv;
  const zPlaza = addZone('plaza', ZONE_NAMES.plaza, 'P');
  const zNexus = addZone('nexus', ZONE_NAMES.nexus, 'N');
  const zCells = addZone('cells', ZONE_NAMES.cells, 'K');
  const zInd = addZone('industrial', ZONE_NAMES.industrial, 'I');
  const zRes = addZone('restricted', ZONE_NAMES.restricted, 'R');
  const zCheckpoints = layout.checkpoints.map((_, k) => addZone('checkpoint', ZONE_NAMES.checkpoints[k], k === 0 ? 'W' : 'E'));
  const zOut = addZone('outlands', ZONE_NAMES.outlands, 'O');

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let best = 0;
      let bestD = Infinity;
      layout.quarterSeeds.forEach((s, k) => {
        const d = (s.x - x) ** 2 + (s.y - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      });
      g.zones[y * W + x] = quarterZones[best];
    }
  }
  g.setZoneRect(layout.industrial, zInd);
  g.setZoneRect(layout.restricted, zRes);
  const hRects = avenueRects(layout.hAvenue);
  for (let i = 0; i < W * H; i++) {
    if (g.tiles[i] !== T.STREET) continue;
    const x = i % W;
    const y = (i - x) / W;
    const inH = hRects.some((r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h);
    g.zones[i] = inH ? zHAv : zVAv;
  }

  // Штампы.
  stampPlaza(g, layout.plaza, layout.plazaSide, zPlaza, pois);

  const nexusRows = rotateTemplate(NEXUS_TEMPLATE, layout.nexusRot);
  const nexus = stampTemplate(g, nexusRows, layout.nexus.x, layout.nexus.y, (ch) => (ch === 'c' || ch === 'D' ? zCells : zNexus), pois);
  for (const exit of nexus.exits) {
    const isGate = exit.tiles.some((t) => g.get(t.x, t.y) === T.GATE);
    if (carveConnectorChecked(g, exit, G.connectorMax)) {
      if (isGate) {
        const mid = exit.tiles[Math.floor(exit.tiles.length / 2)];
        pois.push({ type: 'nexus_gate', x: mid.x, y: mid.y });
      }
    } else {
      for (const t of exit.tiles) g.set(t.x, t.y, T.METAL, true);
    }
  }
  for (const c of nexus.cells) pois.push({ type: 'cell', x: c.x + (c.w >> 1), y: c.y + (c.h >> 1) });
  let yx0 = Infinity, yy0 = Infinity, yx1 = -Infinity, yy1 = -Infinity;
  for (let y = 0; y < nexusRows.length; y++) {
    for (let x = 0; x < nexusRows[0].length; x++) {
      if (nexusRows[y][x] !== ':') continue;
      yx0 = Math.min(yx0, x); yy0 = Math.min(yy0, y); yx1 = Math.max(yx1, x); yy1 = Math.max(yy1, y);
    }
  }
  pois.push({ type: 'nexus_yard', x: layout.nexus.x + ((yx0 + yx1) >> 1), y: layout.nexus.y + ((yy0 + yy1) >> 1) });

  stampRestricted(g, layout.restricted, layout.restrictedGates, rng.fork(8), pois);

  // Пограничные КПП. Выход только один — в сторону города (к проспекту).
  layout.checkpoints.forEach((cp, k) => {
    const rows = cp.mirror ? mirrorTemplate(CHECKPOINT_TEMPLATE) : [...CHECKPOINT_TEMPLATE];
    const res = stampTemplate(g, rows, cp.rect.x, cp.rect.y, (ch) => (ch === 'o' ? zOut : zCheckpoints[k]), pois);
    const cityDx = cp.mirror ? -1 : 1;
    for (const exit of res.exits) {
      if (exit.dx !== cityDx) continue;
      if (!carveConnectorChecked(g, exit, G.connectorMax)) carveConnector(g, exit, G.connectorMax);
    }
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[0].length; x++) if (rows[y][x] === 'o') { sx += x; sy += y; n++; }
    pois.push({ type: 'outlands_exit', x: cp.rect.x + Math.round(sx / n), y: cp.rect.y + Math.round(sy / n) });
  });

  // 5. Детали застройки.
  const zoneKindAt = (x: number, y: number) => zones[g.zones[y * W + x]]?.kind;
  const feat = addFeatures(g, rng.fork(6), {
    isResidential: (x, y) => zoneKindAt(x, y) === 'residential',
    isIndustrial: (x, y) => g.zones[y * W + x] === zInd,
    pois,
  });

  // 6. Связность.
  const center = pois.find((p) => p.type === 'plaza_center')!;
  const conn = ensureConnectivity(g, center.x, center.y, G.connectivity);

  const stats: MapStats = {
    seed,
    attempt,
    genMs: Math.round(performance.now() - t0),
    widthTiles: W,
    heightTiles: H,
    buildingRatio: buildingRatio(g.tiles),
    walkableTiles: g.countPassable(),
    longestAlleyRun: longestAlleyRun(g.tiles, W, H),
    avenues: avenues.length,
    deadEnds: carve.deadEnds + feat.stubs,
    chokepoints: carve.narrow,
    courtyards: feat.courtyards,
    passages: feat.passages,
    arches: feat.arches,
    stubs: feat.stubs,
    industrialYards: feat.yards,
    initialComponents: conn.initialComponents,
    tunnels: conn.tunnels,
    fragmentsFilled: conn.fragmentsFilled,
    unreachableRemoved: conn.unreachableRemoved,
    components: conn.finalComponents,
  };

  return new GameMap(W, H, WORLD.tileSize, g.tiles, g.zones, zones, pois, seed, `Сити-17 · seed ${seed}`, stats);
}
