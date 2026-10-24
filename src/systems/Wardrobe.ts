import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Rng } from '../core/rng';
import { CLOTHES, CLOTH_ITEMS, type ClothItem, type ClothSlot, type ClothTier } from '../config/clothes';
import { LOYALTY } from '../config/loyalty';
import { dressIn, tierRank, wearsClothes } from './Gear';
import { female } from './phrases';

const TIERS: readonly ClothTier[] = ['poor', 'middle', 'rich'];

/**
 * Гардероб горожан: при заселении каждый горожанин (Gear.wearsClothes) одет по достатку дома — Слобода бедно,
 * Старый город средне, Верхний город и особняки богато (лоялист — на ступень богаче с шансом CLOTHES.npc.loyalUp):
 * низ и обувь всегда, верх, убор и шея — с шансами CLOTHES.npc. Вещи — из каталога (config/clothes.ts) своего
 * достатка или ступенью ниже, по полу (who), цвет наугад. Одежда — в Character.gear и в деле роли (RoleSpec.outfit):
 * возродившийся — в том же. Бандиты, авторитеты и воры — по-своему (CLOTHES.npc.crooks): капюшон, платок на лице. Своя случайность (rng.fork) — общая случайность мира не сдвигается.
 */
export class Wardrobe {
  enabled = true;
  private readonly rng: Rng;
  readonly stats = { dressed: 0, bought: 0 };

  constructor(private readonly ctx: AiContext) {
    this.rng = ctx.rng.fork(0xc107e5);
  }

  /** Достаток жителя: полоса его дома (особняк — богатый), без дома — где стоит. */
  tierOf(c: Character): ClothTier {
    const d = c.home !== undefined && c.home !== null ? this.ctx.housing?.dwellings[c.home] : undefined;
    if (d?.kind === 'villa') return 'rich';
    const at = d?.spots[0] ?? c;
    const band = this.ctx.map.districtAtWorld(at.x, at.y);
    let t: ClothTier = band === 'slum' ? 'poor' : band === 'upper' ? 'rich' : 'middle';
    if (c.loyalty >= LOYALTY.uniform.min && t !== 'rich' && this.rng.chance(CLOTHES.npc.loyalUp)) t = TIERS[tierRank(t) + 1];
    return t;
  }

  /** Вещь слота: своего достатка (втрое чаще) или ступенью ниже, по полу; цвет наугад. */
  private pick(slot: ClothSlot, tier: ClothTier, fem: boolean, crook = false): ClothItem | null {
    const r = tierRank(tier);
    const list = CLOTH_ITEMS.filter((it) => {
      const f = it.fashion;
      if (!!f.crook !== crook) return false;
      if (crook) return f.slot === slot;
      const d = r - tierRank(f.tier);
      return f.slot === slot && (d === 0 || d === 1) && (!f.who || (f.who === 'f') === fem);
    });
    if (!list.length) return null;
    let total = 0;
    for (const it of list) total += tierRank(it.fashion.tier) === r ? 3 : 1;
    let x = this.rng.next() * total;
    for (const it of list) {
      x -= tierRank(it.fashion.tier) === r ? 3 : 1;
      if (x <= 0) return it;
    }
    return list[list.length - 1];
  }

  /** Одеть горожанина по достатку (если он носит гражданское и ещё не одет). */
  dress(c: Character): void {
    if (!this.enabled || !wearsClothes(c) || c.clothes) return;
    const N = CLOTHES.npc;
    // Бандит, авторитет, вор: достаток наугад из своего списка, капюшон и платок на лице — с шансом.
    const crook = c.profession ? N.crooks[c.profession] : undefined;
    const tier = crook ? this.rng.pick(crook.tiers) : this.tierOf(c);
    const fem = female(c);
    const hood = !!crook && this.rng.chance(crook.hood);
    const mask = !!crook && this.rng.chance(crook.mask);
    const slots: ClothSlot[] = ['top', 'feet'];
    if (this.rng.chance(N.outer[tier])) slots.push('outer');
    if (!hood && this.rng.chance(N.hat[tier])) slots.push('hat');
    if (!mask && this.rng.chance(N.neck[tier])) slots.push('neck');
    for (const s of slots) {
      const it = this.pick(s, tier, fem);
      if (it) dressIn(c, it.id);
    }
    for (const s of [hood ? 'hat' : null, mask ? 'neck' : null] as const) {
      const it = s ? this.pick(s, tier, fem, true) : null;
      if (it) dressIn(c, it.id);
    }
    if (c.clothes) this.stats.dressed++;
  }

  /** Одеть всех горожан (в конце заселения, когда у всех есть дом). */
  dressAll(): void {
    if (!this.enabled) return;
    for (const c of this.ctx.entities.list) if (!c.isPlayer) this.dress(c);
  }
}
