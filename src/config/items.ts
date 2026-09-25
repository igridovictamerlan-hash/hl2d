/** Предметы, оружие и боеприпасы. Цены — в токенах (undefined — в магазине не продаётся). */
export type AmmoType = 'pistol' | 'smg' | 'ar2';
export type WeaponId = 'usp' | 'mp7' | 'ar2' | 'rebel_pistol' | 'rebel_smg';
export type ItemId =
  | 'ration'
  | 'bread'
  | 'water'
  | 'canned'
  | 'medkit'
  | 'bandage'
  | 'cigarettes'
  | 'toolkit'
  | 'ammo_pistol'
  | 'ammo_smg'
  | 'ammo_ar2'
  | WeaponId;

export type ItemKind = 'food' | 'medical' | 'weapon' | 'ammo' | 'tool' | 'misc';

export interface ItemDef {
  id: ItemId;
  name: string;
  desc: string;
  kind: ItemKind;
  /** Сколько штук в одной ячейке. */
  stack: number;
  /** Сытость при употреблении. */
  food?: number;
  /** Лечение при использовании. */
  heal?: number;
  price?: number;
  ammo?: AmmoType;
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  damage: number;
  /** Выстрелов в секунду. */
  fireRate: number;
  range: number;
  /** Разброс, градусы (половина конуса). */
  spread: number;
  magazine: number;
  reload: number;
  ammo: AmmoType;
  /** Автоматический огонь при зажатой кнопке. */
  auto: boolean;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  usp: { id: 'usp', name: 'USP Match', damage: 14, fireRate: 3.5, range: 360, spread: 3.5, magazine: 18, reload: 1.4, ammo: 'pistol', auto: false },
  mp7: { id: 'mp7', name: 'MP7', damage: 9, fireRate: 9, range: 380, spread: 6.5, magazine: 45, reload: 1.8, ammo: 'smg', auto: true },
  ar2: { id: 'ar2', name: 'AR2', damage: 19, fireRate: 7, range: 440, spread: 2.5, magazine: 30, reload: 1.6, ammo: 'ar2', auto: true },
  rebel_pistol: { id: 'rebel_pistol', name: 'Самодельный пистолет', damage: 12, fireRate: 2.8, range: 380, spread: 5, magazine: 12, reload: 1.6, ammo: 'pistol', auto: false },
  rebel_smg: { id: 'rebel_smg', name: 'Трофейный MP7', damage: 9, fireRate: 8, range: 380, spread: 8, magazine: 45, reload: 2, ammo: 'smg', auto: true },
};

export const ITEMS: Record<ItemId, ItemDef> = {
  ration: { id: 'ration', name: 'Рацион', desc: 'Стандартный паёк Альянса. Сытость +60.', kind: 'food', stack: 5, food: 60 },
  bread: { id: 'bread', name: 'Хлеб', desc: 'Серый хлеб. Сытость +25.', kind: 'food', stack: 5, food: 25, price: 6 },
  water: { id: 'water', name: 'Вода Breen', desc: 'Банка «воды». Сытость +10.', kind: 'food', stack: 5, food: 10, price: 3 },
  canned: { id: 'canned', name: 'Консервы', desc: 'Редкость. Сытость +45.', kind: 'food', stack: 5, food: 45, price: 14 },
  medkit: { id: 'medkit', name: 'Аптечка', desc: 'Лечение +40.', kind: 'medical', stack: 3, heal: 40, price: 28 },
  bandage: { id: 'bandage', name: 'Бинт', desc: 'Лечение +15.', kind: 'medical', stack: 5, heal: 15, price: 9 },
  cigarettes: { id: 'cigarettes', name: 'Сигареты', desc: 'Ходовая валюта «чёрного рынка».', kind: 'misc', stack: 10, price: 5 },
  toolkit: { id: 'toolkit', name: 'Набор инструментов', desc: 'Для ремонта (ГСР).', kind: 'tool', stack: 1, price: 20 },
  ammo_pistol: { id: 'ammo_pistol', name: 'Патроны 9 мм', desc: 'Для пистолетов.', kind: 'ammo', stack: 120, ammo: 'pistol' },
  ammo_smg: { id: 'ammo_smg', name: 'Патроны 4.6 мм', desc: 'Для MP7.', kind: 'ammo', stack: 180, ammo: 'smg' },
  ammo_ar2: { id: 'ammo_ar2', name: 'Энергоячейки AR2', desc: 'Для AR2.', kind: 'ammo', stack: 120, ammo: 'ar2' },
  usp: { id: 'usp', name: 'USP Match', desc: 'Табельный пистолет ГО.', kind: 'weapon', stack: 1 },
  mp7: { id: 'mp7', name: 'MP7', desc: 'Пистолет-пулемёт ГО.', kind: 'weapon', stack: 1 },
  ar2: { id: 'ar2', name: 'AR2', desc: 'Импульсная винтовка OTA.', kind: 'weapon', stack: 1 },
  rebel_pistol: { id: 'rebel_pistol', name: 'Самодельный пистолет', desc: 'Оружие сопротивления.', kind: 'weapon', stack: 1 },
  rebel_smg: { id: 'rebel_smg', name: 'Трофейный MP7', desc: 'Отбит у ГО.', kind: 'weapon', stack: 1 },
};

export const AMMO_ITEM: Record<AmmoType, ItemId> = { pistol: 'ammo_pistol', smg: 'ammo_smg', ar2: 'ammo_ar2' };

/** Стартовые наборы по ролям (и специализациям ГО). */
export const KITS: Record<string, [ItemId, number][]> = {
  citizen: [['water', 1]],
  cwu: [['toolkit', 1], ['bread', 1]],
  rebel: [['rebel_pistol', 1], ['ammo_pistol', 36], ['bandage', 1]],
  cp: [['usp', 1], ['ammo_pistol', 54]],
  cp_grid: [['mp7', 1], ['ammo_smg', 135], ['usp', 1], ['ammo_pistol', 36]],
  cp_helix: [['usp', 1], ['ammo_pistol', 36], ['medkit', 2]],
  ota: [['ar2', 1], ['ammo_ar2', 120]],
  admin: [['canned', 2]],
  rebel_raider: [['rebel_pistol', 1], ['ammo_pistol', 48]],
  rebel_raider_smg: [['rebel_smg', 1], ['ammo_smg', 135]],
};
