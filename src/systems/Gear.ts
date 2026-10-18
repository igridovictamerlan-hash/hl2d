import type { Character } from '../entities/Character';
import type { Stack } from '../entities/Inventory';
import { ITEMS, type GearId, type GearSlot, type ItemId } from '../config/items';
import { ECONOMY } from '../config/economy';

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
  if (g.slot === 'torso') c.bloodyUntil = 0;
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
  return null;
}

/** Снять всё надетое (на тело при гибели). */
export function gearLoot(c: Character): Stack[] {
  const out: Stack[] = [];
  for (const id of Object.values(c.gear)) if (id) out.push({ id, qty: 1 });
  c.gear = {};
  c.inventory.capacity = ECONOMY.inventorySlots;
  return out;
}
