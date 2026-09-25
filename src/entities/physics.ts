import type { EntityManager } from './EntityManager';
import type { GameMap } from '../world/GameMap';
import { resolveCircleVsTiles } from '../world/collision';
import type { Character } from './Character';

const tmp: Character[] = [];

/**
 * Шаг физики: разгон к желаемой скорости → перемещение → расталкивание кружков
 * (по массам: игрок тяжелее) → выталкивание из стен (стены всегда побеждают).
 */
export function stepPhysics(entities: EntityManager, map: GameMap, dt: number): void {
  const list = entities.list;
  for (const c of list) {
    c.prevX = c.x;
    c.prevY = c.y;
    if (!c.alive) continue;
    let dvx = c.wantX * c.speedMul - c.vx;
    let dvy = c.wantY * c.speedMul - c.vy;
    const dv = Math.hypot(dvx, dvy);
    const maxDv = c.accel * dt;
    if (dv > maxDv) {
      dvx *= maxDv / dv;
      dvy *= maxDv / dv;
    }
    c.vx += dvx;
    c.vy += dvy;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
  }

  entities.rebuildHash();
  for (let iter = 0; iter < 2; iter++) {
    for (const a of list) {
      if (!a.alive) continue;
      entities.near(a.x, a.y, a.radius * 2 + 2, tmp);
      for (const b of tmp) {
        if (b.id <= a.id || !b.alive) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minD = a.radius + b.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD) continue;
        const d = Math.sqrt(d2) || 0.01;
        const nx = d2 > 0 ? dx / d : 1;
        const ny = d2 > 0 ? dy / d : 0;
        const overlap = minD - d;
        const wa = b.mass / (a.mass + b.mass);
        const wb = a.mass / (a.mass + b.mass);
        a.x -= nx * overlap * wa;
        a.y -= ny * overlap * wa;
        b.x += nx * overlap * wb;
        b.y += ny * overlap * wb;
      }
    }
  }

  for (const c of list) {
    if (!c.alive) continue;
    resolveCircleVsTiles(map, c, c.radius);
    const mx = c.x - c.prevX;
    const my = c.y - c.prevY;
    c.moveSpeed = Math.hypot(mx, my) / dt;
    // Упёрлись — гасим скорость, чтобы не «разгоняться в стену».
    if (c.moveSpeed < Math.hypot(c.vx, c.vy) * 0.5) {
      c.vx = mx / dt;
      c.vy = my / dt;
    }
  }
}
