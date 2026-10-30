import type { ItemId } from './items';

/**
 * Речной порт (systems/Port.ts, world/PortRenderer.ts): баржи стоят у причалов moored с, уходят на восток за край
 * (exitPast тайлов за протокой) со скоростью speed px/с, пропадают away с и возвращаются. Груз привозят вернувшиеся
 * баржи (systems/Supply.ts, SUPPLY); пока река перекрыта (Port.blocked), ушедшие не возвращаются. Время — в секундах.
 */
export const PORT = {
  moored: [90, 220] as const,
  away: [40, 120] as const,
  speed: 26,
  exitPast: 6,
};

/** Вид баржи: корпус, палуба, кромка, нос, контейнеры на палубе (цвета — как у порта), кильватерный след. */
export const PORT_LOOK = {
  hull: '#33393d',
  deck: '#59616a',
  rim: '#1c2023',
  cabin: '#d7d2c4',
  window: '#7fb2c9',
  wake: 'rgba(225,240,245,0.35)',
  cargo: ['#8c3b2e', '#2f5d7c', '#4f6b3a', '#8a6d2a'],
};

/**
 * Живая экономика (systems/Supply.ts): всё, что продают лавки, наливают в столовой и выдают на раздаче, приходит только
 * баржами. Вернувшаяся к причалу баржа везёт crates ящиков (× множитель населения); кран ставит их на набережную у
 * корня пирса — по ящику раз в crane с (у пирса не больше pile ящиков, остальное уплывает обратно). Докеры ТС
 * (профессия packer) грузят ящики на тележку и везут на склад штаба ТС; курьеры несут со склада коробки на полки
 * лавок, в столовую и в будку раздачи. Баржи встали — склад тает, полки пустеют. Время — с, расстояния — px.
 */
export const SUPPLY = {
  /** Место у стеллажа склада ТС, где встают (px от стеллажа к середине цеха). */
  rackStand: 22,
  cargo: { crates: 14, crane: 2.5, pile: 20, startPile: 4, every: 120 },
  /** Что в ящиках (вес — как часто попадается) и сколько штук в ящике товара. */
  manifest: [
    ['ration', 34], ['provisions', 12], ['bread', 12], ['water', 10], ['canned', 5], ['cigarettes', 7],
    ['bandage', 5], ['medkit', 3], ['newspaper', 4], ['soap', 3], ['flowers', 2], ['toolkit', 1],
  ] as [ItemId, number][],
  // Ящик одежды — отдельно (CLOTHES.supply: вес, штук в ящике): вещь из ассортимента ателье.
  crate: {
    ration: 10, provisions: 6, bread: 8, water: 10, canned: 6, cigarettes: 10, bandage: 6, medkit: 3,
    newspaper: 10, soap: 6, flowers: 6, toolkit: 2,
  } as Partial<Record<ItemId, number>>,
  /** Склад штаба ТС: на товар не больше crates ящиков (лишнее ждёт на набережной); при старте — start ящиков. */
  warehouse: { crates: 8, start: 2, startRations: 5 },
  /**
   * Тележка докера: ящиков за раз, погрузка loadTime с, скорость × speedMul, оплата за ящик, дальность «рядом»
   * (E игрока); не довёз за giveUp с — работа брошена (тележка остаётся при нём).
   */
  cart: { crates: 3, loadTime: 2.5, speedMul: 0.8, pay: 3, reach: 40, giveUp: 240 },
  /**
   * Перебои: после прихода баржи с шансом chance «шлюз ГЭС закрыт» на time с. Красный код и прорыв КПП — реку
   * перекрывают. Пока закрыто, ушедшие баржи не возвращаются.
   */
  halt: { chance: 0.08, time: [240, 480] as const },
  /** Сообщения о пустеющем складе — не чаще notice с. */
  notice: 90,
  lines: {
    docker: ['Взяли!', 'Тяжёлый, зараза.', 'Ещё ходка — и перекур.', 'Кто так грузил?', 'Пошла, родимая!'],
    wait: ['Баржи нет — курим.', 'Где эта баржа…', 'Опять шлюз закрыли?'],
    halt: 'Порт: шлюз ГЭС закрыт — баржи встали минут на {n}.',
    blockade: 'Порт: реку перекрыли — пока {why}, баржи не ходят.',
    resume: 'Порт: баржи снова ходят.',
    low: 'Склад ТС: кончается {what} — в лавках скоро будет пусто.',
  },
};

/** Вид груза (только отрисовка): ящики у пирса и на складе ТС, стеллажи и товар на полках лавок. */
export const SUPPLY_LOOK = {
  outline: '#1d1a17',
  crate: '#b08a52',
  crateTape: '#e0c07a',
  /** Стеллажи: доска полки, стойки. */
  shelf: '#7a5a3a',
  shelfDark: '#4a3422',
  /** Тележка докера: рама, колёса. */
  cart: '#5a4a38',
  wheel: '#23201c',
  /** Товар на полках: цвет и форма (loaf — буханка, bottle, can, box, roll, paper, bunch, cloth). */
  goods: {
    ration: ['#8a8f6a', 'box'],
    bread: ['#b07a3a', 'loaf'],
    water: ['#4a86b8', 'bottle'],
    canned: ['#9aa0a6', 'can'],
    cigarettes: ['#c8463a', 'box'],
    bandage: ['#f0ece2', 'roll'],
    medkit: ['#e8e4dc', 'box'],
    soap: ['#e0a0b8', 'box'],
    toolkit: ['#b8402e', 'box'],
    newspaper: ['#d8d4c8', 'paper'],
    flowers: ['#d8506a', 'bunch'],
    coat: ['#6a5a46', 'cloth'],
    cap: ['#3b4048', 'cloth'],
    provisions: ['#a89458', 'box'],
  } as Partial<Record<ItemId, [string, 'loaf' | 'bottle' | 'can' | 'box' | 'roll' | 'paper' | 'bunch' | 'cloth']>>,
  /** Масштаб значка штуки товара (на тайле стеллажа — ARBAT.supply.perTile штук, два ряда по три). */
  glyph: 1.35,
  /**
   * Оборудование зала лавки (POI shop_fixture): мест под товар на клетку по виду — стеллаж у стены, островной (с двух
   * сторон), витрина, холодильник, вешалка, газетная стойка, перфопанель; занято — по заполненности полок лавки.
   */
  display: { shelf: 3, gondola: 6, case: 2, fridge: 3, rail: 4, stand: 3, pegboard: 2 } as Record<string, number>,
};
