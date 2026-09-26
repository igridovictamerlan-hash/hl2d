import { Rng, hash2 } from '../../core/rng';
import { GENERATOR } from '../../config/generator';
import { ZONE_NAMES } from '../../config/names';
import { T } from '../tiles';
import { GameMap, type Poi, type Zone } from '../GameMap';

/**
 * Пустошь вокруг города (за стеной Альянса): карта расширяется на side тайлов влево и вправо и на
 * bottom вниз. Всё новое — скалы, в них тропа шириной trail:
 *  - от выхода в пустошь каждого пограничного КПП (проход opening рядов сквозь стену города)
 *    вдоль западного / восточного края вниз;
 *  - по низу карты между ними;
 *  - посередине нижней полосы — лагерь сопротивления (палатка-склад с тайником, штаб, ящики).
 * Так у повстанцев прямой путь от лагеря к КПП D обоих выходов из города. Проходимое только
 * добавляется — связность по построению (проверяет тест).
 */
export function addWastes(city: GameMap, seed: number): GameMap {
  const C = GENERATOR.wastes;
  const rng = new Rng(hash2(seed, 0x3a57, 11));
  const cw = city.width;
  const ch = city.height;
  const L = C.side;
  const W = cw + 2 * L;
  const H = ch + C.bottom;

  const tiles = new Uint8Array(W * H).fill(T.ROCK);
  const zoneGrid = new Uint8Array(W * H);
  for (let y = 0; y < ch; y++) {
    tiles.set(city.tiles.subarray(y * cw, (y + 1) * cw), y * W + L);
    zoneGrid.set(city.zoneGrid.subarray(y * cw, (y + 1) * cw), y * W + L);
  }
  const zones: Zone[] = city.zones.map((z) => ({ ...z }));
  const addZone = (kind: Zone['kind'], name: string, char: string): number => {
    zones.push({ id: zones.length, kind, name, char });
    return zones.length - 1;
  };
  const zTrail = addZone('wasteland', ZONE_NAMES.wasteland, 'T');
  const zCamp = addZone('rebel_camp', ZONE_NAMES.rebelCamp, 'Q');
  const cityZone = new Uint8Array(W * H);
  for (let y = 0; y < ch; y++) for (let x = L; x < L + cw; x++) cityZone[y * W + x] = 1;
  for (let i = 0; i < W * H; i++) if (!cityZone[i]) zoneGrid[i] = zTrail;
  const pois: Poi[] = city.pois.map((p) => ({ ...p, x: p.x + L }));

  const set = (x: number, y: number, t: number, zone = zTrail) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    tiles[y * W + x] = t;
    zoneGrid[y * W + x] = zone;
  };
  const fill = (x0: number, y0: number, w: number, h: number, t: number, zone = zTrail) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, t, zone);
  };

  // Пустоши КПП (в новых координатах): западная и восточная по середине карты.
  const box = (west: boolean) => {
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = 0; y < ch; y++) {
      for (let x = L; x < L + cw; x++) {
        if (west !== x < W / 2) continue;
        if (zones[zoneGrid[y * W + x]]?.kind !== 'outlands') continue;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  };
  const west = box(true);
  const east = box(false);
  const t = C.trail;
  const bandY = ch + 2;
  const eastX = W - 1 - t;
  const openRow = (b: { y0: number; y1: number }) => Math.round((b.y0 + b.y1) / 2) - (C.opening >> 1);
  // Тропа вниз вдоль края и проход в пустошь КПП сквозь стену.
  if (west) {
    const oy = openRow(west);
    fill(1, oy, west.x0 - 1, C.opening, T.WASTE);
    fill(1, oy, t, bandY + t - oy, T.WASTE);
  }
  if (east) {
    const oy = openRow(east);
    fill(east.x1 + 1, oy, W - 2 - east.x1, C.opening, T.WASTE);
    fill(eastX, oy, t, bandY + t - oy, T.WASTE);
  }
  // Полоса по низу карты.
  fill(1, bandY, W - 2, t, T.WASTE);
  // Камни на обочинах прямых участков (не у поворотов и проходов).
  // Между камнями не меньше 2 тайлов (иначе одиночная клетка у обочины недостижима).
  let skip = 0;
  const rubble = (x: number, y: number) => {
    if (skip > 0) {
      skip--;
      return;
    }
    if (rng.chance(C.rubble)) {
      set(x, y, T.ROCK);
      skip = 2;
    }
  };
  for (const b of [west, east]) {
    if (!b) continue;
    const oy = openRow(b);
    const outer = b === west ? 1 : W - 2;
    skip = 0;
    for (let y = oy + C.opening + 3; y < bandY - 3; y++) rubble(outer, y);
  }
  skip = 0;
  for (let x = t + 4; x < eastX - 4; x++) rubble(x, bandY);

  // Лагерь сопротивления под полосой, посередине.
  const cw2 = C.camp.w;
  const chh = C.camp.h;
  const cx = Math.floor((W - cw2) / 2);
  const cy = bandY + t;
  fill(cx, cy, cw2, chh, T.WASTE, zCamp);
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
  // Ящики-укрытия во дворе лагеря: не ближе 3 тайлов друг к другу и к палаткам.
  const crates: { x: number; y: number; w: number; h: number }[] = [];
  for (let k = 0; k < 200 && crates.length < 6; k++) {
    const horiz = rng.chance(0.5);
    const c = { x: rng.int(cx + 3, cx + cw2 - 5), y: rng.int(cy + 2, ty - 4), w: horiz ? 2 : 1, h: horiz ? 1 : 2 };
    if (crates.some((o) => c.x < o.x + o.w + 3 && o.x < c.x + c.w + 3 && c.y < o.y + o.h + 3 && o.y < c.y + c.h + 3)) continue;
    crates.push(c);
    fill(c.x, c.y, c.w, c.h, T.BARRIER, zCamp);
  }

  return new GameMap(W, H, city.tileSize, tiles, zoneGrid, zones, pois, city.seed, city.name, city.stats);
}
