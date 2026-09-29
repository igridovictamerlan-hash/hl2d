import type { Character } from '../entities/Character';
import type { WeaponId } from '../config/items';
import { drawPawn, handColor, type PawnDir, type PawnLook } from '../entities/PawnRenderer';
import { drawWeapon } from '../entities/WeaponRenderer';
import { drawFeet } from '../entities/EntityRenderer';
import { PAWN } from '../config/pawns';

/** Куда пешка держит ствол, стоя лицом в сторону dir (как в игре: ствол — по взгляду). */
const HOLD: Record<PawnDir, number> = { E: 0, S: Math.PI / 2, W: Math.PI, N: -Math.PI / 2 };

/**
 * Пешка с оружием в руках для интерфейса (инвентарь, портрет) — теми же функциями, что на карте:
 * ступни, ствол за спиной (смотрит от нас) или в руках, руки на рукояти и цевье.
 * (x, groundY) — точка у ног, ps — масштаб пешки (px экрана на единицу модели).
 */
export function drawPawnFigure(ctx: CanvasRenderingContext2D, look: PawnLook, weapon: WeaponId | null, x: number, groundY: number, ps: number, dir: PawnDir, reloading = false): void {
  const footY = PAWN.walk.foot.y * ps;
  const y = groundY - footY;
  ctx.save();
  ctx.translate(x, groundY);
  drawFeet(ctx, dir, look, ps, null, 0);
  ctx.restore();
  const hold = HOLD[dir];
  // drawWeapon берёт позу от персонажа — даём ему «манекен» в начале координат.
  const dummy = { x: 0, y: 0, weapon, recoil: 0, kick: 0, facing: hold } as unknown as Character;
  const s = ps / PAWN.scale;
  const hand = weapon ? handColor(look) : null;
  if (weapon && dir === 'N') drawWeapon(ctx, dummy, x, y, s, reloading, hold, hand);
  drawPawn(ctx, look, x, y, ps, dir);
  if (weapon && dir !== 'N') drawWeapon(ctx, dummy, x, y, s, reloading, hold, hand);
}
