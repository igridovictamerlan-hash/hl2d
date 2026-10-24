import { GENERATOR } from '../../config/generator';
import { ZONE_NAMES } from '../../config/names';
import { Rng, hash2 } from '../../core/rng';
import { GameMap, type Poi, type Zone } from '../GameMap';
import { SOLID, T } from '../tiles';

/**
 * ГЭС и река за восточной кромкой города (после пустоши, до канализации): карта расширяется вправо на GENERATOR.ges.width.
 * Вдоль города течёт река: берег у кромки (дорога, земля, пляж), вода, дальний пляж у края. Плотина — поперёк реки
 * (перпендикулярно берегу) у хребта со стороны ворот, за ней до хребта — водохранилище; у подножия плотины у берега —
 * машинный зал и трансформаторы. Ворота — в конце Плотинного проспекта, за ними на берегу — речной порт с пирсами; ниже
 * по течению, у дальнего хребта, — протока на восток за край карты.
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
  const mid = (vy0 + vy1) >> 1;

  // Ворота: ряды асфальта Плотинного проспекта у восточного края города (иначе — любого проспекта, иначе — ближайший проход).
  const edge = bx - GENERATOR.wastes.east - 1; // последний столбец города
  const reachOf = (y: number): number => {
    for (let k = 0; k <= C.reach; k++) if (!SOLID[at(edge - k, y)]) return k;
    return -1;
  };
  const gy0 = vy0 + C.margin;
  const gy1 = vy1 - C.margin;
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

  // s — от хребта со стороны ворот (там плотина) вниз по течению: s → ряд, прямоугольник по s → тайлы.
  const north = g0 + (C.gate >> 1) < mid;
  const S = vy1 - vy0;
  const yOf = (s: number) => (north ? vy0 + s : vy1 - s);
  const rectS = (x: number, w: number, s0: number, s1: number) => ({ x, y: Math.min(yOf(s0), yOf(s1 - 1)), w, h: s1 - s0 });
  const fillS = (x: number, w: number, s0: number, s1: number, t: number, zone = zGes) => {
    const r = rectS(x, w, s0, s1);
    fill(r.x, r.y, r.w, r.h, t, zone);
  };
  const gateS = north ? g0 + (C.gate >> 1) - vy0 : vy1 - (g0 + (C.gate >> 1));
  const rx0 = bx + C.bank; // первый столбец воды
  const rx1 = W - 3; // последний столбец до скалы у края (зазор до канализации)
  const P = C.port;
  const half = P.bargeW + 2;

  // Берег — земля, река — вода; галечный пляж у воды: у ближнего берега, у хребта над водохранилищем, у дальнего края.
  fill(bx, vy0, C.bank, S + 1, T.WASTE);
  fill(rx0, vy0, rx1 - rx0 + 1, S + 1, T.WATER);
  const step = (d: number, lo: number, hi: number, k: number) => Math.max(lo, Math.min(hi, d + rng.int(-k, k)));
  let d = rng.int(C.beach[0], C.beach[1]);
  for (let s = 0; s <= S; s++) {
    if (s % 2 === 0) d = step(d, C.beach[0], C.beach[1], 1);
    fillS(rx0 - d, d, s, s + 1, T.SHORE);
  }
  d = rng.int(C.beach[0], C.beach[1]);
  for (let x = rx0; x <= rx1; x++) {
    if ((x - rx0) % 2 === 0) d = step(d, C.beach[0], C.beach[1], 1);
    fillS(x, 1, 0, d, T.SHORE);
  }
  const far = new Int32Array(S + 1);
  d = rng.int(C.farBeach[0], C.farBeach[1]);
  for (let s = 0; s <= S; s++) {
    if (s % 2 === 0) d = step(d, C.farBeach[0], C.farBeach[1], 2);
    far[s] = d;
    fillS(rx1 - d + 1, d, s, s + 1, T.SHORE);
  }

  // Плотина поперёк реки: откосы и гребень от берега до дальнего пляжа (там пляж — сплошной мыс под концом плотины).
  const damS = C.damAt;
  const face = (C.dam - C.crest) >> 1;
  let spit = 0;
  for (let s = damS - 1; s <= damS + C.dam; s++) spit = Math.max(spit, far[s]);
  const dx1 = rx1 - spit; // последний столбец тела плотины
  fillS(dx1 + 1, spit, damS - 1, damS + C.dam + 1, T.SHORE);
  fillS(rx0, dx1 - rx0 + 1, damS, damS + C.dam, T.DAM);
  fillS(rx0, dx1 - rx0 + 1, damS + face, damS + face + C.crest, T.BUNKER);
  pois.push({ type: 'ges_dam', ...rectS(rx0, dx1 - rx0 + 1, damS, damS + C.dam) });

  // Машинный зал — у подножия плотины в воде, вплотную к берегу (дверь — на берег); турбины — вдоль стены плотины: первая
  // вплотную к стене берега, дальше через 2 тайла прохода (щель в тайл якорю 2×2 недоступна).
  const hs0 = damS + C.dam;
  const hs1 = hs0 + C.hall.h;
  fillS(rx0, C.hall.w, hs0, hs1, T.WALL);
  fillS(rx0 + 1, C.hall.w - 2, hs0 + 1, hs1 - 1, T.INTERIOR);
  const doorS = hs0 + (C.hall.h >> 1) - 1;
  fillS(rx0, 1, doorS, doorS + 2, T.DOOR);
  pois.push({ type: 'ges_hall', ...rectS(rx0 + 1, C.hall.w - 2, hs0 + 1, hs1 - 1) });
  for (let k = 0; k < C.turbines; k++) {
    const tx = rx0 + 1 + k * 4;
    if (tx + 4 > rx0 + C.hall.w - 1) break;
    fillS(tx, 2, hs0 + 1, hs0 + 3, T.BARRIER);
    pois.push({ type: 'ges_turbine', ...rectS(tx, 2, hs0 + 1, hs0 + 3) });
  }
  // Бетонная площадка ГЭС на берегу (у плотины и зала), трансформаторы на ней — между дорогой и залом.
  const apS0 = damS - C.apron;
  const apS1 = hs1 + C.apron;
  fillS(bx + 1, rx0 - bx - 1, apS0, apS1, T.BUNKER);
  const TR = C.transformers;
  const trX = rx0 - 2 - (TR.cols * (TR.size + TR.gap) - TR.gap);
  for (let r = 0; r < TR.rows; r++) {
    for (let c = 0; c < TR.cols; c++) {
      const x = trX + c * (TR.size + TR.gap);
      const s = hs0 + 2 + r * (TR.size + TR.gap);
      if (s + TR.size > apS1 - 1) continue;
      fillS(x, TR.size, s, s + TR.size, T.BARRIER);
      pois.push({ type: 'ges_transformer', ...rectS(x, TR.size, s, s + TR.size) });
    }
  }

  // Речной порт — на берегу у ворот: бетонная площадка от кромки до воды, набережная, пирсы с причалами и кранами.
  const zPort = zones.length;
  zones.push({ id: zPort, kind: 'ges', name: ZONE_NAMES.port, char: [...'JLMVWYZ'].find((ch) => !zones.some((z) => z.char === ch) && !'ABHIKNOPRSUX'.includes(ch)) ?? 'j' });
  const chS = S - 2 * half + 1; // первый ряд протоки
  const pu0 = Math.max(apS1 + P.gap, gateS - (P.length >> 1));
  const pu1 = Math.min(chS - P.gap, pu0 + P.length);
  fillS(bx, C.bank, pu0, pu1, T.BUNKER, zPort);
  pois.push({ type: 'port_quay', ...rectS(rx0 - 3, 3, pu0, pu1), face: 'E' });
  for (let k = 0; k < P.piers; k++) {
    const s = pu0 + P.first + k * P.pierStep;
    if (s + P.pierW + 1 + P.bargeW > pu1) break;
    fillS(rx0, P.pierLen, s, s + P.pierW, T.BUNKER, zPort);
    pois.push({ type: 'port_pier', ...rectS(rx0, P.pierLen, s, s + P.pierW) });
    pois.push({ type: 'barge_berth', ...rectS(rx0 + 1, P.pierLen - 1, s + P.pierW + 1, s + P.pierW + 1 + P.bargeW), face: 'W', id: k });
    // Кран у корня пирса вплотную к воде (до пирса — ряд прохода, к нему подходят с площадки).
    fillS(rx0 - 2, 2, s - 3, s - 1, T.BARRIER, zPort);
    pois.push({ type: 'port_crane', ...rectS(rx0 - 2, 2, s - 3, s - 1), face: 'E' });
  }
  // Склад — у кромки в дальнем конце порта (дверь к воде; за ним — проход в 2 тайла), между ним и воротами — контейнеры.
  const WH = P.warehouse;
  const ws0 = pu1 - WH.w - 2;
  fillS(bx, WH.h, ws0, ws0 + WH.w, T.WALL, zPort);
  fillS(bx + 1, WH.h - 2, ws0 + 1, ws0 + WH.w - 1, T.INTERIOR, zPort);
  fillS(bx + WH.h - 1, 1, ws0 + (WH.w >> 1) - 1, ws0 + (WH.w >> 1) + 1, T.DOOR, zPort);
  pois.push({ type: 'port_warehouse', ...rectS(bx + 1, WH.h - 2, ws0 + 1, ws0 + WH.w - 1) });
  const CT = P.containers;
  const gs0 = gateS - (C.gate >> 1) - 2;
  const gs1 = gateS + (C.gate >> 1) + 2;
  let colour = 0;
  for (let x = bx + C.road + 3; x + CT.h <= rx0 - 6; x += CT.h + CT.gapX) {
    for (let s = pu0 + 2; s + CT.w <= ws0 - 3; s += CT.w + CT.gapY) {
      if (s + CT.w > gs0 && s < gs1) continue;
      if (rng.chance(CT.skip)) continue;
      fillS(x, CT.h, s, s + CT.w, T.BARRIER, zPort);
      pois.push({ type: 'port_container', ...rectS(x, CT.h, s, s + CT.w), id: colour++ % 4 });
    }
  }
  // Дорога вдоль кромки от площадки ГЭС до порта.
  if (pu0 > apS1) fillS(bx + 1, C.road, apS1, pu0, T.BUNKER);
  pois.push({ type: 'ges_gate', x: edge + 1, y: g0, w: bx - edge - 1, h: C.gate, face: 'E' });
  pois.push({ type: 'ges_post', x: bx + 1, y: g0 - 3, face: 'W' });
  pois.push({ type: 'ges_post', x: bx + 1, y: g0 + C.gate + 1, face: 'W' });

  // Протока на восток у дальнего хребта: по ней баржи уходят за край карты; фарватер — посередине реки.
  fillS(rx0, W - rx0, chS, S + 1, T.WATER);
  const fx = Math.round((rx0 + P.pierLen + dx1) / 2);
  pois.push({ type: 'channel', ...rectS(fx, W - fx, chS, S + 1) });
  pois.push({ type: 'reservoir', x: rx0, y: vy0, w: rx1 - rx0 + 1, h: S + 1 });
  pois.push({ type: 'ges', x: bx, y: vy0, w: C.width, h: S + 1 });

  return new GameMap(W, H, map.tileSize, tiles, zoneGrid, zones, pois, map.seed, map.name, map.stats);
}
