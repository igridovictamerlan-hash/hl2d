import type { FactionId } from './factions';
import type { ProfessionId } from './professions';

/**
 * Пешки в стиле RimWorld. Размеры — px мира от центра персонажа (круг столкновений — радиус 12,
 * пешка выше круга). Слои: тень → волосы сзади → туловище → одежда/броня → шея → голова и лицо →
 * причёска/шлем. Четыре стороны: юг — лицо, север — спина, восток/запад — профиль (запад — отражение).
 */
export const PAWN = {
  /** Пешка мельче круга столкновений — как в RimWorld пешка ≈ клетка (иначе «игрушечные»). */
  scale: 0.86,
  outline: '#141414',
  outlineWidth: 1.4,
  /** Внутренние швы и детали брони. */
  seamWidth: 0.8,
  /** Туловище: верх (плечи) и низ, полуширина у плеч и в поясе. */
  body: { top: -4.5, bottom: 14, shoulder: 7.2, waist: 8.6 },
  /** Голова: центр, радиус, подбородок ниже круга на chin; в профиле — сдвиг вперёд. */
  head: { y: -10.5, r: 7.6, chin: 1.2, sideShift: 1.2 },
  /** Тень под ногами (эллипс). */
  shadow: { y: 13, rx: 9.5, ry: 3.5, color: 'rgba(0,0,0,0.32)' },
  /** Затенение правой стороны туловища и головы (объём). */
  shade: 'rgba(0,0,0,0.14)',
  skins: ['#f3cfae', '#e6b992', '#d6a47c', '#c28c63', '#9f6e48', '#7b5036'],
  hairs: ['#2a211d', '#46301f', '#63432a', '#7d5a38', '#a8814f', '#383838', '#8e8e8e', '#6a2d1b', '#c9a86a'],
  /** Доли причёсок: лысый, короткая, лохматая с чёлкой, длинная, с пучком. */
  hairStyles: { bald: 0.08, short: 0.3, messy: 0.25, long: 0.2, bun: 0.17 },
  eye: { dx: 2.8, y: -9.6, rx: 1, ry: 1.25, color: '#161616', lid: 0.55 },
  mouth: { y: -5.3, w: 1.6 },
  corpseAlpha: 0.85,
  playerRing: 'rgba(255,211,107,0.9)',
  /**
   * Одежда по фракциям. base — цвет одежды под бронёй (по умолчанию — цвет ранга),
   * armor — цвет пластин (rank — цвет ранга), head — что на голове.
   *  vest — бронежилет: наплечники, нагрудная пластина, пояс, подсумок (как у пешек RimWorld).
   */
  outfits: {
    citizen: { base: 'rank', head: 'hair', vest: false, collar: '#4f5a66', zip: true },
    cwu: { base: 'rank', head: 'cap', vest: false, cap: '#c9a53e', armband: '#8a8f96' },
    rebel: { base: 'rank', armor: '#5d6b3a', belt: '#3a2f22', head: 'bandana', cloth: '#7a4a2a', vestFromRank: 1 },
    /**
     * ГО и OTA — силовая броня как у пехотинцев RimWorld (style: 'marine'): крупные наплечники,
     * сегментная кираса, горжет, пояс с подсумками, набедренники, ранец за спиной, закрытый шлем
     * без лица с тёмным визором. trim — полосы на наплечниках и шлеме (у ГО — цвет ранга).
     */
    cp: { style: 'marine', base: '#2c333c', armor: '#5a6879', belt: '#23282f', trim: 'rank', helmet: '#4f5d6f', visor: '#10151b', shine: '#7fa7cc', head: 'helmet' },
    ota: { style: 'marine', base: '#5d6166', armor: '#cfccc1', belt: '#4a4d52', trim: '#7c2a24', helmet: '#d6d3c8', visor: '#15191e', shine: '#9fb3c4', eye: '#ff4a3a', head: 'helmet' },
    admin: { base: '#3b3f46', head: 'hair', vest: false, collar: '#f2f2f2', tie: '#7a1c1c' },
    /** Вортигонт: сутулое зеленоватое тело, большой красный глаз и два малых, металлический ошейник раба. */
    vort: { style: 'vort', skin: '#7f9a62', spots: '#5f7a48', eye: '#e2342a', collar: '#8d949c', light: '#58d0ff' },
  } as Record<FactionId, Record<string, string | boolean | number>>,
  /**
   * Одежда по профессиям — поверх фракционной (перекрывает её поля): белый халат медика ГСР с
   * красным крестом, поварской колпак и фартук, тёмная куртка с капюшоном вора, рваньё отброса,
   * повязка медика и очки пиротехника у повстанцев, крематор — синтет в плаще с маской.
   */
  professionOutfits: {
    cwu_medic: { base: '#e6e4dc', head: 'hair', cross: '#c93030', collar: '#cfccc4' },
    cook: { head: 'chef', chef: '#f4f2ec', apron: '#f1efe8' },
    courier: { cap: '#8b6a3e', bag: '#7a5a38' },
    janitor: { cap: '#7d848c', hivis: '#e8e04a' },
    thief: { base: '#3a3d44', head: 'hood', hood: '#2e3137', zip: false, collar: false },
    outcast: { base: '#6b5d48', patch: '#4d4234', zip: false, collar: false },
    rebel_medic: { armband: '#f2f2f2', armbandCross: '#c93030' },
    pyro: { goggles: '#ff8a3a' },
    cremator: { style: 'cremator', coat: '#3a3833', skin: '#d8cfc4', mask: '#57544d', tank: '#6d7176', eye: '#b8e04a' },
  } as Partial<Record<ProfessionId, Record<string, string | boolean | number>>>,
} as const;
