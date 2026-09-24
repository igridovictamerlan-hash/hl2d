import type { Character } from '../entities/Character';
import type { AiContext } from './AiContext';

const near: Character[] = [];

/** Плавный поворот к углу target (рад/с). */
export function turnTowards(self: Character, target: number, dt: number, rate = 8): void {
  let diff = target - self.facing;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const maxTurn = rate * dt;
  self.facing += Math.max(-maxTurn, Math.min(maxTurn, diff));
}

export function faceTowards(self: Character, x: number, y: number, dt: number): void {
  turnTowards(self, Math.atan2(y - self.y, x - self.x), dt);
}

/** Взгляд по ходу движения; стоя — на того, кого пропускаем, или на ближайшего соседа. */
export function faceMovement(self: Character, ctx: AiContext, dt: number): void {
  if (self.moveSpeed > 8) {
    turnTowards(self, Math.atan2(self.vy, self.vx), dt);
    return;
  }
  const other = self.brain?.mover.yieldFrom;
  if (other) {
    faceTowards(self, other.x, other.y, dt);
    return;
  }
  let best = 70;
  let tx = 0;
  let ty = 0;
  for (const o of ctx.entities.near(self.x, self.y, 70, near)) {
    if (o === self) continue;
    const d = Math.hypot(o.x - self.x, o.y - self.y);
    if (d < best) {
      best = d;
      tx = o.x;
      ty = o.y;
    }
  }
  if (best < 70) faceTowards(self, tx, ty, dt);
}
