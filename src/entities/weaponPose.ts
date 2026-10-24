import type { Character } from './Character';
import type { WeaponId } from '../config/items';
import { WEAPON_SPRITES, WEAPON_POSE } from '../config/weaponSprites';
import { PAWN } from '../config/pawns';
import type { MeleeSwing } from './meleePose';

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

/**
 * ang — куда держит ствол (по умолчанию — куда смотрит; на ходу без прицела — по ходу); swing — дубинка
 * или нож в ударе и блоке (entities/meleePose): поворот и вынос.
 */
export function weaponPose(c: Character, reloading: boolean, ang: number = c.facing, swing: MeleeSwing | null = null): Pose {
  const flip = Math.cos(ang) < 0;
  const kick = Math.min(WEAPON_POSE.kickMax, c.recoil * WEAPON_POSE.kickPerDeg);
  // Длинный ствол (винтовка, РПГ) — у плеча: рукоять ближе к телу.
  const long = c.weapon ? isLong(c.weapon) : false;
  const d = (WEAPON_POSE.hold - kick - (long ? WEAPON_POSE.shoulder : 0)) * PAWN.scale + (swing?.dExt ?? 0);
  // Перезарядка — ствол опущен (к низу экрана с той стороны, куда смотрит); отдача уводит ствол.
  const tilt = reloading ? (flip ? -WEAPON_POSE.reloadTilt : WEAPON_POSE.reloadTilt) : c.kick;
  // Удар дугой: рука с оружием идёт по дуге вокруг плеча, клинок смотрит по ходу руки.
  const arm = ang + (swing?.dAng ?? 0) * 0.6;
  return { x: c.x + Math.cos(arm) * d, y: c.y + WEAPON_POSE.y * PAWN.scale + Math.sin(arm) * d, ang: ang + tilt + (swing?.dAng ?? 0), flip };
}

const longCache = new Map<WeaponId, boolean>();
/** Длинная модель (от приклада до дула длиннее WEAPON_POSE.long). */
function isLong(id: WeaponId): boolean {
  let v = longCache.get(id);
  if (v === undefined) {
    let x0 = 0;
    for (const p of WEAPON_SPRITES[id].parts) if ('r' in p) x0 = Math.min(x0, p.r[0]);
    else if ('p' in p) for (const [x] of p.p) x0 = Math.min(x0, x);
    v = WEAPON_SPRITES[id].muzzle[0] - x0 > WEAPON_POSE.long;
    longCache.set(id, v);
  }
  return v;
}

/** Дульный срез в мире (для трассера и вспышки). */
export function muzzleWorld(c: Character, id: WeaponId, reloading = false): { x: number; y: number } {
  const p = weaponPose(c, reloading);
  const [mx, my0] = WEAPON_SPRITES[id].muzzle;
  const k = WEAPON_POSE.scale * PAWN.scale;
  const my = (p.flip ? -my0 : my0) * k;
  const cs = Math.cos(p.ang);
  const sn = Math.sin(p.ang);
  return { x: p.x + cs * mx * k - sn * my, y: p.y + sn * mx * k + cs * my };
}
