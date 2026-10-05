import type { ItemId } from './items';
import type { FactionId } from './factions';

/** Экономика Верхнеречье. Время — секунды игры, деньги — токены. */
export const ECONOMY = {
  hunger: {
    /** Сытость падает с max до 0 примерно за 14 минут. */
    max: 100,
    decayPerSec: 0.12,
    /** Урон от голода при нулевой сытости, в секунду. */
    starveDamage: 0.25,
    /** NPC ест, если сытость ниже (и есть еда). */
    npcEatBelow: 40,
    /**
     * Во сне сытость тает в sleepMul раз медленнее (раньше к утру голодала половина города: ночью ни
     * раздачи, ни лавок). Перед сном житель ужинает тем, что есть, если сытость ниже supperBelow.
     */
    sleepMul: 0.35,
    supperBelow: 70,
  },
  /**
   * Где ест каждая сторона (раньше кормились только горожане, остальные голодали до смерти и
   * «лечились» от голода возрождением). allowance — довольствие раз в salary.interval: у кого нет еды
   * и сытость ниже below — предмет: ВС, Легион и санитары — паёк, Комендант — консервы, рабочий ТС,
   * отработавший этот период, — паёк, поднадзорные — хлеб (баланда). camp и cache — котёл лагеря армии и
   * запасы схрона подполья: сытость +N в секунду, пока там. seekBelow — житель без еды голоднее этого
   * бросает дела: в очередь за пайком, в столовую за супом или в лавку за хлебом.
   */
  meals: {
    allowance: { cp: 'ration', ota: 'ration', admin: 'canned', cwu: 'ration', vort: 'bread' } as Partial<Record<FactionId, ItemId>>,
    below: 60,
    camp: 2.5,
    cache: 2.5,
    /** Баланда в КПЗ и тюрьме: сидящий не голоднее floor (сытость растёт на rate в секунду до него). */
    jail: { floor: 40, rate: 0.5 },
    seekBelow: 30,
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
    /** ТС — только если работал в этот период. */
    cwu: 6,
    admin: 20,
  },
  cwuPay: { rationServed: 2, repair: 12, sale: 1, node: 20 },
  /** Узлы Протектората (терминалы на проспектах и площади) — цели саботажа, чинит ТС. */
  nodes: { count: 11, spacing: 15 },
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
      { id: 'ak74', qty: 1, price: 120 },
      // Стволы Протектората — только краденые (со склада, с конвоев, с тел ВС).
      { id: 'usp', qty: 1, price: 45 },
      { id: 'mp7', qty: 1, price: 75 },
      { id: 'm4a4', qty: 1, price: 130 },
      { id: 'knife', qty: 1, price: 15 },
      { id: 'ammo_545', qty: 30, price: 16 },
      { id: 'ammo_pistol', qty: 24, price: 10 },
      { id: 'ammo_smg', qty: 45, price: 14 },
      { id: 'ammo_buckshot', qty: 12, price: 12 },
      { id: 'ammo_357', qty: 12, price: 14 },
      { id: 'ammo_bolt', qty: 5, price: 12 },
      { id: 'ammo_ar2', qty: 30, price: 18 },
      { id: 'medkit', qty: 1, price: 35 },
      { id: 'grenade', qty: 1, price: 30 },
      { id: 'smoke_grenade', qty: 1, price: 18 },
      { id: 'fire_grenade', qty: 1, price: 26 },
      { id: 'bandage', qty: 2, price: 8 },
      { id: 'lockpick', qty: 2, price: 14 },
      { id: 'fake_cid', qty: 1, price: 60 },
      { id: 'forged_pass', qty: 1, price: 45 },
      // Снаряжение: надевается в инвентаре (Tab).
      { id: 'helmet', qty: 1, price: 60 },
      { id: 'vest', qty: 1, price: 70 },
      { id: 'plate_vest', qty: 1, price: 110 },
      { id: 'backpack', qty: 1, price: 40 },
    ] as { id: ItemId; qty: number; price: number }[],
    sell: {
      ration: 12, canned: 8, cigarettes: 3, medkit: 14, bandage: 4, toolkit: 8,
      usp: 25, mp7: 40, stunstick: 10, ar2: 60, spas12: 35, revolver: 30, crossbow: 40, rebel_pistol: 12, rebel_smg: 28, grenade: 12,
      m4a4: 55, ak74: 50, sniper: 70, rpg: 90, knife: 5, smoke_grenade: 7, fire_grenade: 10,
      helmet: 25, helmet_cp: 20, vest: 30, plate_vest: 45, backpack: 15,
    } as Partial<Record<ItemId, number>>,
  },
  /** Штраф к токенам при гибели игрока (доля). */
  deathTokenLoss: 0.5,
  inventorySlots: 12,
} as const;
