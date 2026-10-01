/** Предметы, оружие и боеприпасы. Цены — в токенах (undefined — в магазине не продаётся). */
export type AmmoType = 'pistol' | 'smg' | 'ar2' | 'magnum' | 'buckshot' | 'bolt' | 'r556' | 'r545' | 'r338' | 'rocket';
export type WeaponId =
  | 'stunstick' | 'knife' | 'usp' | 'revolver' | 'mp7' | 'ar2' | 'spas12' | 'rebel_pistol' | 'rebel_smg' | 'crossbow'
  | 'm4a4' | 'ak74' | 'sniper' | 'rpg';
/** Гранаты: осколочная, дымовая, зажигательная. */
export type GrenadeId = 'grenade' | 'smoke_grenade' | 'fire_grenade';
export type ItemId =
  | 'ration'
  | 'parcel'
  | 'parcel_x'
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
  | 'ammo_556'
  | 'ammo_545'
  | 'ammo_338'
  | 'ammo_rocket'
  | 'fake_cid'
  | GrenadeId
  | 'lockpick'
  | GearId
  | WeaponId;

/** Снаряжение, которое можно надеть (слоты пешки в инвентаре). */
export type GearId = 'helmet' | 'helmet_cp' | 'vest' | 'plate_vest' | 'backpack';
/** Куда надевается: голова, корпус, спина. */
export type GearSlot = 'head' | 'torso' | 'back';
export interface GearDef {
  slot: GearSlot;
  /** Броня зоны (0..1): надетое заменяет форму роли, если крепче. */
  head?: number;
  torso?: number;
  /** Рюкзак: сколько ячеек инвентаря добавляет. */
  capacity?: number;
  /** Цвет на пешке. */
  color: string;
}

export type ItemKind = 'food' | 'medical' | 'weapon' | 'ammo' | 'tool' | 'gear' | 'misc';

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
  /** Надевается (шлем, бронежилет, рюкзак). */
  gear?: GearDef;
}

/**
 * Класс оружия — от него зависят пуля (вид и скорость), звук выстрела и хват: melee — дубинка,
 * blade — нож, rifle — автоматы (M4A4, AK-74), pulse — импульсная винтовка AR2, sniper — снайперская
 * винтовка, launcher — РПГ.
 */
export type WeaponClass = 'melee' | 'blade' | 'pistol' | 'magnum' | 'smg' | 'rifle' | 'pulse' | 'shotgun' | 'crossbow' | 'sniper' | 'launcher';
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
  /** Скорость пули (болта, ракеты), px/с. */
  speed: number;
  /** Бронебойность 0..1: какую долю защиты шлема и жилета пуля «не замечает». */
  pierce: number;
  /**
   * Отдача как увод ствола: kick — градусов за выстрел (вверх по экрану не бывает — ствол уводит
   * вбок: сначала в одну сторону, kickSide — доля случайного разворота), kickMax — предел увода;
   * спадает вместе с recoil (recovery градусов/с). Игроку ещё и толчок камеры (shake).
   */
  kick: number;
  kickSide: number;
  kickMax: number;
  shake: number;
  /** Удар ножом в спину — × этот множитель и без брони (0 — не нож). */
  backstab?: number;
  /** РПГ: ракета взрывается при попадании (радиус и урон — GRENADE × blastMul). */
  blastMul?: number;
}

/** Общие поля: пробитие укрытий, скорость и т.п. задаются у каждого ствола. */
const W = (d: WeaponDef): WeaponDef => d;

/**
 * Урон — одной пули в корпус без брони (гражданин — 100 HP: пистолет — 2 попадания, винтовка — 1–2).
 * Голова без шлема — смерть от любого огнестрела (COMBAT.hits), руки и ноги — меньше, но кровотечение.
 */
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  stunstick: W({
    id: 'stunstick', name: 'Дубинка', class: 'melee', mode: 'melee', damage: 12, pellets: 1, fireRate: 1.6,
    range: 30, effectiveRange: 30, falloff: 1, spreadHip: 40, spreadAim: 40, aimTime: 0.01, moveSpread: 0,
    recoil: 0, recovery: 0, maxRecoil: 0, magazine: 0, reload: 0, perRound: false, ammo: null,
    penetration: 0, draw: 0.25, aimMove: 1, noise: 0, stun: 1.6, speed: 0, pierce: 0, kick: 0, kickSide: 0, kickMax: 0, shake: 1.5,
  }),
  knife: W({
    id: 'knife', name: 'Нож', class: 'blade', mode: 'melee', damage: 32, pellets: 1, fireRate: 1.8,
    range: 22, effectiveRange: 22, falloff: 1, spreadHip: 35, spreadAim: 35, aimTime: 0.01, moveSpread: 0,
    recoil: 0, recovery: 0, maxRecoil: 0, magazine: 0, reload: 0, perRound: false, ammo: null,
    penetration: 0, draw: 0.15, aimMove: 1, noise: 0, stun: 0.4, speed: 0, pierce: 0.5, kick: 0, kickSide: 0, kickMax: 0, shake: 2.5,
    backstab: 1.75,
  }),
  usp: W({
    id: 'usp', name: 'USP Match', class: 'pistol', mode: 'semi', damage: 52, pellets: 1, fireRate: 4,
    range: 420, effectiveRange: 200, falloff: 0.5, spreadHip: 5, spreadAim: 1.2, aimTime: 0.45, moveSpread: 2.5,
    recoil: 1.8, recovery: 9, maxRecoil: 6, magazine: 18, reload: 1.4, perRound: false, ammo: 'pistol',
    penetration: 0, draw: 0.35, aimMove: 0.7, noise: 1500, stun: 0, speed: 1500, pierce: 0.1, kick: 2.2, kickSide: 0.5, kickMax: 7, shake: 1.6,
  }),
  revolver: W({
    id: 'revolver', name: 'Револьвер .357', class: 'magnum', mode: 'semi', damage: 85, pellets: 1, fireRate: 1.4,
    range: 520, effectiveRange: 340, falloff: 0.6, spreadHip: 6, spreadAim: 0.5, aimTime: 0.8, moveSpread: 3.5,
    recoil: 7, recovery: 8, maxRecoil: 10, magazine: 6, reload: 2.6, perRound: false, ammo: 'magnum',
    penetration: 0.35, draw: 0.5, aimMove: 0.6, noise: 2000, stun: 0, speed: 1700, pierce: 0.35, kick: 7, kickSide: 0.4, kickMax: 12, shake: 4,
  }),
  mp7: W({
    id: 'mp7', name: 'MP7', class: 'smg', mode: 'auto', damage: 38, pellets: 1, fireRate: 11,
    range: 440, effectiveRange: 200, falloff: 0.45, spreadHip: 7, spreadAim: 2.6, aimTime: 0.5, moveSpread: 3,
    recoil: 0.8, recovery: 10, maxRecoil: 7, magazine: 40, reload: 1.8, perRound: false, ammo: 'smg',
    penetration: 0, draw: 0.4, aimMove: 0.65, noise: 1600, stun: 0, speed: 1800, pierce: 0.4, kick: 1.1, kickSide: 0.35, kickMax: 8, shake: 1.2,
  }),
  rebel_smg: W({
    id: 'rebel_smg', name: 'Трофейный MP7', class: 'smg', mode: 'auto', damage: 36, pellets: 1, fireRate: 10,
    range: 440, effectiveRange: 190, falloff: 0.4, spreadHip: 9, spreadAim: 3.4, aimTime: 0.6, moveSpread: 3.5,
    recoil: 1, recovery: 9, maxRecoil: 9, magazine: 40, reload: 2.1, perRound: false, ammo: 'smg',
    penetration: 0, draw: 0.45, aimMove: 0.65, noise: 1600, stun: 0, speed: 1750, pierce: 0.35, kick: 1.3, kickSide: 0.45, kickMax: 9, shake: 1.3,
  }),
  m4a4: W({
    id: 'm4a4', name: 'M4A4', class: 'rifle', mode: 'auto', damage: 62, pellets: 1, fireRate: 11,
    range: 620, effectiveRange: 420, falloff: 0.6, spreadHip: 6, spreadAim: 1.1, aimTime: 0.6, moveSpread: 3,
    recoil: 1.2, recovery: 9, maxRecoil: 7, magazine: 30, reload: 2.2, perRound: false, ammo: 'r556',
    penetration: 0.3, draw: 0.55, aimMove: 0.6, noise: 2400, stun: 0, speed: 2600, pierce: 0.45, kick: 1.5, kickSide: 0.3, kickMax: 9, shake: 1.8,
  }),
  ak74: W({
    id: 'ak74', name: 'АК-74', class: 'rifle', mode: 'auto', damage: 66, pellets: 1, fireRate: 10,
    range: 620, effectiveRange: 400, falloff: 0.6, spreadHip: 7, spreadAim: 1.4, aimTime: 0.65, moveSpread: 3.2,
    recoil: 1.5, recovery: 8, maxRecoil: 8, magazine: 30, reload: 2.4, perRound: false, ammo: 'r545',
    penetration: 0.35, draw: 0.6, aimMove: 0.6, noise: 2400, stun: 0, speed: 2500, pierce: 0.5, kick: 1.9, kickSide: 0.45, kickMax: 11, shake: 2.1,
  }),
  ar2: W({
    id: 'ar2', name: 'Импульсная винтовка ИВЛ', class: 'pulse', mode: 'auto', damage: 70, pellets: 1, fireRate: 8,
    range: 640, effectiveRange: 440, falloff: 0.7, spreadHip: 5, spreadAim: 1, aimTime: 0.6, moveSpread: 2.5,
    recoil: 1.1, recovery: 9, maxRecoil: 6, magazine: 30, reload: 1.7, perRound: false, ammo: 'ar2',
    penetration: 0.55, draw: 0.6, aimMove: 0.6, noise: 2200, stun: 0, speed: 2200, pierce: 0.6, kick: 1.2, kickSide: 0.3, kickMax: 7, shake: 1.8,
  }),
  spas12: W({
    id: 'spas12', name: 'SPAS-12', class: 'shotgun', mode: 'pump', damage: 20, pellets: 8, fireRate: 1.1,
    range: 300, effectiveRange: 100, falloff: 0.2, spreadHip: 9, spreadAim: 6, aimTime: 0.35, moveSpread: 2,
    recoil: 6, recovery: 10, maxRecoil: 8, magazine: 6, reload: 0.5, perRound: true, ammo: 'buckshot',
    penetration: -0.3, draw: 0.6, aimMove: 0.7, noise: 2400, stun: 0, speed: 1300, pierce: 0, kick: 6, kickSide: 0.5, kickMax: 10, shake: 4.5,
  }),
  rebel_pistol: W({
    id: 'rebel_pistol', name: 'Самодельный пистолет', class: 'pistol', mode: 'semi', damage: 48, pellets: 1, fireRate: 2.6,
    range: 380, effectiveRange: 170, falloff: 0.45, spreadHip: 7, spreadAim: 2, aimTime: 0.55, moveSpread: 3,
    recoil: 2.6, recovery: 7, maxRecoil: 8, magazine: 10, reload: 1.9, perRound: false, ammo: 'pistol',
    penetration: 0, draw: 0.4, aimMove: 0.7, noise: 1500, stun: 0, speed: 1300, pierce: 0, kick: 3, kickSide: 0.6, kickMax: 9, shake: 2,
  }),
  sniper: W({
    id: 'sniper', name: 'Снайперская винтовка', class: 'sniper', mode: 'pump', damage: 170, pellets: 1, fireRate: 0.7,
    range: 1100, effectiveRange: 1000, falloff: 0.8, spreadHip: 11, spreadAim: 0.15, aimTime: 1.6, moveSpread: 7,
    recoil: 9, recovery: 5, maxRecoil: 12, magazine: 5, reload: 2.8, perRound: false, ammo: 'r338',
    penetration: 0.7, draw: 0.9, aimMove: 0.4, noise: 3200, stun: 0, speed: 3400, pierce: 0.75, kick: 9, kickSide: 0.3, kickMax: 12, shake: 5,
  }),
  crossbow: W({
    id: 'crossbow', name: 'Арбалет', class: 'crossbow', mode: 'semi', damage: 120, pellets: 1, fireRate: 0.55,
    range: 720, effectiveRange: 720, falloff: 1, spreadHip: 9, spreadAim: 0.25, aimTime: 1.5, moveSpread: 6,
    recoil: 0, recovery: 0, maxRecoil: 0, magazine: 1, reload: 1.9, perRound: false, ammo: 'bolt',
    penetration: 0.6, draw: 0.7, aimMove: 0.45, noise: 350, stun: 0, speed: 1100, pierce: 0.55, kick: 0.5, kickSide: 0.5, kickMax: 2, shake: 0.8,
  }),
  rpg: W({
    id: 'rpg', name: 'РПГ', class: 'launcher', mode: 'semi', damage: 90, pellets: 1, fireRate: 0.4,
    range: 700, effectiveRange: 700, falloff: 1, spreadHip: 7, spreadAim: 0.8, aimTime: 1.2, moveSpread: 5,
    recoil: 6, recovery: 5, maxRecoil: 8, magazine: 1, reload: 3.2, perRound: false, ammo: 'rocket',
    penetration: 1, draw: 1, aimMove: 0.45, noise: 3000, stun: 0, speed: 520, pierce: 0.8, kick: 3, kickSide: 0.5, kickMax: 5, shake: 6,
    blastMul: 1.35,
  }),
};

/** Выстрелов в секунду → «урон в секунду» по незащищённой цели вплотную (для подсказки в инвентаре). */
export function weaponDps(w: WeaponDef): number {
  return w.damage * w.pellets * w.fireRate;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  parcel: { id: 'parcel', name: 'Посылка', desc: 'Поручение с доски объявлений: отнести по адресу (метка на карте), E у дома.', kind: 'misc', stack: 1 },
  parcel_x: { id: 'parcel_x', name: 'Свёрток', desc: 'Тайное поручение подполья. Не попадайтесь на проверке CID — это контрабанда.', kind: 'misc', stack: 1 },
  ration: { id: 'ration', name: 'Рацион', desc: 'Стандартный паёк Протектората. Сытость +60.', kind: 'food', stack: 5, food: 60 },
  bread: { id: 'bread', name: 'Хлеб', desc: 'Серый хлеб. Сытость +25.', kind: 'food', stack: 5, food: 25, price: 6 },
  water: { id: 'water', name: 'Вода Breen', desc: 'Банка «воды». Сытость +10.', kind: 'food', stack: 5, food: 10, price: 3 },
  canned: { id: 'canned', name: 'Консервы', desc: 'Редкость. Сытость +45.', kind: 'food', stack: 5, food: 45, price: 14 },
  medkit: { id: 'medkit', name: 'Аптечка', desc: 'Лечение +40.', kind: 'medical', stack: 3, heal: 40, price: 28 },
  bandage: { id: 'bandage', name: 'Бинт', desc: 'Лечение +15.', kind: 'medical', stack: 5, heal: 15, price: 9 },
  cigarettes: { id: 'cigarettes', name: 'Сигареты', desc: 'Ходовая валюта «чёрного рынка».', kind: 'misc', stack: 10, price: 5 },
  helmet: { id: 'helmet', name: 'Армейский шлем', desc: 'Шлем армии сопротивления: держит часть пуль в голову.', kind: 'gear', stack: 1, price: 60, gear: { slot: 'head', head: 0.45, color: '#55603a' } },
  helmet_cp: { id: 'helmet_cp', name: 'Каска ВС', desc: 'Каска городской полиции: снята с тела.', kind: 'gear', stack: 1, price: 45, gear: { slot: 'head', head: 0.35, color: '#3f4a55' } },
  vest: { id: 'vest', name: 'Бронежилет', desc: 'Мягкий бронежилет: держит часть пуль в корпус.', kind: 'gear', stack: 1, price: 70, gear: { slot: 'torso', torso: 0.4, color: '#4b5663' } },
  plate_vest: { id: 'plate_vest', name: 'Плитник', desc: 'Бронежилет с пластинами: крепче, но редкость.', kind: 'gear', stack: 1, price: 110, gear: { slot: 'torso', torso: 0.55, color: '#5d6b3a' } },
  backpack: { id: 'backpack', name: 'Рюкзак', desc: 'Больше места: +4 ячейки инвентаря, пока надет.', kind: 'gear', stack: 1, price: 40, gear: { slot: 'back', capacity: 4, color: '#5a6238' } },
  lockpick: { id: 'lockpick', name: 'Отмычка', desc: 'Для взлома раздатчика рационов (вор). Ломается.', kind: 'tool', stack: 5 },
  grenade: { id: 'grenade', name: 'Осколочная граната', desc: 'T — бросить к курсору (взрыв через 2 с), Y — сменить гранату.', kind: 'misc', stack: 3 },
  smoke_grenade: { id: 'smoke_grenade', name: 'Дымовая граната', desc: 'Дымовая завеса: сквозь неё не видно (пули летят).', kind: 'misc', stack: 3 },
  fire_grenade: { id: 'fire_grenade', name: 'Зажигательная граната', desc: 'Пламя на земле: кто в нём — горит.', kind: 'misc', stack: 3 },
  fake_cid: { id: 'fake_cid', name: 'Поддельная CID', desc: 'С чёрного рынка: «чистая» карта — снимает розыск (повстанца в лицо всё равно узнают).', kind: 'misc', stack: 1 },
  toolkit: { id: 'toolkit', name: 'Набор инструментов', desc: 'Для ремонта (ТС).', kind: 'tool', stack: 1, price: 20 },
  ammo_pistol: { id: 'ammo_pistol', name: 'Патроны 9 мм', desc: 'Для пистолетов.', kind: 'ammo', stack: 120, ammo: 'pistol' },
  ammo_smg: { id: 'ammo_smg', name: 'Патроны 4.6 мм', desc: 'Для MP7.', kind: 'ammo', stack: 180, ammo: 'smg' },
  ammo_ar2: { id: 'ammo_ar2', name: 'Энергоячейки ИВЛ', desc: 'Для ИВЛ.', kind: 'ammo', stack: 120, ammo: 'ar2' },
  ammo_357: { id: 'ammo_357', name: 'Патроны .357', desc: 'Для револьвера.', kind: 'ammo', stack: 36, ammo: 'magnum' },
  ammo_buckshot: { id: 'ammo_buckshot', name: 'Дробь 12 к.', desc: 'Для SPAS-12.', kind: 'ammo', stack: 48, ammo: 'buckshot' },
  ammo_bolt: { id: 'ammo_bolt', name: 'Болты', desc: 'Для арбалета.', kind: 'ammo', stack: 20, ammo: 'bolt' },
  ammo_556: { id: 'ammo_556', name: 'Патроны 5.56', desc: 'Для M4A4.', kind: 'ammo', stack: 150, ammo: 'r556' },
  ammo_545: { id: 'ammo_545', name: 'Патроны 5.45', desc: 'Для АК-74.', kind: 'ammo', stack: 150, ammo: 'r545' },
  ammo_338: { id: 'ammo_338', name: 'Патроны .338', desc: 'Для снайперской винтовки.', kind: 'ammo', stack: 30, ammo: 'r338' },
  ammo_rocket: { id: 'ammo_rocket', name: 'Выстрел РПГ', desc: 'Ракета для РПГ.', kind: 'ammo', stack: 4, ammo: 'rocket' },
  stunstick: { id: 'stunstick', name: 'Дубинка', desc: 'Электродубинка ВС: бьёт и оглушает (замедляет).', kind: 'weapon', stack: 1 },
  knife: { id: 'knife', name: 'Нож', desc: 'Тихо. В спину — вдвое страшнее и мимо брони: два удара валят патрульного.', kind: 'weapon', stack: 1 },
  m4a4: { id: 'm4a4', name: 'M4A4', desc: 'Автомат: точный, 30 патронов.', kind: 'weapon', stack: 1 },
  ak74: { id: 'ak74', name: 'АК-74', desc: 'Автомат: чуть мощнее и сильнее уводит.', kind: 'weapon', stack: 1 },
  sniper: { id: 'sniper', name: 'Снайперская винтовка', desc: 'Долго целиться, зато через полкарты и сквозь броню.', kind: 'weapon', stack: 1 },
  rpg: { id: 'rpg', name: 'РПГ', desc: 'Ракета взрывается при попадании: против укрытий и кучек.', kind: 'weapon', stack: 1 },
  usp: { id: 'usp', name: 'USP Match', desc: 'Табельный пистолет ВС.', kind: 'weapon', stack: 1 },
  revolver: { id: 'revolver', name: 'Револьвер .357', desc: 'Мощный, но 6 патронов и сильная отдача.', kind: 'weapon', stack: 1 },
  spas12: { id: 'spas12', name: 'SPAS-12', desc: 'Дробовик: страшен вблизи, бесполезен вдали.', kind: 'weapon', stack: 1 },
  crossbow: { id: 'crossbow', name: 'Арбалет', desc: 'Тихий и точный, но долго целиться и заряжать.', kind: 'weapon', stack: 1 },
  mp7: { id: 'mp7', name: 'MP7', desc: 'Пистолет-пулемёт ВС.', kind: 'weapon', stack: 1 },
  ar2: { id: 'ar2', name: 'Импульсная винтовка ИВЛ', desc: 'Импульсная винтовка Протектората (у повстанцев — трофейная): пробивает укрытия.', kind: 'weapon', stack: 1 },
  rebel_pistol: { id: 'rebel_pistol', name: 'Самодельный пистолет', desc: 'Оружие сопротивления.', kind: 'weapon', stack: 1 },
  rebel_smg: { id: 'rebel_smg', name: 'Трофейный MP7', desc: 'Отбит у ВС.', kind: 'weapon', stack: 1 },
};

export const AMMO_ITEM: Record<AmmoType, ItemId> = {
  pistol: 'ammo_pistol', smg: 'ammo_smg', ar2: 'ammo_ar2', magnum: 'ammo_357', buckshot: 'ammo_buckshot', bolt: 'ammo_bolt',
  r556: 'ammo_556', r545: 'ammo_545', r338: 'ammo_338', rocket: 'ammo_rocket',
};

/** Стартовые наборы по ролям (и специализациям ВС). Первое оружие в списке — в руках. */
export const KITS: Record<string, [ItemId, number][]> = {
  citizen: [['water', 1]],
  cwu: [['toolkit', 1], ['bread', 1]],
  cwu_head: [['bread', 2], ['bandage', 1]],
  /** Повстанец-игрок: трофейный MP7 и пистолет про запас. */
  rebel: [['ak74', 1], ['ammo_545', 90], ['rebel_pistol', 1], ['ammo_pistol', 20], ['bandage', 2], ['grenade', 1]],
  cp: [['stunstick', 1], ['usp', 1], ['ammo_pistol', 54], ['bandage', 1]],
  cp_grid: [['mp7', 1], ['ammo_smg', 135], ['usp', 1], ['ammo_pistol', 36], ['stunstick', 1], ['medkit', 1], ['bandage', 1], ['grenade', 1]],
  cp_helix: [['usp', 1], ['ammo_pistol', 36], ['stunstick', 1], ['medkit', 2]],
  /** Сержант и офицер PCU: дубинка, пистолет, MP7. */
  cp_sgt: [['stunstick', 1], ['usp', 1], ['ammo_pistol', 36], ['mp7', 1], ['ammo_smg', 90], ['bandage', 1]],
  /** Спецназ SU.03: M4A4, пистолет, аптечка, осколочные и дымовая. */
  cp_su: [['m4a4', 1], ['ammo_556', 150], ['usp', 1], ['ammo_pistol', 36], ['stunstick', 1], ['medkit', 1], ['bandage', 2], ['grenade', 2], ['smoke_grenade', 1]],
  /** Медик-техник SU.02: MP7, пистолет, аптечки. */
  cp_su_medic: [['mp7', 1], ['ammo_smg', 90], ['usp', 1], ['ammo_pistol', 36], ['stunstick', 1], ['medkit', 3], ['bandage', 4], ['smoke_grenade', 1]],
  /** Охрана, инспектор, глава силового блока: MP7 и пистолет. */
  cp_qm: [['usp', 1], ['ammo_pistol', 36], ['stunstick', 1], ['bandage', 1]],
  cp_guard: [['mp7', 1], ['ammo_smg', 120], ['usp', 1], ['ammo_pistol', 36], ['stunstick', 1], ['medkit', 1], ['bandage', 1]],
  /** OTA.ALPHA и OTA.KING: импульсная винтовка AR2, пистолет, гранаты. */
  ota_alpha: [['ar2', 1], ['ammo_ar2', 120], ['usp', 1], ['ammo_pistol', 36], ['grenade', 2], ['bandage', 1]],
  /** OTA.KING: ещё и РПГ. */
  ota_king: [['ar2', 1], ['ammo_ar2', 180], ['rpg', 1], ['ammo_rocket', 3], ['usp', 1], ['ammo_pistol', 36], ['grenade', 3], ['medkit', 1], ['bandage', 1]],
  ota: [['ar2', 1], ['ammo_ar2', 120], ['grenade', 2]],
  ota_shotgun: [['spas12', 1], ['ammo_buckshot', 36], ['usp', 1], ['ammo_pistol', 36], ['grenade', 1]],
  admin: [['canned', 2]],
  /** Профессии (config/professions.ts). */
  thief: [['lockpick', 2], ['water', 1]],
  outcast: [['bandage', 1]],
  cwu_cook: [['toolkit', 1], ['bread', 2], ['water', 2]],
  cwu_medic: [['medkit', 3], ['bandage', 4]],
  rebel_medic: [['rebel_smg', 1], ['ammo_smg', 90], ['rebel_pistol', 1], ['ammo_pistol', 24], ['medkit', 3], ['bandage', 5], ['smoke_grenade', 2]],
  rebel_pyro: [['crossbow', 1], ['ammo_bolt', 12], ['rebel_pistol', 1], ['ammo_pistol', 24], ['fire_grenade', 3], ['bandage', 1]],
  rebel_partisan: [['rebel_smg', 1], ['ammo_smg', 90], ['rebel_pistol', 1], ['ammo_pistol', 36], ['knife', 1], ['lockpick', 1], ['bandage', 2], ['grenade', 2]],
  vort: [],
  /** Бойцы отрядов с пустошей: у всех автоматы (трофейные MP7 и AR2), пистолет — запасной. */
  rebel_raider: [['rebel_smg', 1], ['ammo_smg', 135], ['rebel_pistol', 1], ['ammo_pistol', 24], ['grenade', 1]],
  rebel_rifleman: [['ar2', 1], ['ammo_ar2', 90], ['rebel_pistol', 1], ['ammo_pistol', 24], ['grenade', 1]],
  rebel_shotgunner: [['spas12', 1], ['ammo_buckshot', 30], ['rebel_smg', 1], ['ammo_smg', 90], ['grenade', 1]],
  rebel_marksman: [['crossbow', 1], ['ammo_bolt', 12], ['rebel_smg', 1], ['ammo_smg', 90]],
  rebel_commander: [['ar2', 1], ['ammo_ar2', 90], ['revolver', 1], ['ammo_357', 18], ['grenade', 2]],
  /** Армия сопротивления: глава, ветераны, подрывник; HYDRA — спецотряд. */
  rebel_recruit: [['rebel_pistol', 1], ['ammo_pistol', 36], ['bandage', 2]],
  rebel_soldier: [['ak74', 1], ['ammo_545', 120], ['rebel_pistol', 1], ['ammo_pistol', 20], ['bandage', 2], ['grenade', 1]],
  /** Патрик: импульсная винтовка, РПГ, револьвер. */
  rebel_leader: [['ar2', 1], ['ammo_ar2', 150], ['rpg', 1], ['ammo_rocket', 3], ['revolver', 1], ['ammo_357', 18], ['medkit', 2], ['bandage', 2], ['grenade', 2]],
  rebel_veteran: [['ak74', 1], ['ammo_545', 150], ['rebel_pistol', 1], ['ammo_pistol', 20], ['bandage', 3], ['grenade', 2], ['smoke_grenade', 1]],
  rebel_demo: [['rebel_smg', 1], ['ammo_smg', 135], ['grenade', 8], ['fire_grenade', 2], ['bandage', 2]],
  // HYDRA: RCT — M4A4 и гранаты (больше, чем у бойцов), сержант — импульсная винтовка и пистолеты,
  // снайпер — снайперская винтовка, коммандос — импульсная винтовка, пистолет, много гранат.
  hydra_rct: [['m4a4', 1], ['ammo_556', 150], ['usp', 1], ['ammo_pistol', 36], ['bandage', 2], ['grenade', 4], ['smoke_grenade', 2]],
  hydra_sergeant: [['ar2', 1], ['ammo_ar2', 150], ['usp', 1], ['ammo_pistol', 36], ['revolver', 1], ['ammo_357', 18], ['bandage', 3], ['grenade', 2]],
  hydra_sniper: [['sniper', 1], ['ammo_338', 30], ['usp', 1], ['ammo_pistol', 36], ['bandage', 2], ['smoke_grenade', 1]],
  commando: [['ar2', 1], ['ammo_ar2', 180], ['usp', 1], ['ammo_pistol', 36], ['medkit', 2], ['bandage', 2], ['grenade', 5]],
  // Спецагент: тихий пистолет, отмычки, аптечка.
  spec_agent: [['mp7', 1], ['ammo_smg', 90], ['usp', 1], ['ammo_pistol', 48], ['knife', 1], ['lockpick', 2], ['medkit', 1], ['bandage', 1], ['grenade', 2]],
  /** Бандит: нож (в спину — два удара на патрульного) и самодельный пистолет. */
  bandit: [['knife', 1], ['rebel_pistol', 1], ['ammo_pistol', 36], ['bandage', 1], ['water', 1]],
  /** Бандит со стволом посерьёзнее (каждый GANGS.kits.armedEvery-й боец): трофейный MP7 или обрез и граната. */
  bandit_armed: [['rebel_smg', 1], ['ammo_smg', 90], ['rebel_pistol', 1], ['ammo_pistol', 24], ['knife', 1], ['grenade', 1], ['bandage', 1]],
  bandit_shotgun: [['spas12', 1], ['ammo_buckshot', 24], ['rebel_pistol', 1], ['ammo_pistol', 24], ['knife', 1], ['bandage', 1]],
  /** Авторитет банды: АК-74, пистолет, нож, гранаты. */
  gang_boss: [['ak74', 1], ['ammo_545', 120], ['revolver', 1], ['ammo_357', 18], ['knife', 1], ['grenade', 2], ['bandage', 2]],
  fugitive: [['bandage', 1]],
};


/**
 * Снаряжение с тел: у убитого с бронёй формы (ВС, армия сопротивления) с шансом dropChance в луте
 * остаётся шлем и бронежилет его стороны — их можно снять и надеть.
 */
export const GEAR = {
  dropChance: 0.5,
  drops: {
    cp: { head: 'helmet_cp', torso: 'vest' },
    rebel: { head: 'helmet', torso: 'plate_vest' },
  } as Partial<Record<string, { head: GearId; torso: GearId }>>,
} as const;
