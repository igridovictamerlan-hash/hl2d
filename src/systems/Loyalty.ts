import type { Character } from '../entities/Character';
import type { EventBus } from '../core/EventBus';
import { LOYALTY, type LoyaltyTier } from '../config/loyalty';
import { FACTIONS } from '../config/factions';

/** Уровень лояльности персонажа. */
export function loyaltyTier(c: Character): LoyaltyTier {
  let tier = LOYALTY.tiers[0];
  for (const t of LOYALTY.tiers) if (c.loyalty >= t.min) tier = t;
  return tier;
}

/** Лояльность есть только у тех, кого проверяют (граждане, ГСР); у вортигонтов её нет. */
export function hasLoyalty(c: Character): boolean {
  return !FACTIONS[c.faction].authority && c.faction !== 'rebel' && c.faction !== 'vort';
}

/** Изменить лояльность (в пределах); игроку — сообщение, смена уровня — отдельно. */
export function adjustLoyalty(c: Character, delta: number, why: string, bus?: EventBus): void {
  if (!hasLoyalty(c) || delta === 0) return;
  const before = loyaltyTier(c);
  c.loyalty = Math.max(LOYALTY.min, Math.min(LOYALTY.max, c.loyalty + delta));
  if (!c.isPlayer || !bus) return;
  bus.emit('log', { text: `Лояльность ${delta > 0 ? '+' : ''}${delta} (${why}) → ${c.loyalty}`, kind: 'system' });
  const after = loyaltyTier(c);
  if (after !== before) bus.emit('announce', { text: `Статус: ${after.name}` });
}

/** Есть ли у персонажа привилегия лоялиста (бег, очередь, охрана). */
export function loyalistPerk(c: Character, perk: 'run' | 'queue' | 'escort'): boolean {
  return hasLoyalty(c) && loyaltyTier(c).perks.includes(perk);
}
