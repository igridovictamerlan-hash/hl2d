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
  /** Лавки на проспекте — по порядку важности: первая (магазин ТС) ставится всегда, ближе к площади. */
  shops: [
    { id: 'cwu', name: 'Магазин ТС', sign: 'ТС · ПРОДУКТЫ' },
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
   * Что продают (цены — ITEMS[id].price, лоялистам скидка): всё — с барж, через склад штаба ТС.
   */
  stock: {
    cwu: ['bread', 'water', 'canned', 'bandage', 'medkit', 'cigarettes', 'soap', 'toolkit'],
    tobacco: ['cigarettes', 'newspaper', 'water'],
    pharmacy: ['bandage', 'medkit', 'soap'],
    bakery: ['bread', 'water'],
    hardware: ['toolkit', 'soap'],
    tailor: ['coat', 'cap'],
    cafe: ['water', 'bread'],
    coffee: ['water', 'bread'],
    press: ['newspaper'],
    water: ['water'],
    smokes: ['cigarettes'],
    flowers: ['flowers'],
  } as Record<string, readonly ItemId[]>,
  /**
   * Горожане ходят по лавкам: вес занятия weight (среди уличных; только если лавка не дальше seek px), при
   * токенах от minMoney; у прилавка stay с, покупают одно (голодные — еду). lines — реплики.
   */
  visit: { weight: 2.5, seek: 1100, minMoney: 6, stay: [2.5, 5] as const },
  /**
   * Общая столовая: горожане с едой (рацион после раздачи) и сытостью ниже hungerBelow
   * идут за стол с шансом chance (не дальше seek px), едят eat с — сытость как от еды, лояльным +
   * loyalty; за столом болтают (lines — раз в lineEvery с). Без пайка — за супом (с шансом soupChance,
   * если повар у котла и суп есть — ARBAT.soup).
   */
  meal: { hungerBelow: 64, chance: 0.7, soupChance: 0.3, seek: 1000, eat: [9, 15] as const, lineEvery: [4, 8] as const, loyalty: 1 },
  /**
   * Товар — с барж через склад штаба ТС (StreetShops, systems/Port): у лавки, кафе и ларька — полка на каждый
   * товар из stock (до perItem штук — больше, если стеллаж длинный: perTile штук на тайл, не больше perItemMax; у ларька —
   * kioskPerItem), покупка — штука; видно на стеллаже у задней стены. Курьер берёт со склада коробку до perBox штук — того, чего на полках меньше всего (если на складе
   * есть), и несёт туда, где товара меньше доли low; столовой — продукты (из штуки — soup.perProvision порций
   * супа, котёл до canteenCap). Курьеру — pay. start — запас полок при старте (доля). Будка раздачи важнее.
   */
  supply: { perItem: 6, perItemMax: 12, perTile: 6, kioskPerItem: 8, canteenCap: 24, perBox: 10, start: 0.6, low: 0.5, pay: 5 },
  /**
   * Продавец (профессия vendor) за прилавком своей лавки или кафе, повар столовой — у котла: смена
   * shift с, потом перерыв (дом, столовая, прогулка). Лавка открыта, пока продавец ближе reach px к
   * своему месту. Ларьки — окошко, продавец внутри не нужен. lineEvery — реплики за прилавком.
   */
  staff: { shift: [140, 240] as const, reach: 24, lineEvery: [12, 25] as const },
  /** Суп в столовой: голодному без пайка наливает повар — сытость food, лояльным + loyalty. */
  soup: { food: 40, loyalty: 1, perProvision: 4 },
  lines: {
    closed: ['Закрыто… Где продавец?', 'Опять никого за прилавком.', 'Перерыв у них, что ли.'],
    empty: ['Ничего нет? Совсем?', 'Пустые полки…', 'Когда привезут?', 'Штаб ТС опять не довёз.'],
    vendor: ['Подходите, свежий завоз!', 'Хлеб только утром привезли.', 'Не толпитесь.', 'Касса слева.', 'Следующий!', 'Воды — по одной в руки.'],
    vendorEmpty: ['Всё продано, ждём коробку из штаба.', 'Пусто. Курьер где-то застрял.'],
    cook: ['Суп готов, подходи с миской.', 'Кому добавки? Никому — не положено.', 'Горячее!', 'Кто без пайка — сюда.'],
    soup: ['Спасибо за суп.', 'Хоть что-то горячее.', 'Жидковат, но сойдёт.'],
    deliver: ['Разгружаю, принимай!', 'Коробка из штаба ТС.', 'Распишитесь за товар.'],
    buy: ['Мне вот это, пожалуйста.', 'Почём сегодня?', 'Сдачи не надо.', 'Опять подорожало…', 'Спасибо.'],
    browse: ['Просто смотрю.', 'Красиво у вас.', 'Зайду в другой раз.', 'Денег нет — хоть поглазеть.'],
    broke: ['Не хватает… Эх.', 'В другой раз.'],
    canteen: [
      'Суп сегодня почти горячий.', 'Передай соль. А, её нет.', 'Хоть поесть по-людски, за столом.',
      'Говорят, пайки урежут.', 'Сосед опять не пришёл на раздачу…', 'Вкус как у картона. Но сытно.',
      'Раньше тут кафе было. С пирожными.', 'Тише, ВС у двери.', 'Приятного аппетита.', 'Хоть посидим в тепле.',
    ],
  },
} as const;
