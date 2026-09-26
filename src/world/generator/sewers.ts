import { Rng, hash2 } from '../../core/rng';
import { GENERATOR } from '../../config/generator';
import { WORLD } from '../../config/world';
import { ZONE_NAMES } from '../../config/names';
import { T, SOLID } from '../tiles';
import { GameMap, type Poi, type Zone, type Rect } from '../GameMap';
import { buildAnchorWalk, labelComponents } from '../connectivity';

/**
 * Канализация — отдельная область той же сетки справа от города (зазор WORLD.underground.gap).
 * Город отображается в неё в масштабе scale: люк в западном квартале ведёт на запад канализации.
 *  1. Люки в городе: переулки жилых кварталов и промзоны, разнесённые друг от друга.
 *  2. Сеть тоннелей: решётка узлов → «растущее дерево» + петли; тоннель 3 тайла — сток посередине,
 *     дорожки по бокам; узлы — площадки 3×3.
 *  3. От каждого люка (в масштабе) — боковой ход к ближайшему узлу и ниша под лестницу.
 *  4. Убежище сопротивления (ящики-укрытия, тайник) и чёрный рынок с прилавком.
 *  5. Засыпка мест, куда персонаж не пролезает.
 * Всё только добавляет проходимое — сеть связна по построению (проверяется тестом).
 */
export function addSewers(city: GameMap, seed: number): GameMap {
  const S = GENERATOR.sewers;
  const U = WORLD.underground;
  const rng = new Rng(hash2(seed, 0x5e3e, 7));
  const cw = city.width;
  const H = city.height;
  const sw = Math.ceil(cw * U.scale);
  const sh = Math.ceil(H * U.scale);
  const sx0 = cw + U.gap;
  const sy0 = Math.floor((H - sh) / 2);
  const W = sx0 + sw;
  const area: Rect = { x: sx0, y: sy0, w: sw, h: sh };

  // 1. Люки в городе (до копирования сетки: при нужде прорезают в запретной зоне ход к площадке).
  const hatches = pickCityHatches(city, rng, S.hatches, S.hatchSpacing, S.hatchEdge);

  const tiles = new Uint8Array(W * H).fill(T.SEWER_WALL);
  const zoneGrid = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    tiles.set(city.tiles.subarray(y * cw, (y + 1) * cw), y * W);
    zoneGrid.set(city.zoneGrid.subarray(y * cw, (y + 1) * cw), y * W);
  }
  const zones: Zone[] = city.zones.map((z) => ({ ...z }));
  const addZone = (kind: Zone['kind'], name: string, char: string): number => {
    zones.push({ id: zones.length, kind, name, char });
    return zones.length - 1;
  };
  const zSewer = addZone('sewer', ZONE_NAMES.sewer, 'U');
  const zBase = addZone('rebel_base', ZONE_NAMES.rebelBase, 'H');
  const zMarket = addZone('black_market', ZONE_NAMES.blackMarket, 'X');
  for (let y = area.y; y < area.y + area.h; y++) for (let x = area.x; x < area.x + area.w; x++) zoneGrid[y * W + x] = zSewer;
  const pois: Poi[] = city.pois.map((p) => ({ ...p }));

  const inArea = (x: number, y: number) => x >= area.x + 1 && y >= area.y + 1 && x < area.x + area.w - 1 && y < area.y + area.h - 1;
  const at = (x: number, y: number) => tiles[y * W + x];
  const set = (x: number, y: number, t: number, force = false) => {
    if (!inArea(x, y)) return;
    // Сток не затирает дорожки и площадки (пересечения тоннелей — сухие).
    if (!force && t === T.SEWER_WATER && at(x, y) !== T.SEWER_WALL) return;
    tiles[y * W + x] = t;
  };
  const fill = (x0: number, y0: number, w: number, h: number, t: number, force = true) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, t, force);
  };

  // 2. Решётка тоннелей.
  const gx: number[] = [];
  const gy: number[] = [];
  for (let x = area.x + S.margin; x <= area.x + area.w - S.margin - 1; x += S.spacing) gx.push(x);
  for (let y = area.y + S.margin; y <= area.y + area.h - S.margin - 1; y += S.spacing) gy.push(y);
  const nx = gx.length;
  const ny = gy.length;
  const node = (i: number, j: number) => j * nx + i;
  const edges = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const neighbors = (n: number): number[] => {
    const i = n % nx;
    const j = (n - i) / nx;
    const out: number[] = [];
    if (i > 0) out.push(node(i - 1, j));
    if (i < nx - 1) out.push(node(i + 1, j));
    if (j > 0) out.push(node(i, j - 1));
    if (j < ny - 1) out.push(node(i, j + 1));
    return out;
  };
  // «Растущее дерево»: связно по построению.
  const inTree = new Uint8Array(nx * ny);
  const active = [rng.int(0, nx * ny - 1)];
  inTree[active[0]] = 1;
  while (active.length) {
    const k = rng.chance(0.5) ? active.length - 1 : rng.int(0, active.length - 1);
    const n = active[k];
    const free = neighbors(n).filter((m) => !inTree[m]);
    if (!free.length) {
      active.splice(k, 1);
      continue;
    }
    const m = rng.pick(free);
    inTree[m] = 1;
    edges.add(key(n, m));
    active.push(m);
  }
  for (let n = 0; n < nx * ny; n++) for (const m of neighbors(n)) if (m > n && !edges.has(key(n, m)) && rng.chance(S.loopChance)) edges.add(key(n, m));
  const nodeX = (n: number) => gx[n % nx];
  const nodeY = (n: number) => gy[Math.floor(n / nx)];
  for (const e of edges) {
    const [a, b] = e.split('-').map(Number);
    carveTunnel(nodeX(a), nodeY(a), nodeX(b), nodeY(b), true);
  }
  for (let n = 0; n < nx * ny; n++) fill(nodeX(n) - 1, nodeY(n) - 1, 3, 3, T.SEWER);

  /** Тоннель 3 тайла по прямой (горизонталь или вертикаль): сток посередине или сухой пол. */
  function carveTunnel(x0: number, y0: number, x1: number, y1: number, water: boolean): void {
    if (y0 === y1) {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
        set(x, y0 - 1, T.SEWER, true);
        set(x, y0 + 1, T.SEWER, true);
        set(x, y0, water ? T.SEWER_WATER : T.SEWER, !water);
      }
    } else {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        set(x0 - 1, y, T.SEWER, true);
        set(x0 + 1, y, T.SEWER, true);
        set(x0, y, water ? T.SEWER_WATER : T.SEWER, !water);
      }
    }
  }
  /** Сухой ход «буквой Г»: по горизонтали, затем по вертикали. */
  const carveL = (x0: number, y0: number, x1: number, y1: number) => {
    carveTunnel(x0, y0, x1, y0, false);
    carveTunnel(x1, y0, x1, y1, false);
    fill(x1 - 1, y0 - 1, 3, 3, T.SEWER);
  };
  const nearestNode = (x: number, y: number) => {
    let best = 0;
    let bestD = Infinity;
    for (let n = 0; n < nx * ny; n++) {
      const d = Math.abs(nodeX(n) - x) + Math.abs(nodeY(n) - y);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  };

  // 3. Люки в канализации: точка в масштабе, ниша 4×4 и сухой ход к ближайшему узлу.
  const lo = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  hatches.forEach((h, id) => {
    const px = lo(area.x + Math.round((h.x + 1) * U.scale), area.x + 3, area.x + area.w - 4);
    const py = lo(area.y + Math.round((h.y + 1) * U.scale), area.y + 3, area.y + area.h - 4);
    const n = nearestNode(px, py);
    carveL(px, py, nodeX(n), nodeY(n));
    fill(px - 2, py - 2, 4, 4, T.SEWER);
    pois.push({ type: 'hatch', x: h.x, y: h.y, id });
    pois.push({ type: 'sewer_hatch', x: px - 1, y: py - 1, id });
  });

  // 4. Убежище (около центра, со сдвигом) и чёрный рынок рядом с ним.
  const B = S.base;
  const bx = area.x + Math.floor((area.w - B.w) / 2) + rng.int(-6, 6);
  const by = area.y + Math.floor((area.h - B.h) / 2) + rng.int(-6, 6);
  fill(bx, by, B.w, B.h, T.INTERIOR);
  for (let y = by; y < by + B.h; y++) for (let x = bx; x < bx + B.w; x++) zoneGrid[y * W + x] = zBase;
  // Ящики-укрытия: не ближе 3 тайлов к стенам и друг к другу — проходы не перекрывают.
  const crates: Rect[] = [];
  for (let tries = 0; tries < 200 && crates.length < S.crates; tries++) {
    const horiz = rng.chance(0.5);
    const c: Rect = { x: rng.int(bx + 3, bx + B.w - 5), y: rng.int(by + 3, by + B.h - 5), w: horiz ? 2 : 1, h: horiz ? 1 : 2 };
    if (crates.some((o) => c.x < o.x + o.w + 3 && o.x < c.x + c.w + 3 && c.y < o.y + o.h + 3 && o.y < c.y + c.h + 3)) continue;
    crates.push(c);
    fill(c.x, c.y, c.w, c.h, T.BARRIER);
  }
  pois.push({ type: 'rebel_base', x: bx + (B.w >> 1), y: by + (B.h >> 1) });
  pois.push({ type: 'rebel_cache', x: bx + 1, y: by + 1 });
  // Рынок — слева или справа от убежища, общий проход 3 тайла.
  const M = S.market;
  const east = bx + B.w + 1 + M.w < area.x + area.w - 2 && (rng.chance(0.5) || bx - 1 - M.w < area.x + 2);
  const mx = east ? bx + B.w + 1 : bx - 1 - M.w;
  const my = by + Math.floor((B.h - M.h) / 2);
  fill(mx, my, M.w, M.h, T.INTERIOR);
  for (let y = my; y < my + M.h; y++) for (let x = mx; x < mx + M.w; x++) zoneGrid[y * W + x] = zMarket;
  fill(east ? bx + B.w : mx + M.w, my + (M.h >> 1) - 1, 1, 3, T.INTERIOR);
  // Прилавок вдоль дальней от убежища стены; торговец за ним, в конце — проход 2 тайла.
  const farX = east ? mx + M.w - 3 : mx + 2;
  fill(farX, my, 1, M.h - 2, T.BARRIER);
  const traderX = east ? mx + M.w - 2 : mx;
  pois.push({ type: 'trader', x: traderX, y: my + (M.h >> 1) - 1 });
  pois.push({ type: 'black_market', x: east ? farX - 2 : farX + 1, y: my + (M.h >> 1) - 1 });
  // Убежище и рынок связаны с сетью: ход от середины каждой стороны убежища к ближайшему узлу.
  const nb = nearestNode(bx + (B.w >> 1), by - 1);
  carveL(bx + (B.w >> 1), by + 1, nodeX(nb), nodeY(nb));
  const nb2 = nearestNode(bx + (B.w >> 1), by + B.h);
  carveL(bx + (B.w >> 1), by + B.h - 2, nodeX(nb2), nodeY(nb2));
  fill(bx, by, B.w, B.h, T.INTERIOR, true);
  for (const c of crates) fill(c.x, c.y, c.w, c.h, T.BARRIER);

  // 5. Засыпка: проходимые тайлы канализации, куда не встаёт ни один якорь её главной компоненты.
  sealUnreachable(tiles, W, H, area);

  const map = new GameMap(W, H, city.tileSize, tiles, zoneGrid, zones, pois, city.seed, city.name, city.stats);
  return map;
}

/**
 * Люки в городе: якорь 2×2 на полу запретной зоны у края города (не дальше edge тайлов от стены),
 * подальше друг от друга. Ими ходят только партизаны.
 */
function pickCityHatches(city: GameMap, rng: Rng, count: number, spacing: number, edge: number): { x: number; y: number }[] {
  const w = city.width;
  // Прямоугольник самого города (без пустоши вокруг).
  let cx0 = Infinity, cy0 = Infinity, cx1 = -1, cy1 = -1;
  for (let y = 0; y < city.height; y++) {
    for (let x = 0; x < w; x++) {
      const k = city.zoneAtTile(x, y)?.kind;
      if (k === 'wasteland' || k === 'rebel_camp') continue;
      cx0 = Math.min(cx0, x); cy0 = Math.min(cy0, y); cx1 = Math.max(cx1, x); cy1 = Math.max(cy1, y);
    }
  }
  // У края мало переулков — если двух люков не набралось, полоса у края расширяется.
  let out: { x: number; y: number }[] = [];
  for (const band of [edge, edge * 2, edge * 3, Infinity]) {
    out = pickFarthest(hatchCandidates(city, band, cx0, cy0, cx1, cy1), rng, count, spacing);
    if (out.length >= count) break;
  }
  if (out.length >= count) return out;
  // Зона целиком застроена — прорезаем от её проходов ходы к площадкам у края города.
  carveHatchYards(city, cx0, cy0, cx1, cy1, spacing);
  return pickFarthest(hatchCandidates(city, Infinity, cx0, cy0, cx1, cy1), rng, count, spacing);
}

/**
 * Две площадки 3×3 в запретной зоне у края города (вдоль двух сторон, выходящих к краю), каждая —
 * с ходом шириной 2 до проходимой части зоны (поиск в ширину по якорям внутри стен зоны).
 */
function carveHatchYards(city: GameMap, cx0: number, cy0: number, cx1: number, cy1: number, spacing: number): void {
  const w = city.width;
  const tiles = city.tiles as Uint8Array;
  let rx0 = Infinity, ry0 = Infinity, rx1 = -1, ry1 = -1;
  for (let y = 0; y < city.height; y++) {
    for (let x = 0; x < w; x++) {
      if (city.zoneAtTile(x, y)?.kind !== 'restricted') continue;
      rx0 = Math.min(rx0, x); ry0 = Math.min(ry0, y); rx1 = Math.max(rx1, x); ry1 = Math.max(ry1, y);
    }
  }
  if (rx1 < 0) return;
  // Внутри кольца стен зоны (2 тайла).
  const ix0 = rx0 + 2, iy0 = ry0 + 2, ix1 = rx1 - 2, iy1 = ry1 - 2;
  const inside = (x: number, y: number) => x >= ix0 && y >= iy0 && x <= ix1 && y <= iy1;
  const westSide = rx0 - cx0 <= cx1 - rx1;
  const northSide = ry0 - cy0 <= cy1 - ry1;
  const edgeX = westSide ? ix0 + 1 : ix1 - 3;
  const edgeY = northSide ? iy0 + 1 : iy1 - 3;
  const cornerX = westSide ? ix0 + 1 : ix1 - 3;
  const cornerY = northSide ? iy0 + 1 : iy1 - 3;
  const off = Math.max(spacing, 12);
  const clampX = (x: number) => Math.max(ix0, Math.min(ix1 - 2, x));
  const clampY = (y: number) => Math.max(iy0, Math.min(iy1 - 2, y));
  const targets = [
    { x: edgeX, y: clampY(cornerY + (northSide ? off : -off)) },
    { x: clampX(cornerX + (westSide ? off : -off)), y: edgeY },
  ];
  const walk = (x: number, y: number) => {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) if (SOLID[tiles[(y + dy) * w + x + dx]]) return false;
    return true;
  };
  for (const t of targets) {
    // Поиск в ширину от площадки к ближайшему проходимому якорю зоны (или прохода к ней).
    const key = (x: number, y: number) => y * w + x;
    const prev = new Map<number, number>();
    const q: number[] = [key(t.x, t.y)];
    prev.set(q[0], -1);
    let hit = -1;
    for (let qi = 0; qi < q.length && hit < 0; qi++) {
      const k = q[qi];
      const x = k % w;
      const y = (k - x) / w;
      if (k !== q[0] && walk(x, y)) {
        hit = k;
        break;
      }
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const nk = key(nx, ny);
        if (prev.has(nk)) continue;
        // Ход — внутри стен зоны; выйти можно только на уже проходимый якорь (проход к воротам).
        if (!inside(nx, ny) || !inside(nx + 1, ny + 1)) {
          if (!walk(nx, ny)) continue;
        }
        prev.set(nk, k);
        q.push(nk);
      }
    }
    if (hit < 0) continue;
    for (let k = prev.get(hit)!; k >= 0; k = prev.get(k)!) {
      const x = k % w;
      const y = (k - x) / w;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) if (SOLID[tiles[(y + dy) * w + x + dx]]) tiles[(y + dy) * w + x + dx] = T.FLOOR;
    }
    for (let dy = -1; dy < 3; dy++) for (let dx = -1; dx < 3; dx++) {
      const x = t.x + dx;
      const y = t.y + dy;
      if (inside(x, y) && SOLID[tiles[y * w + x]]) tiles[y * w + x] = T.FLOOR;
    }
  }
}

function hatchCandidates(city: GameMap, edge: number, cx0: number, cy0: number, cx1: number, cy1: number): { x: number; y: number }[] {
  const w = city.width;
  const cand: { x: number; y: number }[] = [];
  for (let y = 3; y < city.height - 4; y++) {
    for (let x = 3; x < w - 4; x++) {
      // Пол под открытым небом: переулок, двор, площадка (люк — не в доме и не в дверях).
      if (!OUTDOOR.has(city.tileAt(x, y)) || !OUTDOOR.has(city.tileAt(x + 1, y)) || !OUTDOOR.has(city.tileAt(x, y + 1)) || !OUTDOOR.has(city.tileAt(x + 1, y + 1))) continue;
      if (city.zoneAtTile(x, y)?.kind !== 'restricted') continue;
      if (Math.min(x - cx0, y - cy0, cx1 - x, cy1 - y) > edge) continue;
      // Не у дверей и ворот (не мешать проходу).
      let near = false;
      for (let dy = -2; dy <= 3 && !near; dy++) for (let dx = -2; dx <= 3; dx++) {
        const t = city.tileAt(x + dx, y + dy);
        if (t === T.DOOR || t === T.GATE) near = true;
      }
      if (!near) cand.push({ x, y });
    }
  }
  return cand;
}

const OUTDOOR = new Set<number>([T.FLOOR, T.COURTYARD, T.STREET, T.PLAZA]);

/** Выборка «дальней точки»: каждый следующий — дальше всех от уже выбранных (не ближе spacing). */
function pickFarthest(cand: { x: number; y: number }[], rng: Rng, count: number, spacing: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (!cand.length) return out;
  out.push(rng.pick(cand));
  while (out.length < count) {
    let best: { x: number; y: number } | null = null;
    let bestD = -1;
    for (let k = 0; k < 400; k++) {
      const c = rng.pick(cand);
      const d = Math.min(...out.map((o) => Math.hypot(o.x - c.x, o.y - c.y)));
      if (d > bestD) {
        bestD = d;
        best = c;
      }
    }
    if (!best || bestD < spacing) break;
    out.push(best);
  }
  return out;
}

/** Проходимые тайлы в области, куда персонаж не пролезает (вне главной компоненты области), — в стену. */
function sealUnreachable(tiles: Uint8Array, W: number, H: number, area: Rect): void {
  const walk = buildAnchorWalk(tiles, W, H);
  const aw = W - 1;
  const { labels, sizes } = labelComponents(walk, aw, H - 1);
  const count = new Map<number, number>();
  for (let ay = area.y; ay < area.y + area.h - 1; ay++) {
    for (let ax = area.x; ax < area.x + area.w - 1; ax++) {
      const l = labels[ay * aw + ax];
      if (l >= 0) count.set(l, (count.get(l) ?? 0) + 1);
    }
  }
  let main = -1;
  for (const [l, n] of count) if (main < 0 || n > (count.get(main) ?? 0)) main = l;
  void sizes;
  const covered = new Uint8Array(W * H);
  for (let ay = area.y; ay < area.y + area.h - 1; ay++) {
    for (let ax = area.x; ax < area.x + area.w - 1; ax++) {
      if (labels[ay * aw + ax] !== main) continue;
      const i = ay * W + ax;
      covered[i] = covered[i + 1] = covered[i + W] = covered[i + W + 1] = 1;
    }
  }
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let x = area.x; x < area.x + area.w; x++) {
      const i = y * W + x;
      if (SOLID[tiles[i]] === 0 && !covered[i]) tiles[i] = T.SEWER_WALL;
    }
  }
}
