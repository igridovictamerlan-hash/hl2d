import { Rng, hash2 } from '../../core/rng';
import { GENERATOR } from '../../config/generator';
import { ZONE_NAMES } from '../../config/names';
import { T } from '../tiles';
import { GameMap, type Poi, type Zone } from '../GameMap';

/**
 * Пустошь вокруг города (за стеной Протектората). Оба пограничных КПП — у западной стены, поэтому с запада —
 * широкие предгорья (west тайлов скал), с остальных сторон — скальная кромка (east, bottom, top). В предгорьях:
 *  - тропа шириной trail вдоль городской стены от прохода (opening рядов сквозь стену) в пустошь КПП «Север»
 *    до прохода КПП «Юг»; у её западной обочины — карманы-выемки и редкие камни;
 *  - лагерь сопротивления у западной кромки, посередине между проходами, и дорога от него к тропе — развилка:
 *    из лагеря на север к одному КПП и на юг к другому.
 * Проходимое только добавляется — связность по построению (проверяет тест).
 */
export function addWastes(city: GameMap, seed: number): GameMap {
  const C = GENERATOR.wastes;
  const rng = new Rng(hash2(seed, 0x3a57, 11));
  const cw = city.width;
  const ch = city.height;
  const L = C.west;
  const top = C.top;
  const W = L + cw + C.east;
  const H = top + ch + C.bottom;

  const tiles = new Uint8Array(W * H).fill(T.ROCK);
  const zoneGrid = new Uint8Array(W * H);
  for (let y = 0; y < ch; y++) {
    tiles.set(city.tiles.subarray(y * cw, (y + 1) * cw), (y + top) * W + L);
    zoneGrid.set(city.zoneGrid.subarray(y * cw, (y + 1) * cw), (y + top) * W + L);
  }
  const zones: Zone[] = city.zones.map((z) => ({ ...z }));
  const addZone = (kind: Zone['kind'], name: string, char: string): number => {
    zones.push({ id: zones.length, kind, name, char });
    return zones.length - 1;
  };
  const zTrail = addZone('wasteland', ZONE_NAMES.wasteland, 'T');
  const zCamp = addZone('rebel_camp', ZONE_NAMES.rebelCamp, 'Q');
  const cityZone = new Uint8Array(W * H);
  for (let y = top; y < top + ch; y++) for (let x = L; x < L + cw; x++) cityZone[y * W + x] = 1;
  for (let i = 0; i < W * H; i++) if (!cityZone[i]) zoneGrid[i] = zTrail;
  const pois: Poi[] = city.pois.map((p) => ({ ...p, x: p.x + L, y: p.y + top }));

  const set = (x: number, y: number, t: number, zone = zTrail) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    tiles[y * W + x] = t;
    zoneGrid[y * W + x] = zone;
  };
  const fill = (x0: number, y0: number, w: number, h: number, t: number, zone = zTrail) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, t, zone);
  };

  // Пустошь перед каждым КПП (зона outlands внутри его прямоугольника) — в новых координатах.
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const cp of pois) {
    if (cp.type !== 'checkpoint_type' || cp.w === undefined || cp.h === undefined) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = cp.y; y < cp.y + cp.h; y++) {
      for (let x = cp.x; x < cp.x + cp.w; x++) {
        if (zones[zoneGrid[y * W + x]]?.kind !== 'outlands') continue;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    if (x1 >= 0) boxes.push({ x0, y0, x1, y1 });
  }
  boxes.sort((a, b) => a.y0 - b.y0);
  const t = C.trail;
  const tx = L - t;
  const openRow = (b: { y0: number; y1: number }) => Math.round((b.y0 + b.y1) / 2) - (C.opening >> 1);
  const rows = boxes.map(openRow);
  // Проходы сквозь городскую стену в пустошь КПП и тропа вдоль стены между ними.
  for (let k = 0; k < boxes.length; k++) fill(tx, rows[k], boxes[k].x0 - tx, C.opening, T.WASTE);
  const trailTop = rows.length ? Math.min(...rows) : top + (ch >> 1);
  const trailBottom = rows.length ? Math.max(...rows) + C.opening : trailTop + C.opening;
  fill(tx, trailTop, t, trailBottom - trailTop, T.WASTE);

  // Лагерь сопротивления у западной кромки, посередине между проходами, и дорога от него к тропе.
  const cw2 = C.camp.w;
  const chh = C.camp.h;
  const cx = Math.max(2, tx - cw2 - 4);
  const cy = Math.round((trailTop + trailBottom) / 2) - (chh >> 1);
  fill(cx, cy, cw2, chh, T.WASTE, zCamp);
  const roadY = cy + (chh >> 1) - (t >> 1) - 2;
  fill(cx + cw2, roadY, tx - cx - cw2, t, T.WASTE);

  // Выемки у западной обочины тропы (холмистая кромка предгорий): не меньше 2 тайлов в глубину и длину, иначе
  // клетка недостижима якорем 2×2. Ряды выемок и дороги к лагерю — без камней.
  const busy = new Uint8Array(H);
  for (let y = roadY - 2; y < roadY + t + 2; y++) if (y >= 0 && y < H) busy[y] = 1;
  for (let k = 0; k < C.outcrops.count; k++) {
    const len = rng.int(C.outcrops.size[0], C.outcrops.size[1]) + 1;
    const depth = rng.int(2, 3);
    const y0 = rng.int(trailTop + C.opening + 2, Math.max(trailTop + C.opening + 2, trailBottom - C.opening - len - 2));
    if (y0 + len > trailBottom - C.opening) continue;
    if (y0 >= roadY - len - 3 && y0 <= roadY + t + 3) continue;
    fill(tx - depth, y0, depth, len, T.WASTE);
    for (let y = y0 - 2; y < y0 + len + 2; y++) if (y >= 0 && y < H) busy[y] = 1;
  }
  // Камни на западной обочине прямых участков тропы. Между камнями не меньше 2 тайлов.
  let skip = 0;
  for (let y = trailTop + C.opening + 3; y < trailBottom - C.opening - 3; y++) {
    if (skip > 0 || busy[y]) {
      skip = Math.max(0, skip - 1);
      continue;
    }
    if (rng.chance(C.rubble)) {
      set(tx, y, T.ROCK);
      skip = 2;
    }
  }

  // Палатки: склад с тайником (слева) и штаб (справа) — стены, пол, вход сверху.
  const tent = (x0: number, y0: number, w: number, h: number) => {
    fill(x0, y0, w, h, T.WALL, zCamp);
    fill(x0 + 1, y0 + 1, w - 2, h - 2, T.INTERIOR, zCamp);
    const d = x0 + (w >> 1) - 1;
    fill(d, y0, 2, 1, T.DOOR, zCamp);
  };
  const tw = 9;
  const th = 6;
  const ty = cy + chh - th - 2;
  tent(cx + 3, ty, tw, th);
  tent(cx + cw2 - 3 - tw, ty, tw, th);
  pois.push({ type: 'camp_cache', x: cx + 4, y: ty + 2 });
  pois.push({ type: 'rebel_camp', x: cx + (cw2 >> 1), y: cy + 4 });
  // Ящики-укрытия во дворе лагеря: не ближе 3 тайлов друг к другу, к палаткам и к дороге.
  const crates: { x: number; y: number; w: number; h: number }[] = [];
  for (let k = 0; k < 200 && crates.length < 6; k++) {
    const horiz = rng.chance(0.5);
    const c = { x: rng.int(cx + 3, cx + cw2 - 5), y: rng.int(cy + 2, ty - 4), w: horiz ? 2 : 1, h: horiz ? 1 : 2 };
    if (crates.some((o) => c.x < o.x + o.w + 3 && o.x < c.x + c.w + 3 && c.y < o.y + o.h + 3 && o.y < c.y + c.h + 3)) continue;
    if (c.x + c.w >= cx + cw2 - 3 && c.y + c.h >= roadY - 2 && c.y <= roadY + t + 2) continue;
    crates.push(c);
    fill(c.x, c.y, c.w, c.h, T.BARRIER, zCamp);
  }

  return new GameMap(W, H, city.tileSize, tiles, zoneGrid, zones, pois, city.seed, city.name, city.stats);
}
