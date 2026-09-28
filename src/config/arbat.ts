import type { ItemId } from './items';

/**
 * Главный проспект — улица старого города: лавки, кафе, общая столовая, ларьки. Здесь — каталог
 * (названия зон для баннера, вывески на фасадах). Геометрия — GENERATOR.avenue/facades.
 */

export type ShopId = 'cwu' | 'tobacco' | 'pharmacy' | 'hardware' | 'bakery' | 'tailor';
export type CafeId = 'cafe' | 'coffee';
export type KioskId = 'press' | 'water' | 'smokes' | 'flowers';

export interface ShopDef<Id extends string> {
  id: Id;
  /** Название зоны (баннер при входе). */
  name: string;
  /** Вывеска над витриной. */
  sign: string;
}

export const ARBAT = {
  /** Лавки на проспекте — по порядку важности: первая (магазин ГСР) ставится всегда, ближе к площади. */
  shops: [
    { id: 'cwu', name: 'Магазин ГСР', sign: 'ГСР · ПРОДУКТЫ' },
    { id: 'tobacco', name: 'Табак и газеты', sign: 'ТАБАК' },
    { id: 'pharmacy', name: 'Аптека', sign: 'АПТЕКА' },
    { id: 'bakery', name: 'Булочная', sign: 'ХЛЕБ' },
    { id: 'hardware', name: 'Хозтовары', sign: 'ХОЗТОВАРЫ' },
    { id: 'tailor', name: 'Ателье', sign: 'АТЕЛЬЕ' },
  ] as readonly ShopDef<ShopId>[],
  cafes: [
    { id: 'cafe', name: 'Кафе «Старый город»', sign: 'КАФЕ' },
    { id: 'coffee', name: 'Кофейня «Липа»', sign: 'КОФЕ' },
  ] as readonly ShopDef<CafeId>[],
  canteen: { name: 'Общая столовая №1', sign: 'СТОЛОВАЯ' },
  kiosks: [
    { id: 'press', name: 'Газеты', sign: 'ПРЕССА' },
    { id: 'water', name: 'Вода', sign: 'ВОДА' },
    { id: 'smokes', name: 'Сигареты', sign: 'ТАБАК' },
    { id: 'flowers', name: 'Цветы', sign: 'ЦВЕТЫ' },
  ] as readonly ShopDef<KioskId>[],
  /**
   * Что продают (цены — ITEMS[id].price, лоялистам скидка). Пусто — лавка «для вида»: ателье,
   * газеты, цветы — зайти, поглазеть, перекинуться словом.
   */
  stock: {
    cwu: ['bread', 'water', 'canned', 'bandage', 'medkit', 'cigarettes', 'toolkit'],
    tobacco: ['cigarettes', 'water'],
    pharmacy: ['bandage', 'medkit'],
    bakery: ['bread', 'water'],
    hardware: ['toolkit'],
    tailor: [],
    cafe: ['water', 'bread'],
    coffee: ['water', 'bread'],
    press: [],
    water: ['water'],
    smokes: ['cigarettes'],
    flowers: [],
  } as Record<string, readonly ItemId[]>,
  /**
   * Горожане ходят по лавкам: вес занятия weight (среди уличных; только если лавка не дальше seek px), при
   * токенах от minMoney; у прилавка stay с, покупают одно (голодные — еду). lines — реплики.
   */
  visit: { weight: 2.5, seek: 1100, minMoney: 6, stay: [2.5, 5] as const },
  /**
   * Общая столовая: горожане с едой (рацион после раздачи) и сытостью ниже hungerBelow
   * идут за стол с шансом chance (не дальше seek px), едят eat с — сытость как от еды, лояльным +
   * loyalty; за столом болтают (lines — раз в lineEvery с). Мест нет — едят где стоят.
   */
  meal: { hungerBelow: 64, chance: 0.7, seek: 1000, eat: [9, 15] as const, lineEvery: [4, 8] as const, loyalty: 1 },
  lines: {
    buy: ['Мне вот это, пожалуйста.', 'Почём сегодня?', 'Сдачи не надо.', 'Опять подорожало…', 'Спасибо.'],
    browse: ['Просто смотрю.', 'Красиво у вас.', 'Зайду в другой раз.', 'Денег нет — хоть поглазеть.'],
    broke: ['Не хватает… Эх.', 'В другой раз.'],
    canteen: [
      'Суп сегодня почти горячий.', 'Передай соль. А, её нет.', 'Хоть поесть по-людски, за столом.',
      'Говорят, пайки урежут.', 'Сосед опять не пришёл на раздачу…', 'Вкус как у картона. Но сытно.',
      'Раньше тут кафе было. С пирожными.', 'Тише, ГО у двери.', 'Приятного аппетита.', 'Хоть посидим в тепле.',
    ],
  },
} as const;
