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
} as const;
