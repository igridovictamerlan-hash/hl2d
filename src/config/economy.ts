import type { ItemId } from './items';

/** Экономика Сити-17. Время — секунды игры, деньги — токены. */
export const ECONOMY = {
  hunger: {
    /** Сытость падает с max до 0 примерно за 14 минут. */
    max: 100,
    decayPerSec: 0.12,
    /** Урон от голода при нулевой сытости, в секунду. */
    starveDamage: 0.25,
    /** NPC ест, если сытость ниже (и есть еда). */
    npcEatBelow: 40,
  },
  rations: {
    /** Первая раздача через… */
    firstDelay: 20,
    /** Между началами раздач. */
    interval: 160,
    /** Сколько окно открыто. */
    duration: 80,
    /** Время выдачи одного рациона. */
    serveTime: 2.2,
    /** Токенов в рационе. */
    tokens: 10,
    item: 'ration' as ItemId,
    queueSlots: 9,
    queueSpacing: 28,
    /** Шанс, что NPC-гражданин пойдёт в очередь за раздачу. */
    npcJoinChance: 0.7,
  },
  salary: {
    interval: 60,
    cp: 10,
    cpPerRank: 2,
    /** ГСР — только если работал в этот период. */
    cwu: 6,
    admin: 20,
  },
  cwuPay: { rationServed: 2, repair: 12, sale: 1 },
  repairs: {
    spots: 12,
    /** Раз в сколько секунд что-то ломается. */
    breakEvery: [18, 40] as const,
    time: 5,
    /** Не больше одновременно сломанного. */
    maxBroken: 4,
  },
  shop: {
    stock: ['bread', 'water', 'canned', 'bandage', 'medkit', 'cigarettes', 'toolkit'] as ItemId[],
    /** Шанс, что NPC с токенами зайдёт в магазин вместо прогулки. */
    npcVisitChance: 0.08,
  },
  /** Штраф к токенам при гибели игрока (доля). */
  deathTokenLoss: 0.5,
  inventorySlots: 12,
} as const;
