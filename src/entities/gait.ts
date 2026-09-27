import type { Character } from './Character';
import { PAWN } from '../config/pawns';
import { pawnDir, type PawnDir } from './PawnRenderer';

/** Центр сектора стороны пешки, рад (экранные оси: y вниз). */
const DIR_ANGLE: Record<PawnDir, number> = { E: 0, S: Math.PI / 2, W: Math.PI, N: -Math.PI / 2 };

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/** Сторона по углу с запасом: пока угол в секторе текущей стороны плюс hysteresis — не меняем. */
export function dirWithHysteresis(angle: number, cur: PawnDir, hysteresis: number): PawnDir {
  return angleDiff(angle, DIR_ANGLE[cur]) <= Math.PI / 4 + hysteresis ? cur : pawnDir(angle);
}

/**
 * Походка после шага физики (mx, my — фактическое смещение за тик): копит пройденный путь (фаза
 * шага), сглаживает скорость (толчки в толпе не дёргают анимацию) и выбирает сторону пешки. Идёт и
 * не целится — сторона по ходу: боком — профиль, а не спина; целится, стреляет или стоит — куда
 * смотрит. Только отрисовка: на логику не влияет.
 */
export function updateGait(c: Character, mx: number, my: number, dt: number): void {
  const W = PAWN.walk;
  const k = Math.min(1, W.smooth * dt);
  c.gaitVx += (mx / dt - c.gaitVx) * k;
  c.gaitVy += (my / dt - c.gaitVy) * k;
  const sp = Math.hypot(c.gaitVx, c.gaitVy);
  const walking = sp > W.moving && Math.hypot(c.wantX, c.wantY) > 1;
  if (walking) c.stride += Math.hypot(mx, my);
  const aiming = c.aiming || c.recoil > W.aimRecoil;
  c.bodyDir = walking && !aiming ? dirWithHysteresis(Math.atan2(c.gaitVy, c.gaitVx), c.bodyDir, W.hysteresis) : pawnDir(c.facing);
}

/** Идёт ли пешка (для анимации шага). */
export function isWalking(c: Character): boolean {
  return Math.hypot(c.gaitVx, c.gaitVy) > PAWN.walk.moving && Math.hypot(c.wantX, c.wantY) > 1;
}
