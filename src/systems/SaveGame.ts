import type { Character } from '../entities/Character';
import type { FactionId, DivisionId } from '../config/factions';
import type { Stack } from '../entities/Inventory';
import type { ItemId, WeaponId } from '../config/items';
import { ITEMS, WEAPONS } from '../config/items';
import { FACTIONS } from '../config/factions';

/**
 * Сохранение игрока (формат версии 1): карта (seed), роль, личность, деньги, лояльность,
 * здоровье, сытость, инвентарь и оружие, статус CID, позиция, знание карты (исследованная
 * канализация, найденные люки). Чистые функции — хранилище (localStorage) задаёт Game.
 */
export interface SaveData {
  format: 'hl2d-save';
  version: 1;
  savedAt: number;
  seed: number;
  role: { faction: FactionId; rank: number; division: DivisionId | null };
  name: string;
  civilName: string;
  cid: string;
  money: number;
  loyalty: number;
  health: number;
  hunger: number;
  inventory: Stack[];
  weapon: WeaponId | null;
  mag: number;
  mags: Partial<Record<WeaponId, number>>;
  law: { hasCid: boolean; wanted: boolean };
  pos: { x: number; y: number } | null;
  explored: string;
  hatches: number[];
}

export function capturePlayer(
  p: Character,
  seed: number,
  role: SaveData['role'],
  civilName: string,
  knowledge: { explored: Uint8Array; hatches: Iterable<number> },
  now = Date.now(),
): SaveData {
  // Задержанный «сбежать» перезагрузкой не может: он в розыске.
  const caught = p.law.phase !== 'none';
  return {
    format: 'hl2d-save',
    version: 1,
    savedAt: now,
    seed,
    role,
    name: p.name,
    civilName,
    cid: p.cid,
    money: p.money,
    loyalty: p.loyalty,
    health: Math.max(1, Math.round(p.health)),
    hunger: Math.round(p.hunger),
    inventory: p.inventory.slots.map((s) => ({ id: s.id, qty: s.qty })),
    weapon: p.weapon,
    mag: p.mag,
    mags: { ...p.mags },
    law: { hasCid: p.law.hasCid, wanted: p.law.wanted || caught },
    pos: caught ? null : { x: Math.round(p.x), y: Math.round(p.y) },
    explored: encodeBits(knowledge.explored),
    hatches: [...knowledge.hatches],
  };
}

/** Проверка и разбор сохранения; null — повреждено или чужой формат. */
export function parseSave(text: string | null): SaveData | null {
  if (!text) return null;
  try {
    const d = JSON.parse(text) as SaveData;
    if (d.format !== 'hl2d-save' || d.version !== 1 || !Number.isFinite(d.seed)) return null;
    if (!d.role || !(d.role.faction in FACTIONS) || !FACTIONS[d.role.faction].selectable) return null;
    if (!Array.isArray(d.inventory)) return null;
    d.inventory = d.inventory.filter((s) => s && s.id in ITEMS && Number.isFinite(s.qty) && s.qty > 0);
    if (d.weapon && !(d.weapon in WEAPONS)) d.weapon = null;
    return d;
  } catch {
    return null;
  }
}

/** Вернуть игроку сохранённое (после того как роль уже применена). */
export function applyToPlayer(p: Character, d: SaveData): void {
  p.name = d.name || p.name;
  p.cid = d.cid || p.cid;
  p.money = Math.max(0, Math.floor(d.money));
  p.loyalty = d.loyalty ?? p.loyalty;
  p.health = Math.min(p.maxHealth, Math.max(1, d.health));
  p.hunger = Math.max(0, Math.min(100, d.hunger));
  p.inventory.clear();
  for (const s of d.inventory) p.inventory.add(s.id as ItemId, s.qty);
  p.mags = { ...(d.mags ?? {}) };
  p.weapon = d.weapon && p.inventory.has(d.weapon) ? d.weapon : null;
  p.mag = p.weapon ? Math.max(0, Math.min(WEAPONS[p.weapon].magazine, d.mag)) : 0;
  p.law.hasCid = d.law?.hasCid ?? true;
  p.law.wanted = d.law?.wanted ?? false;
}

/** Битовая маска → base64 и обратно. */
export function encodeBits(bytes: Uint8Array): string {
  const packed = new Uint8Array(Math.ceil(bytes.length / 8));
  for (let i = 0; i < bytes.length; i++) if (bytes[i]) packed[i >> 3] |= 1 << (i & 7);
  let s = '';
  for (let i = 0; i < packed.length; i++) s += String.fromCharCode(packed[i]);
  return btoa(s);
}

export function decodeBits(text: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  try {
    const s = atob(text);
    for (let i = 0; i < length; i++) out[i] = (s.charCodeAt(i >> 3) >> (i & 7)) & 1;
  } catch {
    /* повреждено — пусто */
  }
  return out;
}
