/** Предметы, оружие и боеприпасы. Цены — в токенах (undefined — в магазине не продаётся). */
export type AmmoType = 'pistol' | 'smg' | 'ar2' | 'magnum' | 'buckshot' | 'bolt';
export type WeaponId = 'stunstick' | 'usp' | 'revolver' | 'mp7' | 'ar2' | 'spas12' | 'rebel_pistol' | 'rebel_smg' | 'crossbow';
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
  | 'ammo_357'
  | 'ammo_buckshot'
  | 'ammo_bolt'
  | 'fake_cid'
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

/** Класс оружия — от него зависят силуэт в руках, трассер и звук выстрела. */
export type WeaponClass = 'melee' | 'pistol' | 'magnum' | 'smg' | 'rifle' | 'shotgun' | 'crossbow';
/**
 * Режим огня: semi — выстрел на клик, auto — очередь, пока зажата кнопка,
 * pump — помповый (клик, долгая пауза между выстрелами), melee — удар.
 */
export type FireMode = 'semi' | 'auto' | 'pump' | 'melee';

/**
 * Оружие. Точность — как в Foxhole: конус разброса (полуугол, градусы) сужается от «от бедра»
 * (spreadHip) до «прицельно» (spreadAim) за aimTime секунд прицеливания (ПКМ; NPC целятся сами),
 * расширяется от движения (moveSpread, бег — сильнее) и отдачи (recoil за выстрел, спадает
 * со скоростью recovery). Пуля (дробина) всегда летит внутри нарисованного конуса.
 */
export interface WeaponDef {
  id: WeaponId;
  name: string;
  class: WeaponClass;
  mode: FireMode;
  /** Урон одной пули (дробины). */
  damage: number;
  /** Пуль за выстрел (дробь). */
  pellets: number;
  /** Выстрелов (ударов) в секунду. */
  fireRate: number;
  /** Предельная дальность, px — дуга на конце конуса. */
  range: number;
  /** До этой дальности урон полный, дальше линейно падает до falloff × урон на предельной. */
  effectiveRange: number;
  falloff: number;
  spreadHip: number;
  spreadAim: number;
  aimTime: number;
  /** + градусов разброса при ходьбе (при беге — больше, см. COMBAT.runSpreadMul). */
  moveSpread: number;
  recoil: number;
  recovery: number;
  maxRecoil: number;
  /** Магазин (0 — без патронов: ближний бой). */
  magazine: number;
  /** Перезарядка: секунд на магазин или на один патрон (perRound). */
  reload: number;
  perRound: boolean;
  ammo: AmmoType | null;
  /** Пробитие укрытий: снижает шанс, что бетонный блок остановит пулю (<0 — чаще останавливает). */
  penetration: number;
  /** Сколько секунд достаётся из-за спины (после смены оружия не выстрелить). */
  draw: number;
  /** Множитель скорости ходьбы при прицеливании. */
  aimMove: number;
  /** Слышимость выстрела, px. */
  noise: number;
  /** Оглушение при попадании, секунды (дубинка). */
  stun: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  stunstick: {
    id: 'stunstick', name: 'Дубинка', class: 'melee', mode: 'melee', damage: 10, pellets: 1, fireRate: 1.6,
    range: 30, effectiveRange: 30, falloff: 1, spreadHip: 40, spreadAim: 40, aimTime: 0.01, moveSpread: 0,
    recoil: 0, recovery: 0, maxRecoil: 0, magazine: 0, reload: 0, perRound: false, ammo: null,
    penetration: 0, draw: 0.25, aimMove: 1, noise: 0, stun: 1.6,
  },
  usp: {
    id: 'usp', name: 'USP Match', class: 'pistol', mode: 'semi', damage: 15, pellets: 1, fireRate: 4,
    range: 420, effectiveRange: 220, falloff: 0.5, spreadHip: 5, spreadAim: 1.2, aimTime: 0.45, moveSpread: 2.5,
    recoil: 1.6, recovery: 9, maxRecoil: 6, magazine: 18, reload: 1.4, perRound: false, ammo: 'pistol',
    penetration: 0, draw: 0.35, aimMove: 0.7, noise: 700, stun: 0,
  },
  revolver: {
    id: 'revolver', name: 'Револьвер .357', class: 'magnum', mode: 'semi', damage: 42, pellets: 1, fireRate: 1.4,
    range: 520, effectiveRange: 360, falloff: 0.6, spreadHip: 6, spreadAim: 0.5, aimTime: 0.8, moveSpread: 3.5,
    recoil: 7, recovery: 8, maxRecoil: 10, magazine: 6, reload: 2.6, perRound: false, ammo: 'magnum',
    penetration: 0.35, draw: 0.5, aimMove: 0.6, noise: 1000, stun: 0,
  },
  mp7: {
    id: 'mp7', name: 'MP7', class: 'smg', mode: 'auto', damage: 10, pellets: 1, fireRate: 10,
    range: 440, effectiveRange: 200, falloff: 0.4, spreadHip: 7, spreadAim: 2.8, aimTime: 0.5, moveSpread: 3,
    recoil: 0.9, recovery: 10, maxRecoil: 7, magazine: 45, reload: 1.8, perRound: false, ammo: 'smg',
    penetration: 0, draw: 0.4, aimMove: 0.65, noise: 800, stun: 0,
  },
  ar2: {
    id: 'ar2', name: 'AR2', class: 'rifle', mode: 'auto', damage: 20, pellets: 1, fireRate: 7,
    range: 580, effectiveRange: 380, falloff: 0.6, spreadHip: 5, spreadAim: 1.2, aimTime: 0.65, moveSpread: 2.5,
    recoil: 1.3, recovery: 8, maxRecoil: 6, magazine: 30, reload: 1.7, perRound: false, ammo: 'ar2',
    penetration: 0.35, draw: 0.6, aimMove: 0.6, noise: 950, stun: 0,
  },
  spas12: {
    id: 'spas12', name: 'SPAS-12', class: 'shotgun', mode: 'pump', damage: 8, pellets: 8, fireRate: 1.1,
    range: 280, effectiveRange: 90, falloff: 0.2, spreadHip: 9, spreadAim: 6, aimTime: 0.35, moveSpread: 2,
    recoil: 6, recovery: 10, maxRecoil: 8, magazine: 6, reload: 0.5, perRound: true, ammo: 'buckshot',
    penetration: -0.3, draw: 0.6, aimMove: 0.7, noise: 1000, stun: 0,
  },
  rebel_pistol: {
    id: 'rebel_pistol', name: 'Самодельный пистолет', class: 'pistol', mode: 'semi', damage: 13, pellets: 1, fireRate: 3,
    range: 400, effectiveRange: 180, falloff: 0.45, spreadHip: 7, spreadAim: 2, aimTime: 0.55, moveSpread: 3,
    recoil: 2.5, recovery: 7, maxRecoil: 8, magazine: 12, reload: 1.7, perRound: false, ammo: 'pistol',
    penetration: 0, draw: 0.4, aimMove: 0.7, noise: 700, stun: 0,
  },
  rebel_smg: {
    id: 'rebel_smg', name: 'Трофейный MP7', class: 'smg', mode: 'auto', damage: 10, pellets: 1, fireRate: 9,
    range: 440, effectiveRange: 190, falloff: 0.4, spreadHip: 9, spreadAim: 3.5, aimTime: 0.6, moveSpread: 3.5,
    recoil: 1.1, recovery: 9, maxRecoil: 9, magazine: 45, reload: 2.1, perRound: false, ammo: 'smg',
    penetration: 0, draw: 0.45, aimMove: 0.65, noise: 800, stun: 0,
  },
  crossbow: {
    id: 'crossbow', name: 'Арбалет', class: 'crossbow', mode: 'semi', damage: 80, pellets: 1, fireRate: 0.55,
    range: 720, effectiveRange: 720, falloff: 1, spreadHip: 9, spreadAim: 0.25, aimTime: 1.5, moveSpread: 6,
    recoil: 0, recovery: 0, maxRecoil: 0, magazine: 1, reload: 1.9, perRound: false, ammo: 'bolt',
    penetration: 0.6, draw: 0.7, aimMove: 0.45, noise: 350, stun: 0,
  },
};

/** Выстрелов в секунду → «урон в секунду» по незащищённой цели вплотную (для подсказки в инвентаре). */
export function weaponDps(w: WeaponDef): number {
  return w.damage * w.pellets * w.fireRate;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  ration: { id: 'ration', name: 'Рацион', desc: 'Стандартный паёк Альянса. Сытость +60.', kind: 'food', stack: 5, food: 60 },
  bread: { id: 'bread', name: 'Хлеб', desc: 'Серый хлеб. Сытость +25.', kind: 'food', stack: 5, food: 25, price: 6 },
  water: { id: 'water', name: 'Вода Breen', desc: 'Банка «воды». Сытость +10.', kind: 'food', stack: 5, food: 10, price: 3 },
  canned: { id: 'canned', name: 'Консервы', desc: 'Редкость. Сытость +45.', kind: 'food', stack: 5, food: 45, price: 14 },
  medkit: { id: 'medkit', name: 'Аптечка', desc: 'Лечение +40.', kind: 'medical', stack: 3, heal: 40, price: 28 },
  bandage: { id: 'bandage', name: 'Бинт', desc: 'Лечение +15.', kind: 'medical', stack: 5, heal: 15, price: 9 },
  cigarettes: { id: 'cigarettes', name: 'Сигареты', desc: 'Ходовая валюта «чёрного рынка».', kind: 'misc', stack: 10, price: 5 },
  fake_cid: { id: 'fake_cid', name: 'Поддельная CID', desc: 'С чёрного рынка: «чистая» карта — снимает розыск (повстанца в лицо всё равно узнают).', kind: 'misc', stack: 1 },
  toolkit: { id: 'toolkit', name: 'Набор инструментов', desc: 'Для ремонта (ГСР).', kind: 'tool', stack: 1, price: 20 },
  ammo_pistol: { id: 'ammo_pistol', name: 'Патроны 9 мм', desc: 'Для пистолетов.', kind: 'ammo', stack: 120, ammo: 'pistol' },
  ammo_smg: { id: 'ammo_smg', name: 'Патроны 4.6 мм', desc: 'Для MP7.', kind: 'ammo', stack: 180, ammo: 'smg' },
  ammo_ar2: { id: 'ammo_ar2', name: 'Энергоячейки AR2', desc: 'Для AR2.', kind: 'ammo', stack: 120, ammo: 'ar2' },
  ammo_357: { id: 'ammo_357', name: 'Патроны .357', desc: 'Для револьвера.', kind: 'ammo', stack: 36, ammo: 'magnum' },
  ammo_buckshot: { id: 'ammo_buckshot', name: 'Дробь 12 к.', desc: 'Для SPAS-12.', kind: 'ammo', stack: 48, ammo: 'buckshot' },
  ammo_bolt: { id: 'ammo_bolt', name: 'Болты', desc: 'Для арбалета.', kind: 'ammo', stack: 20, ammo: 'bolt' },
  stunstick: { id: 'stunstick', name: 'Дубинка', desc: 'Электродубинка ГО: бьёт и оглушает (замедляет).', kind: 'weapon', stack: 1 },
  usp: { id: 'usp', name: 'USP Match', desc: 'Табельный пистолет ГО.', kind: 'weapon', stack: 1 },
  revolver: { id: 'revolver', name: 'Револьвер .357', desc: 'Мощный, но 6 патронов и сильная отдача.', kind: 'weapon', stack: 1 },
  spas12: { id: 'spas12', name: 'SPAS-12', desc: 'Дробовик: страшен вблизи, бесполезен вдали.', kind: 'weapon', stack: 1 },
  crossbow: { id: 'crossbow', name: 'Арбалет', desc: 'Тихий и точный, но долго целиться и заряжать.', kind: 'weapon', stack: 1 },
  mp7: { id: 'mp7', name: 'MP7', desc: 'Пистолет-пулемёт ГО.', kind: 'weapon', stack: 1 },
  ar2: { id: 'ar2', name: 'AR2', desc: 'Импульсная винтовка Альянса (у повстанцев — трофейная): пробивает укрытия.', kind: 'weapon', stack: 1 },
  rebel_pistol: { id: 'rebel_pistol', name: 'Самодельный пистолет', desc: 'Оружие сопротивления.', kind: 'weapon', stack: 1 },
  rebel_smg: { id: 'rebel_smg', name: 'Трофейный MP7', desc: 'Отбит у ГО.', kind: 'weapon', stack: 1 },
};

export const AMMO_ITEM: Record<AmmoType, ItemId> = {
  pistol: 'ammo_pistol', smg: 'ammo_smg', ar2: 'ammo_ar2', magnum: 'ammo_357', buckshot: 'ammo_buckshot', bolt: 'ammo_bolt',
};

/** Стартовые наборы по ролям (и специализациям ГО). Первое оружие в списке — в руках. */
export const KITS: Record<string, [ItemId, number][]> = {
  citizen: [['water', 1]],
  cwu: [['toolkit', 1], ['bread', 1]],
  /** Повстанец-игрок: трофейный MP7 и пистолет про запас. */
  rebel: [['rebel_smg', 1], ['ammo_smg', 90], ['rebel_pistol', 1], ['ammo_pistol', 24], ['bandage', 1]],
  /** Повстанец-командир (ранг ≥ REBEL_OFFICER_RANK): трофейный AR2 и револьвер. */
  rebel_officer: [['ar2', 1], ['ammo_ar2', 90], ['revolver', 1], ['ammo_357', 18], ['bandage', 1]],
  cp: [['stunstick', 1], ['usp', 1], ['ammo_pistol', 54]],
  cp_grid: [['mp7', 1], ['ammo_smg', 135], ['usp', 1], ['ammo_pistol', 36], ['stunstick', 1], ['medkit', 1], ['bandage', 1]],
  cp_helix: [['usp', 1], ['ammo_pistol', 36], ['stunstick', 1], ['medkit', 2]],
  ota: [['ar2', 1], ['ammo_ar2', 120]],
  ota_shotgun: [['spas12', 1], ['ammo_buckshot', 36], ['usp', 1], ['ammo_pistol', 36]],
  admin: [['canned', 2]],
  /** Бойцы отрядов с пустошей: у всех автоматы (трофейные MP7 и AR2), пистолет — запасной. */
  rebel_raider: [['rebel_smg', 1], ['ammo_smg', 135], ['rebel_pistol', 1], ['ammo_pistol', 24]],
  rebel_rifleman: [['ar2', 1], ['ammo_ar2', 90], ['rebel_pistol', 1], ['ammo_pistol', 24]],
  rebel_shotgunner: [['spas12', 1], ['ammo_buckshot', 30], ['rebel_smg', 1], ['ammo_smg', 90]],
  rebel_marksman: [['crossbow', 1], ['ammo_bolt', 12], ['rebel_smg', 1], ['ammo_smg', 90]],
  rebel_commander: [['ar2', 1], ['ammo_ar2', 90], ['revolver', 1], ['ammo_357', 18]],
};

/** С какого ранга повстанец-игрок получает револьвер. */
export const REBEL_OFFICER_RANK = 3;
