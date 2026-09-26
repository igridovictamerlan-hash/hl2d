import type { Character } from './Character';
import type { WeaponId } from '../config/items';
import { WEAPON_SPRITES, WEAPON_POSE } from '../config/weaponSprites';

/**
 * Поза оружия: рукоять (мир, px), угол ствола и отражение (целится влево — модель отражена по
 * вертикали, чтобы магазин и рукоять оставались снизу).
 */
export interface Pose {
  x: number;
  y: number;
  ang: number;
  flip: boolean;
}

export function weaponPose(c: Character, reloading: boolean): Pose {
  const flip = Math.cos(c.facing) < 0;
  const kick = Math.min(WEAPON_POSE.kickMax, c.recoil * WEAPON_POSE.kickPerDeg);
  const d = WEAPON_POSE.hold - kick;
  // Перезарядка — ствол опущен (к низу экрана с той стороны, куда смотрит).
  const tilt = reloading ? (flip ? -WEAPON_POSE.reloadTilt : WEAPON_POSE.reloadTilt) : 0;
  return { x: c.x + Math.cos(c.facing) * d, y: c.y + WEAPON_POSE.y + Math.sin(c.facing) * d, ang: c.facing + tilt, flip };
}

/** Дульный срез в мире (для трассера и вспышки). */
export function muzzleWorld(c: Character, id: WeaponId, reloading = false): { x: number; y: number } {
  const p = weaponPose(c, reloading);
  const [mx, my0] = WEAPON_SPRITES[id].muzzle;
  const k = WEAPON_POSE.scale;
  const my = (p.flip ? -my0 : my0) * k;
  const cs = Math.cos(p.ang);
  const sn = Math.sin(p.ang);
  return { x: p.x + cs * mx * k - sn * my, y: p.y + sn * mx * k + cs * my };
}
