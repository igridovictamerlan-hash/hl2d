import type { GameMap } from '../world/GameMap';
import { segmentClear } from '../world/collision';
import type { Vec2 } from '../core/math';

/**
 * «Натягивание нити»: из цепочки центров якорей оставляем только точки поворота,
 * между которыми кружок (с запасом margin) проходит по прямой. Путь без «лесенки»,
 * NPC не цепляются за углы.
 */
export function smoothPath(map: GameMap, pts: Vec2[], radius: number, margin = 2): Vec2[] {
  if (pts.length <= 2) return pts.slice();
  const r = radius + margin;
  const out: Vec2[] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = i + 1;
    // Двигаемся вперёд, пока прямая видна; ограничение — чтобы не проверять слишком длинные отрезки.
    for (let k = i + 2; k < pts.length && k - i <= 48; k++) {
      if (segmentClear(map, pts[i].x, pts[i].y, pts[k].x, pts[k].y, r)) j = k;
      else break;
    }
    out.push(pts[j]);
    i = j;
  }
  return out;
}
