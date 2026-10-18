import { GENERATOR } from '../../config/generator';
import { ZONE_NAMES } from '../../config/names';
import { Rng, hash2 } from '../../core/rng';
import { GameMap, type Poi, type Zone } from '../GameMap';
import { SOLID, T } from '../tiles';

/**
 * ГЭС за восточной кромкой города (после пустоши, до канализации): карта расширяется вправо на GENERATOR.ges.width.
 * С запада на восток: двор (бетон) с машинным залом у подножия плотины, нижним бьефом и трансформаторами → плотина
 * (откосы и гребень, съезд на гребень со двора) → водохранилище до края. Ворота — в конце Плотинного проспекта.
 */
export function addDam(map: GameMap, seed: number): GameMap {
  const C = GENERATOR.ges;
  const rng = new Rng(hash2(seed, 0x6e5, 7));
  const W0 = map.width;
  const H = map.height;
  const W = W0 + C.width;
  const tiles = new Uint8Array(W * H).fill(T.ROCK);
  const zoneGrid = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    tiles.set(map.tiles.subarray(y * W0, (y + 1) * W0), y * W);
    zoneGrid.set(map.zoneGrid.subarray(y * W0, (y + 1) * W0), y * W);
  }
  const zones: Zone[] = map.zones.map((z) => ({ ...z }));
  const zGes = zones.length;
  // Символ зоны — свободный (заглавные канализации добавятся позже — их не берём).
  const char = [...'GJLMVWYZ'].find((ch) => !zones.some((z) => z.char === ch) && !'ABHIKNOPRSUX'.includes(ch)) ?? 'g';
  zones.push({ id: zGes, kind: 'ges', name: ZONE_NAMES.ges, char });
  const zWaste = Math.max(0, zones.findIndex((z) => z.kind === 'wasteland'));
  const pois: Poi[] = map.pois.map((p) => ({ ...p }));

  const vy0 = GENERATOR.wastes.top;
  const vy1 = H - GENERATOR.wastes.bottom - 1;
  const bx = W0;
  for (let y = 0; y < H; y++) for (let x = bx; x < W; x++) zoneGrid[y * W + x] = y >= vy0 && y <= vy1 ? zGes : zWaste;
  const at = (x: number, y: number) => tiles[y * W + x];
  const set = (x: number, y: number, t: number, zone = zGes) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    tiles[y * W + x] = t;
    zoneGrid[y * W + x] = zone;
  };
  const fill = (x0: number, y0: number, w: number, h: number, t: number, zone = zGes) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, t, zone);
  };

  const gy0 = vy0 + C.margin;
  const gy1 = vy1 - C.margin;
  const mid = (vy0 + vy1) >> 1;
  const yardR = bx + C.yard; // первый столбец плотины
  // Двор — земля; бетонная площадка у плотины и дорога от ворот — ниже.
  fill(bx, gy0, C.yard, gy1 - gy0 + 1, T.WASTE);

  // Нижний бьеф у подножия плотины, машинный зал севернее, трансформаторы южнее.
  const tailY = mid - (C.tail.h >> 1);
  const hx = yardR - C.hall.w;
  const hy = tailY - 2 - C.hall.h; // между залом и водой — проход в 2 тайла
  const TR = C.transformers;
  const trX = yardR - TR.cols * (TR.size + TR.gap);
  const trY = tailY + C.tail.h + TR.gap;
  const apX = Math.min(hx, trX) - C.apron;
  const apY = hy - C.apron - C.ramp - 3;
  fill(apX, apY, yardR - apX, Math.min(gy1, trY + TR.rows * (TR.size + TR.gap) + C.apron) - apY, T.BUNKER);
  fill(yardR - C.tail.w, tailY, C.tail.w, C.tail.h, T.WATER);
  fill(hx, hy, C.hall.w, C.hall.h, T.WALL);
  fill(hx + 1, hy + 1, C.hall.w - 2, C.hall.h - 2, T.INTERIOR);
  const doorY = hy + (C.hall.h >> 1) - 1;
  fill(hx, doorY, 1, 2, T.DOOR);
  pois.push({ type: 'ges_hall', x: hx + 1, y: hy + 1, w: C.hall.w - 2, h: C.hall.h - 2 });
  // Турбины — блоки 2×2 у стены плотины: первая вплотную к северной стене, дальше через 2 тайла прохода (щель в один
  // тайл якорю 2×2 недоступна); после последней — тоже не меньше 2 рядов.
  for (let k = 0; k < C.turbines; k++) {
    const tx = yardR - 5;
    const ty = hy + 1 + k * 4;
    if (ty + 4 > hy + C.hall.h - 1) break;
    fill(tx, ty, 2, 2, T.BARRIER);
    pois.push({ type: 'ges_turbine', x: tx, y: ty, w: 2, h: 2 });
  }
  for (let r = 0; r < TR.rows; r++) {
    for (let c = 0; c < TR.cols; c++) {
      const x = trX + c * (TR.size + TR.gap);
      const y = trY + r * (TR.size + TR.gap);
      if (y + TR.size > gy1 - 1) continue;
      fill(x, y, TR.size, TR.size, T.BARRIER);
      pois.push({ type: 'ges_transformer', x, y, w: TR.size, h: TR.size });
    }
  }

  // Плотина: откосы и гребень по всей долине (концами — в скалы хребтов), съезд на гребень севернее зала.
  const face = (C.dam - C.crest) >> 1;
  fill(yardR, vy0 - 2, C.dam, vy1 - vy0 + 5, T.DAM);
  fill(yardR + face, vy0, C.crest, vy1 - vy0 + 1, T.BUNKER); // гребень — по всей долине: на пляжи обоих берегов
  const rampY = Math.max(gy0 + 2, hy - C.ramp - 3);
  fill(yardR, rampY, face, C.ramp, T.BUNKER);
  pois.push({ type: 'ges_dam', x: yardR, y: vy0, w: C.dam, h: vy1 - vy0 + 1 });


  // Ворота: ряды асфальта Плотинного проспекта у восточного края города (иначе — любого проспекта, иначе — ближайший проход).
  const edge = bx - GENERATOR.wastes.east - 1; // последний столбец города
  const reachOf = (y: number): number => {
    for (let k = 0; k <= C.reach; k++) if (!SOLID[at(edge - k, y)]) return k;
    return -1;
  };
  type Run = { y0: number; y1: number; score: number; k: number };
  const runs: Run[] = [];
  let cur: Run | null = null;
  for (let y = gy0 + 3; y <= gy1 - 3; y++) {
    const k = reachOf(y);
    const z = k >= 0 ? zones[zoneGrid[y * W + edge - k]] : null;
    const score = !z || at(edge - k, y) !== T.STREET ? 0 : z.kind === 'avenue' ? (z.name === ZONE_NAMES.avenue[2] ? 3 : 2) : 0;
    if (score > 0 && cur && cur.score === score && cur.y1 === y - 1) {
      cur.y1 = y;
      cur.k = Math.max(cur.k, k);
    } else if (score > 0) {
      cur = { y0: y, y1: y, score, k };
      runs.push(cur);
    } else cur = null;
  }
  runs.sort((a, b) => b.score - a.score || b.y1 - b.y0 - (a.y1 - a.y0));
  let g0: number;
  let depth: number;
  const best = runs.find((r) => r.y1 - r.y0 + 1 >= C.gate);
  if (best) {
    g0 = ((best.y0 + best.y1) >> 1) - (C.gate >> 1);
    depth = best.k;
  } else {
    // Запасной путь: ряд с ближайшим проходом.
    let bestY = mid;
    let bestK = Infinity;
    for (let y = gy0 + 4; y <= gy1 - 4 - C.gate; y++) {
      const k = reachOf(y);
      if (k >= 0 && k < bestK) { bestK = k; bestY = y; }
    }
    g0 = bestY - (C.gate >> 1);
    depth = Number.isFinite(bestK) ? bestK : C.reach;
  }
  for (let y = g0; y < g0 + C.gate; y++) {
    for (let x = edge - depth; x <= edge; x++) if (SOLID[at(x, y)]) tiles[y * W + x] = T.STREET;
    for (let x = edge + 1; x < bx; x++) set(x, y, T.GATE);
  }
  // Бетонная дорога от ворот до площадки у плотины: вдоль ряда ворот, потом к площадке по вертикали.
  const road = C.gate - 2;
  const ry = g0 + 1;
  const roadEnd = apX + 2;
  fill(bx, ry, roadEnd - bx, road, T.BUNKER);
  const apBottom = Math.min(gy1, trY + TR.rows * (TR.size + TR.gap) + C.apron);
  if (ry < apY || ry + road > apBottom) {
    const y0 = Math.min(ry, apY);
    const y1 = Math.max(ry + road, apBottom);
    fill(roadEnd - road, y0, road, y1 - y0, T.BUNKER);
  }
  pois.push({ type: 'ges_gate', x: edge + 1, y: g0, w: bx - edge - 1, h: C.gate, face: 'E' });
  pois.push({ type: 'ges_post', x: bx + 1, y: g0 - 3, face: 'W' });
  pois.push({ type: 'ges_post', x: bx + 1, y: g0 + C.gate + 1, face: 'W' });
  // Водохранилище до края (два столбца скалы у края — зазор до канализации). Порт — на берегу со стороны ворот (ближе
  // идти от Плотинного проспекта), остальной берег — галечный пляж с неровной кромкой.
  const rx0 = yardR + C.dam;
  const rx1 = W - 3;
  fill(rx0, vy0, rx1 - rx0 + 1, vy1 - vy0 + 1, T.WATER);
  pois.push({ type: 'reservoir', x: rx0, y: vy0, w: rx1 - rx0 + 1, h: vy1 - vy0 + 1 });
  const zPort = zones.length;
  zones.push({ id: zPort, kind: 'ges', name: ZONE_NAMES.port, char: [...'JLMVWYZ'].find((ch) => !zones.some((z) => z.char === ch) && !'ABHIKNOPRSUX'.includes(ch)) ?? 'j' });
  const north = g0 + (C.gate >> 1) < mid;
  // v — от кромки хребта к воде (0 — у скалы): прямоугольник по v → тайлы.
  const yOf = (v: number) => (north ? vy0 + v : vy1 - v);
  const rectV = (x0: number, w: number, v0: number, v1: number) => ({ x: x0, y: Math.min(yOf(v0), yOf(v1 - 1)), w, h: v1 - v0 });
  const fillV = (x0: number, w: number, v0: number, v1: number, t: number, zone = zPort) => {
    const r = rectV(x0, w, v0, v1);
    fill(r.x, r.y, r.w, r.h, t, zone);
  };
  const P = C.port;
  const px1 = Math.min(rx1 - 10, rx0 + P.length);
  // Пляж: глубина гуляет в beach[0..1] и меняется раз на 2 тайла — ступеньки не уже якоря 2×2, недоступных карманов нет.
  const step = (d: number) => Math.max(C.beach[0], Math.min(C.beach[1], d + rng.int(-1, 1)));
  const beachRow = (fromX: number, northSide: boolean) => {
    let d = rng.int(C.beach[0], C.beach[1]);
    for (let x = fromX; x <= rx1; x++) {
      if ((x - fromX) % 2 === 0) d = step(d);
      for (let v = 0; v < d; v++) set(x, northSide ? vy0 + v : vy1 - v, T.SHORE);
    }
  };
  beachRow(px1 + 1, north);
  beachRow(rx0, !north);
  let d = rng.int(C.farBeach[0], C.farBeach[1]);
  for (let y = vy0; y <= vy1; y++) {
    if ((y - vy0) % 2 === 0) d = Math.max(C.farBeach[0], Math.min(C.farBeach[1], d + rng.int(-2, 2)));
    for (let x = rx1 - d + 1; x <= rx1; x++) set(x, y, T.SHORE);
  }
  // Порт: бетонная площадка от плотины; у скалы — склад, посередине — штабели контейнеров, у воды — набережная с кранами,
  // в воду — пирсы с причалами барж. С гребня плотины на площадку — проход сквозь откос.
  fillV(rx0, px1 - rx0 + 1, 0, P.depth, T.BUNKER);
  pois.push({ type: 'port_quay', ...rectV(rx0, px1 - rx0 + 1, P.depth - 3, P.depth), face: north ? 'S' : 'N' });
  for (let k = 0; k < P.piers; k++) {
    const x = rx0 + P.first + k * P.pierStep;
    if (x + P.pierW + 1 + P.bargeW > px1) break;
    fillV(x, P.pierW, P.depth, P.depth + P.pierLen, T.BUNKER);
    pois.push({ type: 'port_pier', ...rectV(x, P.pierW, P.depth, P.depth + P.pierLen) });
    pois.push({ type: 'barge_berth', ...rectV(x + P.pierW + 1, P.bargeW, P.depth + 1, P.depth + P.pierLen), face: north ? 'N' : 'S', id: k });
    // Кран у корня пирса вплотную к воде (за ним — 2 ряда прохода и больше).
    fillV(x - 3, 2, P.depth - 2, P.depth, T.BARRIER);
    pois.push({ type: 'port_crane', ...rectV(x - 3, 2, P.depth - 2, P.depth), face: north ? 'S' : 'N' });
  }
  const WH = P.warehouse;
  const wx = px1 - WH.w - 1; // восточнее склада — проход в 2 тайла к пляжу
  fillV(wx, WH.w, 0, WH.h, T.WALL);
  fillV(wx + 1, WH.w - 2, 1, WH.h - 1, T.INTERIOR);
  fillV(wx + (WH.w >> 1) - 1, 2, WH.h - 1, WH.h, T.DOOR);
  pois.push({ type: 'port_warehouse', ...rectV(wx + 1, WH.w - 2, 1, WH.h - 1) });
  const CT = P.containers;
  let colour = 0;
  for (let v = 2; v + CT.h <= P.depth - 5; v += CT.h + CT.gapY) {
    for (let x = rx0 + 2; x + CT.w <= wx - 3; x += CT.w + CT.gapX) {
      if (rng.chance(CT.skip)) continue;
      fillV(x, CT.w, v, v + CT.h, T.BARRIER);
      pois.push({ type: 'port_container', ...rectV(x, CT.w, v, v + CT.h), id: colour++ % 4 });
    }
  }
  fillV(yardR + face + C.crest, C.dam - face - C.crest, P.depth - 3 - P.link, P.depth - 3, T.BUNKER);
  // Протока на восток (река выше водохранилища): по ней баржи уходят за край карты; пляж дальнего берега — с гребня.
  const half = P.bargeW + 2;
  fill(rx0, mid - half, W - rx0, half * 2, T.WATER);
  const farY = north ? vy1 - C.beach[0] + 2 : vy0 + C.beach[0] - 3;
  fill(yardR + face + C.crest, farY, C.dam - face - C.crest, 2, T.SHORE, zGes);
  pois.push({ type: 'ges', x: bx, y: vy0, w: C.width, h: vy1 - vy0 + 1 });

  return new GameMap(W, H, map.tileSize, tiles, zoneGrid, zones, pois, map.seed, map.name, map.stats);
}
