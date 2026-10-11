import { TRENCH } from '../config/tactics';
import { castRayWith } from './visibility';
import { T } from './tiles';
import type { GameMap } from './GameMap';

/** Стоит ли точка мира (x, y) в траншее: тайл под центром персонажа — T.TRENCH. */
export function inTrench(map: GameMap, x: number, y: number): boolean {
  const ts = map.tileSize;
  return map.tileAt(Math.floor(x / ts), Math.floor(y / ts)) === T.TRENCH;
}

/**
 * Расстояние от (x, y) до бруствера по лучу (dx, dy) — единичному, в сторону угрозы: первый тайл
 * не-траншеи не дальше reach px. −1: весь отрезок — траншея (огонь вдоль неё) или (x, y) не в траншее.
 */
export function parapetDist(map: GameMap, x: number, y: number, dx: number, dy: number, reach: number = TRENCH.parapetReach): number {
  if (!inTrench(map, x, y)) return -1;
  let found = false;
  const t = castRayWith(map, x, y, dx, dy, reach, (tx, ty) => {
    found = map.tileAt(tx, ty) !== T.TRENCH;
    return found;
  });
  return found ? t : -1;
}

/**
 * Прикрывает ли траншея точку (x, y) от угрозы в (tx, ty): стоит в траншее, угроза дальше
 * TRENCH.exposedWithin (ближе — бьёт сверху) и между ними в TRENCH.parapetReach px от точки — бруствер.
 */
export function trenchCover(map: GameMap, x: number, y: number, tx: number, ty: number): boolean {
  const d = Math.hypot(tx - x, ty - y);
  if (d <= TRENCH.exposedWithin) return false;
  return parapetDist(map, x, y, (tx - x) / d, (ty - y) / d) >= 0;
}
