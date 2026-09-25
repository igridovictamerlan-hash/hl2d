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
  cwuPay: { rationServed: 2, repair: 12, sale: 1, node: 20 },
  /** Узлы Альянса (терминалы на проспектах и площади) — цели саботажа, чинит ГСР. */
  nodes: { count: 7, spacing: 15 },
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
  /**
   * Чёрный рынок в канализации: оружие и боеприпасы (qty — сколько штук за покупку),
   * скупка (sell — сколько токенов даёт за штуку; рацион — ходовая валюта).
   */
  blackMarket: {
    stock: [
      { id: 'rebel_pistol', qty: 1, price: 35 },
      { id: 'rebel_smg', qty: 1, price: 70 },
      { id: 'spas12', qty: 1, price: 90 },
      { id: 'revolver', qty: 1, price: 80 },
      { id: 'crossbow', qty: 1, price: 110 },
      { id: 'ar2', qty: 1, price: 140 },
      { id: 'ammo_pistol', qty: 24, price: 10 },
      { id: 'ammo_smg', qty: 45, price: 14 },
      { id: 'ammo_buckshot', qty: 12, price: 12 },
      { id: 'ammo_357', qty: 12, price: 14 },
      { id: 'ammo_bolt', qty: 5, price: 12 },
      { id: 'ammo_ar2', qty: 30, price: 18 },
      { id: 'medkit', qty: 1, price: 35 },
      { id: 'grenade', qty: 1, price: 30 },
      { id: 'fake_cid', qty: 1, price: 60 },
    ] as { id: ItemId; qty: number; price: number }[],
    sell: {
      ration: 12, canned: 8, cigarettes: 3, medkit: 14, bandage: 4, toolkit: 8,
      usp: 25, mp7: 40, stunstick: 10, ar2: 60, spas12: 35, revolver: 30, crossbow: 40, rebel_pistol: 12, rebel_smg: 28, grenade: 12,
    } as Partial<Record<ItemId, number>>,
  },
  /** Штраф к токенам при гибели игрока (доля). */
  deathTokenLoss: 0.5,
  inventorySlots: 12,
} as const;
