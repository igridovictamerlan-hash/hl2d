import { wornArmor } from './Gear';
import type { Character } from '../entities/Character';
import type { Rng } from '../core/rng';
import { ARMOR, HITS, type ArmorProfile, type HitZone } from '../config/combat';
import { cpUnit } from '../config/factions';

/**
 * Броня персонажа по зонам: силовой блок — по юниту, OTA и армия сопротивления — по профессии,
 * остальные (граждане, ТС, бандиты, партизаны, новобранцы) — без брони. Спецагент в чужой форме
 * брони не получает: форма, а не бронежилет. Надетые шлем и бронежилет (systems/Gear) — если крепче.
 */
export function armorOf(c: Character): ArmorProfile {
  const base = roleArmor(c);
  // Надетый шлем или бронежилет (systems/Gear) — если крепче формы.
  const g = wornArmor(c);
  if (g.head <= base.head && g.torso <= base.torso) return base;
  return { head: Math.max(base.head, g.head), torso: Math.max(base.torso, g.torso) };
}

/** Броня формы роли: силовой блок по юниту, OTA и армия — по профессии. */
export function roleArmor(c: Character): ArmorProfile {
  if (c.faction === 'cp') return ARMOR.cp[cpUnit(c.rank).unit] ?? ARMOR.none;
  if (c.profession) return ARMOR.profession[c.profession] ?? ARMOR.none;
  return ARMOR.none;
}

const ZONES: HitZone[] = ['head', 'torso', 'arm', 'leg'];

/**
 * Куда попала пуля: по весам HITS.weights, прицелившийся (aim 0..1) чаще попадает в голову;
 * у присевшего ноги поджаты — вес ног × legMul.
 */
export function rollZone(rng: Rng, aim: number, legMul = 1): HitZone {
  const W = HITS.weights;
  const head = W.head + HITS.headAim * aim;
  const leg = W.leg * legMul;
  const total = head + W.torso + W.arm + leg;
  let r = rng.next() * total;
  for (const z of ZONES) {
    r -= z === 'head' ? head : z === 'leg' ? leg : W[z];
    if (r <= 0) return z;
  }
  return 'torso';
}

/** Стоит ли attacker за спиной у target (удар ножом в спину): угол от взгляда цели больше 110°. */
export function behind(target: Character, attacker: Character): boolean {
  const a = Math.atan2(attacker.y - target.y, attacker.x - target.x);
  let d = a - target.facing;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return Math.abs(d) > (110 * Math.PI) / 180;
}

/** Названия зон для журнала. */
export const ZONE_NAMES: Record<HitZone | 'blast', string> = {
  head: 'голова',
  torso: 'корпус',
  arm: 'рука',
  leg: 'нога',
  blast: 'осколки',
};
