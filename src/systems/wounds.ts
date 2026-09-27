import type { Character } from '../entities/Character';
import type { Rng } from '../core/rng';
import { ARMOR, HITS, type ArmorProfile, type HitZone } from '../config/combat';
import { cpUnit } from '../config/factions';

/**
 * Броня персонажа по зонам: силовой блок — по юниту, OTA и армия сопротивления — по профессии,
 * остальные (граждане, ГСР, бандиты, партизаны, новобранцы) — без брони. Спецагент в чужой форме
 * брони не получает: форма, а не бронежилет.
 */
export function armorOf(c: Character): ArmorProfile {
  if (c.faction === 'cp') return ARMOR.cp[cpUnit(c.rank).unit] ?? ARMOR.none;
  if (c.profession) return ARMOR.profession[c.profession] ?? ARMOR.none;
  return ARMOR.none;
}

const ZONES: HitZone[] = ['head', 'torso', 'arm', 'leg'];

/** Куда попала пуля: по весам HITS.weights, прицелившийся (aim 0..1) чаще попадает в голову. */
export function rollZone(rng: Rng, aim: number): HitZone {
  const W = HITS.weights;
  const head = W.head + HITS.headAim * aim;
  const total = head + W.torso + W.arm + W.leg;
  let r = rng.next() * total;
  for (const z of ZONES) {
    r -= z === 'head' ? head : W[z];
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
