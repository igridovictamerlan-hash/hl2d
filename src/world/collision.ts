import type { GameMap } from './GameMap';
import type { Vec2 } from '../core/math';

/**
 * Коллизии круг–тайлы. Ближайшая точка прямоугольника тайла к центру круга:
 * если ближе радиуса — выталкиваем по нормали. Скругление углов даёт скольжение вдоль стен
 * и «обтекание» углов без застревания.
 */

/** Пересекает ли круг хотя бы один непроходимый тайл. */
export function circleHitsSolid(map: GameMap, x: number, y: number, r: number): boolean {
  const ts = map.tileSize;
  const x0 = Math.floor((x - r) / ts);
  const x1 = Math.floor((x + r) / ts);
  const y0 = Math.floor((y - r) / ts);
  const y1 = Math.floor((y + r) / ts);
  const r2 = r * r;
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!map.isSolid(tx, ty)) continue;
      const cx = Math.max(tx * ts, Math.min(x, (tx + 1) * ts));
      const cy = Math.max(ty * ts, Math.min(y, (ty + 1) * ts));
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy < r2) return true;
    }
  }
  return false;
}

/** Выталкивает круг из стен (мутирует pos). Возвращает true, если было касание. */
export function resolveCircleVsTiles(map: GameMap, pos: Vec2, r: number): boolean {
  const ts = map.tileSize;
  let hit = false;
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    const x0 = Math.floor((pos.x - r) / ts);
    const x1 = Math.floor((pos.x + r) / ts);
    const y0 = Math.floor((pos.y - r) / ts);
    const y1 = Math.floor((pos.y + r) / ts);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!map.isSolid(tx, ty)) continue;
        const rx = tx * ts;
        const ry = ty * ts;
        const cx = Math.max(rx, Math.min(pos.x, rx + ts));
        const cy = Math.max(ry, Math.min(pos.y, ry + ts));
        const dx = pos.x - cx;
        const dy = pos.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2);
          const push = r - d;
          pos.x += (dx / d) * push;
          pos.y += (dy / d) * push;
        } else {
          // Центр внутри тайла — выталкиваем по кратчайшей оси.
          const left = pos.x - rx;
          const right = rx + ts - pos.x;
          const top = pos.y - ry;
          const bottom = ry + ts - pos.y;
          const m = Math.min(left, right, top, bottom);
          if (m === left) pos.x = rx - r;
          else if (m === right) pos.x = rx + ts + r;
          else if (m === top) pos.y = ry - r;
          else pos.y = ry + ts + r;
        }
        moved = true;
        hit = true;
      }
    }
    if (!moved) break;
  }
  return hit;
}

/** Пройдёт ли круг радиуса r по прямой от A до B, не задев стен (шаг проверки 4 px). */
export function segmentClear(map: GameMap, ax: number, ay: number, bx: number, by: number, r: number): boolean {
  const len = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(len / 4));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (circleHitsSolid(map, ax + (bx - ax) * t, ay + (by - ay) * t, r)) return false;
  }
  return true;
}
