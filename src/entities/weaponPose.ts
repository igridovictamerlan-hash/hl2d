import type { Character } from './Character';
import type { WeaponId } from '../config/items';
import { WEAPON_SPRITES, WEAPON_POSE } from '../config/weaponSprites';

/** Поза оружия в системе персонажа: сдвиг (x вперёд, y вправо) и доворот, рад. */
export interface Pose {
  x: number;
  y: number;
  ang: number;
}

/** Как сейчас держит оружие: у бедра / в прицеле, отведено на перезарядке, откат от отдачи. */
export function weaponPose(c: Character, id: WeaponId, reloading: boolean): Pose {
  const sp = WEAPON_SPRITES[id];
  const P = WEAPON_POSE[sp.hold];
  const aimed = c.aiming || c.aim > 0.5;
  const base = aimed ? P.aim : P.hip;
  const kick = Math.min(WEAPON_POSE.kickMax, c.recoil * WEAPON_POSE.kickPerDeg);
  return { x: base.x - kick, y: base.y, ang: reloading ? WEAPON_POSE.reloadTilt : 0 };
}

/** Дульный срез в мире (для трассера и вспышки). */
export function muzzleWorld(c: Character, id: WeaponId, reloading = false): { x: number; y: number } {
  const p = weaponPose(c, id, reloading);
  const m = WEAPON_SPRITES[id].muzzle * WEAPON_POSE.scale;
  const lx = p.x + Math.cos(p.ang) * m;
  const ly = p.y + Math.sin(p.ang) * m;
  const cf = Math.cos(c.facing);
  const sf = Math.sin(c.facing);
  return { x: c.x + cf * lx - sf * ly, y: c.y + sf * lx + cf * ly };
}
