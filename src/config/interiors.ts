/**
 * Планировка помещений (world/generator/interiors.ts): квартиры по полосе достатка, лавки и кафе. Размеры — в тайлах
 * (1 тайл ≈ 1 м). Двери между комнатами — по 2 тайла (пешка — якорь 2×2), комната не уже 2 тайлов; любой план
 * проверяется: от входа пешка доходит до каждой клетки пола (иначе генератор засыпал бы клетку как недоступную).
 */
export const INTERIORS = {
  /**
   * Жильё. Меньше studio тайлов пола или уже 2 — одна комната (хибара, студия). Квартира (Старый и Верхний город):
   * передняя полоса глубиной front (большая — frontDeep, если глубина не меньше deep) — прихожая у двери, по бокам
   * кухня и санузел (не уже side); за стеной — комнаты, вторая — если ширина не меньше backSplit (каждая не уже room);
   * узкий дом — анфиладой вглубь. Слобода: коммуналка — коридор от двери вглубь, по бокам комнаты-жильё (не уже room,
   * глубиной не меньше roomDepth), из трёх и больше комнат одна — общая кухня; узкий — кухня и комната.
   */
  home: {
    studio: 12,
    front: 2,
    frontDeep: 3,
    deep: 8,
    side: 2,
    room: 3,
    backSplit: 7,
    roomDepth: 2,
    /** Коммуналка — если коридор и хотя бы одна комната помещаются (ширина не меньше communal). */
    communal: 6,
    /** В Старом городе — две комнаты за прихожей с этой долей (в Верхнем — всегда, если влезают). */
    oldSplit: 0.6,
  },
  /**
   * Лавки. Прилавок (табак, аптека, булочная; маленькая лавка любого вида): прилавок поперёк в трёх рядах от задней
   * стены, за ним продавец и стеллаж с товаром; в глубокой лавке (глубина не меньше backroom) — прилавок ближе к входу
   * и подсобка за стеной. Самообслуживание (магазин ТС, хозтовары) и салон (ателье) — касса сбоку у входа (длиной
   * desk), продавец за ней, в зале — стеллажи у стен, островные стеллажи, холодильник, вешалки, примерочная.
   * Самообслуживание — если зал не уже selfMin. Оборудования одного вида — не больше max.
   */
  shop: {
    backroom: 8,
    desk: 3,
    selfMin: 6,
    wallLen: [2, 4] as const,
    islandLen: [2, 3] as const,
    max: { shelf: 4, gondola: 2, fridge: 1, rail: 3, stand: 1, pegboard: 3, booth: 1, mirror: 1, table: 6, oven: 1, case: 2 } as Record<string, number>,
    /**
     * Что ставить в зал по виду лавки — по порядку, пока помещается: wall — у стены, island — посередине.
     */
    fit: {
      cwu: [['fridge', 'wall'], ['gondola', 'island'], ['shelf', 'wall'], ['gondola', 'island'], ['shelf', 'wall']],
      hardware: [['pegboard', 'wall'], ['gondola', 'island'], ['pegboard', 'wall'], ['shelf', 'wall']],
      tobacco: [['stand', 'island'], ['shelf', 'wall'], ['stand', 'wall']],
      pharmacy: [['shelf', 'wall'], ['shelf', 'wall'], ['case', 'island']],
      bakery: [['shelf', 'wall'], ['shelf', 'wall']],
      tailor: [['rail', 'island'], ['booth', 'wall'], ['mirror', 'wall'], ['rail', 'wall'], ['rail', 'island']],
      tailor_up: [['rail', 'island'], ['booth', 'wall'], ['mirror', 'wall'], ['rail', 'island'], ['rail', 'wall']],
      cafe: [['table', 'island'], ['table', 'island'], ['table', 'wall'], ['table', 'wall'], ['table', 'wall'], ['table', 'wall']],
      coffee: [['table', 'island'], ['table', 'wall'], ['table', 'wall'], ['table', 'wall']],
    } as Record<string, readonly (readonly [string, 'wall' | 'island'])[]>,
    /** Прилавок по виду лавки: витрина со стеклом (аптека, булочная), барная стойка (кафе) или деревянный. */
    counter: { pharmacy: 'case', bakery: 'case', cafe: 'bar', coffee: 'bar' } as Record<string, string>,
    /** Лавки «самообслуживание» и «салон»; остальные — «прилавок». */
    self: ['cwu', 'hardware'] as readonly string[],
    salon: ['tailor', 'tailor_up'] as readonly string[],
    /** Подсобка за прилавком — у этих видов в глубокой лавке (у кафе — кухня). */
    withBackroom: ['pharmacy', 'bakery', 'cafe', 'coffee', 'hardware'] as readonly string[],
  },
} as const;
