import type { Character } from '../entities/Character';
import type { Stack } from '../entities/Inventory';
import { ITEMS, type GearId, type GearSlot, type ItemId } from '../config/items';
import { ECONOMY } from '../config/economy';
import { CLOTHES, CLOTH_SLOTS, type ClothSlot, type ClothesLook, type ClothTier } from '../config/clothes';

const TIERS: readonly ClothTier[] = ['poor', 'middle', 'rich'];
/** Порядок сборки комплекта: низ, верх, шея, убор, обувь (поношенность — от верха поверх низа). */
const ORDER: readonly ClothSlot[] = ['top', 'outer', 'neck', 'hat', 'feet'];

/**
 * Комплект пешки из надетой одежды (низ и/или верх; без них — undefined: одежда фракции). Достаток комплекта — по
 * низу, иначе по верху. Поношенность складывается (заплаты, дыры, пятна — что больше).
 */
export function clothesOf(gear: Character['gear']): ClothesLook | undefined {
  if (!gear.top && !gear.outer) return undefined;
  const base = (gear.top ?? gear.outer)!;
  const look: ClothesLook = { tier: ITEMS[base].gear?.tier ?? 'middle', top: 'tee', topColor: CLOTHES.defaultTop };
  for (const slot of ORDER) {
    const id = gear[slot];
    const piece = id ? ITEMS[id].gear?.cloth : undefined;
    if (!piece) continue;
    const { patches, holes, stains, ...rest } = piece;
    Object.assign(look, rest);
    if (patches) look.patches = [...(look.patches ?? []), ...patches];
    if (holes) look.holes = Math.max(look.holes ?? 0, holes);
    if (stains) look.stains = Math.max(look.stains ?? 0, stains);
  }
  return look;
}

/** Пересобрать комплект пешки после смены одежды (Character.clothes и ключ кэша спрайтов). */
export function refreshClothes(c: Character): void {
  c.clothes = clothesOf(c.gear) ?? null;
  c.clothesKey = c.clothes ? CLOTH_SLOTS.map((s) => c.gear[s] ?? '').join('|') : '';
}

/** Надеть вещь без инвентаря (заселение, покупка NPC): прежняя в этом слоте выброшена. */
export function dressIn(c: Character, id: GearId): void {
  const g = ITEMS[id].gear;
  if (!g) return;
  c.gear[g.slot] = id;
  if (g.slot === 'top' || g.slot === 'outer' || g.slot === 'torso') c.bloodyUntil = 0;
  refreshClothes(c);
  // В деле роли — возродится в том же.
  if (c.role) c.role.outfit = CLOTH_SLOTS.map((s) => c.gear[s]).filter((x): x is GearId => !!x);
}

/** Носит ли NPC гражданскую одежду (горожанин без своей одежды профессии). */
export function wearsClothes(c: Character): boolean {
  return c.faction === 'citizen' && (!c.profession || CLOTHES.npc.professions.includes(c.profession));
}

/** Достаток вещи: 0 — бедное, 1 — среднее, 2 — богатое. */
export function tierRank(t: ClothTier | undefined): number {
  return Math.max(0, TIERS.indexOf(t ?? 'middle'));
}

/**
 * Снаряжение: шлем, бронежилет, рюкзак надеваются из инвентаря в слоты пешки (Character.gear) и
 * снимаются обратно. Броня надетого заменяет броню формы роли, если крепче (wounds.armorOf); рюкзак
 * добавляет ячейки инвентаря. Надетое — не в ячейках; при гибели всё остаётся на теле (gearLoot).
 */
export function isGear(id: ItemId): id is GearId {
  return !!ITEMS[id].gear;
}

/** Вместимость инвентаря с учётом рюкзака. */
export function capacityOf(c: Character): number {
  let n = ECONOMY.inventorySlots;
  for (const id of Object.values(c.gear)) if (id) n += ITEMS[id].gear?.capacity ?? 0;
  return n;
}

/** Броня надетого по зонам (0 — ничего). */
export function wornArmor(c: Character): { head: number; torso: number } {
  let head = 0;
  let torso = 0;
  for (const id of Object.values(c.gear)) {
    const g = id ? ITEMS[id].gear : undefined;
    if (!g) continue;
    head = Math.max(head, g.head ?? 0);
    torso = Math.max(torso, g.torso ?? 0);
  }
  return { head, torso };
}

/** Надеть предмет из инвентаря; в слоте что-то было — оно в инвентарь. null — удалось, иначе причина. */
export function wear(c: Character, id: GearId): string | null {
  const g = ITEMS[id].gear;
  if (!g) return 'Это не надеть.';
  if (!c.inventory.has(id)) return 'Этого нет в инвентаре.';
  const prev = c.gear[g.slot];
  c.inventory.remove(id, 1);
  c.gear[g.slot] = id;
  c.inventory.capacity = capacityOf(c);
  if (prev && c.inventory.add(prev, 1) < 1) {
    // Некуда убрать прежнее — вернуть как было.
    c.gear[g.slot] = prev;
    c.inventory.capacity = capacityOf(c);
    c.inventory.add(id, 1);
    return 'Некуда убрать то, что надето сейчас.';
  }
  // Свежая одежда на корпус: кровь с прежней смыта (Character.bloodyUntil — по часам закона).
  if (g.slot === 'torso' || g.slot === 'top' || g.slot === 'outer') c.bloodyUntil = 0;
  refreshClothes(c);
  return null;
}

/** Снять из слота в инвентарь. Рюкзак не снять, если без него вещи не помещаются. */
export function takeOff(c: Character, slot: GearSlot): string | null {
  const id = c.gear[slot];
  if (!id) return 'Ничего не надето.';
  delete c.gear[slot];
  const cap = capacityOf(c);
  if (c.inventory.slots.length + 1 > cap) {
    c.gear[slot] = id;
    return 'Не помещается: освободите ячейку.';
  }
  c.inventory.capacity = cap;
  c.inventory.add(id, 1);
  refreshClothes(c);
  return null;
}

/** Снять всё надетое (на тело при гибели). */
export function gearLoot(c: Character): Stack[] {
  const out: Stack[] = [];
  for (const id of Object.values(c.gear)) if (id) out.push({ id, qty: 1 });
  c.gear = {};
  c.inventory.capacity = ECONOMY.inventorySlots;
  refreshClothes(c);
  return out;
}
