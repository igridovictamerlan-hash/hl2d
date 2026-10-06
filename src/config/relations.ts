/**
 * Живые люди: характер, настроение и память отношений (systems/Persona.ts, systems/Relations.ts).
 *
 * У каждого жителя — характер (шесть черт от «зерна» личности), настроение (из потребностей и «мыслей» — что
 * недавно случилось) и память: кто кому знаком, друг или недруг, и что именно запомнилось. Отношение
 * складывается из событий (разговор, драка, помощь, кража, арест, гибель близкого), у каждого события —
 * свои последствия для пострадавшего, виновника и свидетелей; со временем обиды остывают (злопамятные —
 * медленнее), дружба держится дольше. Время — секунды игры (сутки — LIGHTING.dayLength = 1080 с), расстояния — px.
 */

/** Черты характера, 0..1. */
export type Trait = 'temper' | 'social' | 'kind' | 'brave' | 'grudge' | 'trust';

/** Занятия, к которым у человека бывает «привычка» (множитель веса — config/street.ts weights). */
export type Habit = 'barrel' | 'bench' | 'cards' | 'smoke' | 'notice' | 'shopping' | 'home' | 'chat';

/** Как бывший опыт и профессия сдвигают черты (к 0..1 после суммы). */
export type TraitBias = Partial<Record<Trait, number>>;

/** Вид события отношений (config ниже — EVENTS). */
export type EventKind =
  | 'talk' | 'argue' | 'greet' | 'intro' | 'snub'
  | 'hit' | 'insult' | 'shoot' | 'rob'
  | 'help' | 'revive' | 'feed' | 'defend' | 'gift'
  | 'arrest' | 'fine' | 'kill' | 'forgive' | 'gossipGood' | 'gossipBad';

/** Что запомнилось о человеке (от лица того, кто помнит). */
export type MemKind =
  | 'met' | 'talked' | 'argued' | 'brawled' | 'beat' | 'insulted' | 'shot' | 'robbed' | 'snubbed'
  | 'helped' | 'saved' | 'fed' | 'defended' | 'gift'
  | 'arrestedMe' | 'arrestedMine' | 'fined' | 'killedMine'
  | 'sawBeat' | 'sawShot' | 'sawRob' | 'sawKill' | 'forgave'
  | 'heardGood' | 'heardBad';

/** «Мысли» — недавние события, влияющие на настроение (затухают со временем). */
export type ThoughtKind =
  | 'chatFriend' | 'chat' | 'greeted' | 'argued' | 'insulted' | 'beaten' | 'robbed' | 'shotAt'
  | 'sawFight' | 'sawDeath' | 'friendDied' | 'kinDied' | 'friendHurt' | 'friendArrested'
  | 'arrested' | 'fined' | 'helped' | 'gift' | 'shared' | 'comforted' | 'reconciled' | 'ration' | 'rested' | 'rebuffed';

export interface EventDef {
  /** Как меняется мнение пострадавшего/адресата о виновнике (отрицательное — хуже). */
  target: number;
  /** Как меняется мнение виновника/инициатора об адресате. */
  actor: number;
  /** Мнение свидетелей о виновнике. */
  witness: number;
  /** Насколько лучше узнают друг друга (знакомство, 0..100). */
  fam: number;
  /** Что запомнит адресат / виновник / свидетель. */
  memT?: MemKind;
  memA?: MemKind;
  memW?: MemKind;
  /** Мысли адресата / виновника / свидетелей (настроение). */
  thoughtT?: ThoughtKind;
  thoughtA?: ThoughtKind;
  thoughtW?: ThoughtKind;
  /** Не чаще одного раза в cooldown с на пару (удары очередью, пули). */
  cooldown: number;
  /** Свидетели ближе witnessRadius и видят место события. */
  seen?: boolean;
}

export const RELATIONS = {
  /** Включено (в тестах Game выставляет, безголовые — по месту). */
  enabled: true,

  /**
   * Характер: шесть черт 0..1 от зерна личности (id человека), потом сдвиг по стороне и профессии. Черта
   * выше high или ниже low — заметна («вспыльчивый», «робкий»): в подписи не больше maxTags самых ярких.
   */
  persona: {
    high: 0.7,
    low: 0.3,
    maxTags: 2,
    /** Зерно: добавка к id (чтобы характер не совпадал с внешностью). */
    salt: 0x5e1f,
    /** Сдвиги по фракции / профессии (прибавляются к трём броскам). */
    bias: {
      faction: {
        cp: { temper: -0.12, brave: 0.18, trust: -0.1, kind: -0.08 },
        ota: { temper: -0.2, brave: 0.3, kind: -0.2, trust: -0.2 },
        rebel: { brave: 0.22, grudge: 0.12, trust: -0.05 },
        vort: { temper: -0.2, brave: -0.15, social: -0.15 },
        admin: { temper: -0.2, trust: -0.15 },
      } as Record<string, TraitBias>,
      profession: {
        bandit: { temper: 0.28, kind: -0.22, brave: 0.22, grudge: 0.15, trust: -0.15 },
        gang_boss: { temper: 0.18, brave: 0.3, kind: -0.15, grudge: 0.2, social: 0.1 },
        thief: { trust: -0.22, brave: -0.1, kind: -0.1, social: -0.05 },
        outcast: { trust: -0.15, social: -0.1, grudge: 0.1 },
        fugitive: { trust: -0.25, social: -0.15, brave: 0.05 },
        cook: { social: 0.1, kind: 0.1 },
        vendor: { social: 0.2, trust: 0.05 },
        canteen_cook: { social: 0.12, kind: 0.15 },
        cwu_medic: { kind: 0.25, temper: -0.1 },
        cwu_head: { social: 0.05, temper: 0.05 },
        packer: { temper: -0.05 },
        loader: { brave: 0.08 },
      } as Record<string, TraitBias>,
    },
    /** Названия черт: [высокая, низкая]. */
    names: {
      temper: ['вспыльчивый', 'спокойный'],
      social: ['общительный', 'замкнутый'],
      kind: ['отзывчивый', 'чёрствый'],
      brave: ['храбрый', 'робкий'],
      grudge: ['злопамятный', 'отходчивый'],
      trust: ['доверчивый', 'подозрительный'],
    } as Record<Trait, readonly [string, string]>,
    /** Привычки: множитель веса занятия от personal seed (от lo до hi); ярче habitHigh — увлечение. */
    habit: { lo: 0.45, hi: 1.75, hobbyAt: 1.5 },
    hobbies: {
      barrel: 'любит посидеть у бочки',
      bench: 'любит скамейки проспекта',
      cards: 'азартный игрок',
      smoke: 'заядлый курильщик',
      notice: 'читает все объявления',
      shopping: 'любит ходить по лавкам',
      home: 'домосед',
      chat: 'не прочь поболтать',
    } as Record<Habit, string>,
  },

  /**
   * Знакомства и мнение: opinion −100..100 (как А относится к Б), fam 0..100 (насколько знает), флаги
   * происхождения (родня, соседи по общежитию…) задают «базу», к которой мнение возвращается.
   */
  bond: {
    /** Сколько отношений помнит один человек (лишние слабые забываются). */
    max: 34,
    /** Знакомы, если fam не меньше known. */
    known: 8,
    /** Уровни по мнению и знакомству. */
    tiers: {
      friend: { opinion: 28, fam: 18 },
      close: { opinion: 58, fam: 40 },
      rival: { opinion: -26 },
      enemy: { opinion: -58 },
    },
    /** База мнения по происхождению связи (сумма флагов, потолок base.max). */
    base: { kin: 42, house: 10, work: 6, gang: 40, comrade: 24, neighbor: 3, friend: 30, feud: -36, max: 70 },
    /** Остывание к базе: период полураспада, с. Обиды — от grudge (0 → ×lo, 1 → ×hi), хорошее — дольше. */
    halfLife: { good: 2400, bad: 800, grudgeLo: 0.55, grudgeHi: 2.0 },
    /** Сколько воспоминаний на связь и сколько живёт воспоминание (по знаку), с. */
    memories: { per: 5, ttlGood: 2400, ttlBad: 1800 },
    /** Не реже, чем раз в c с, пересматривать связь при чтении (дешевле). */
    decayEvery: 4,
    /** Тихая «притирка»: сколько fam добавляется за сидение рядом (раз в scan, если уже знакомы). */
    nearFam: 0.6,
  },

  /**
   * Последствия событий. Мнение меняется на target·k, где k зависит от характера того, кто помнит: обиду
   * сильнее чувствует злопамятный (0.8 + 0.5·grudge), добро — доверчивый (0.8 + 0.5·trust).
   */
  events: {
    talk: { target: 3, actor: 3, witness: 0, fam: 5, memT: 'talked', memA: 'talked', cooldown: 20 },
    argue: { target: -7, actor: -7, witness: 0, fam: 3, memT: 'argued', memA: 'argued', thoughtT: 'argued', thoughtA: 'argued', cooldown: 20 },
    greet: { target: 1, actor: 1, witness: 0, fam: 2, thoughtT: 'greeted', thoughtA: 'greeted', cooldown: 90 },
    intro: { target: 3, actor: 3, witness: 0, fam: 14, memT: 'met', memA: 'met', cooldown: 30 },
    snub: { target: -4, actor: 0, witness: 0, fam: 1, memT: 'snubbed', thoughtT: 'rebuffed', cooldown: 30 },
    hit: { target: -16, actor: -3, witness: -6, fam: 10, memT: 'beat', memA: 'brawled', memW: 'sawBeat', thoughtT: 'beaten', thoughtW: 'sawFight', cooldown: 5, seen: true },
    insult: { target: -12, actor: 0, witness: -2, fam: 5, memT: 'insulted', thoughtT: 'insulted', cooldown: 8, seen: true },
    shoot: { target: -32, actor: -6, witness: -14, fam: 8, memT: 'shot', memA: 'brawled', memW: 'sawShot', thoughtT: 'shotAt', thoughtW: 'sawFight', cooldown: 8, seen: true },
    rob: { target: -26, actor: 0, witness: -14, fam: 8, memT: 'robbed', memW: 'sawRob', thoughtT: 'robbed', cooldown: 20, seen: true },
    help: { target: 22, actor: 5, witness: 4, fam: 8, memT: 'helped', thoughtT: 'helped', thoughtA: 'shared', cooldown: 30, seen: true },
    revive: { target: 32, actor: 7, witness: 6, fam: 10, memT: 'saved', thoughtT: 'helped', cooldown: 30, seen: true },
    feed: { target: 24, actor: 6, witness: 3, fam: 8, memT: 'fed', thoughtT: 'gift', thoughtA: 'shared', cooldown: 60 },
    defend: { target: 20, actor: 4, witness: 4, fam: 7, memT: 'defended', thoughtT: 'helped', cooldown: 20, seen: true },
    // Из рук в руки (посылка, хлеб): получивший теперь знает дарителя в лицо (fam ≥ bond.known).
    gift: { target: 14, actor: 3, witness: 0, fam: 8, memT: 'gift', thoughtT: 'gift', cooldown: 30 },
    arrest: { target: -22, actor: 0, witness: -3, fam: 6, memT: 'arrestedMe', thoughtT: 'arrested', cooldown: 30, seen: true },
    fine: { target: -9, actor: 0, witness: -1, fam: 3, memT: 'fined', thoughtT: 'fined', cooldown: 20 },
    kill: { target: 0, actor: 0, witness: -26, fam: 6, memW: 'sawKill', thoughtW: 'sawDeath', cooldown: 10, seen: true },
    forgive: { target: 10, actor: 8, witness: 0, fam: 3, memT: 'forgave', memA: 'forgave', thoughtT: 'reconciled', thoughtA: 'reconciled', cooldown: 60 },
    gossipGood: { target: 0, actor: 0, witness: 0, fam: 3, memT: 'heardGood', cooldown: 300 },
    gossipBad: { target: 0, actor: 0, witness: 0, fam: 3, memT: 'heardBad', cooldown: 300 },
  } as Record<EventKind, EventDef>,

  /** Свидетели события: в radius px и с прямой видимостью; у убийства и боя — шире. */
  witness: { radius: 320, max: 8 },

  /** Близкие пострадавшего (родня и друзья, мнение от closeOpinion) — при его гибели/аресте. */
  loved: {
    opinion: 28,
    /** Как меняется мнение близких о виновнике: арест — на cp, гибель — на убийцу (если они его знают). */
    arrestOpinion: -10,
    killOpinion: -70,
    /** Лояльность близких Протекторату падает (арест своего, гибель от ВС): очки. */
    loyaltyArrest: -3,
    loyaltyKill: -7,
    /** Близкие, видевшие/узнавшие гибель — горюют (мысль kinDied/friendDied). */
    mournTime: 120,
  },

  /** «Мысли»: вклад в настроение (v), сколько живут (time, с), сколько одинаковых складываются (stack), текст. */
  thoughts: {
    chatFriend: { v: 8, time: 240, stack: 2, text: 'добрая беседа с близким человеком' },
    chat: { v: 3, time: 180, stack: 3, text: 'разговор по душам' },
    greeted: { v: 2, time: 150, stack: 3, text: 'приветливый знакомый' },
    argued: { v: -8, time: 240, stack: 2, text: 'ссора' },
    insulted: { v: -10, time: 240, stack: 2, text: 'оскорбление' },
    beaten: { v: -16, time: 300, stack: 2, text: 'избиение' },
    robbed: { v: -18, time: 400, stack: 2, text: 'ограбление' },
    shotAt: { v: -22, time: 300, stack: 2, text: 'обстрел' },
    sawFight: { v: -2, time: 120, stack: 3, text: 'драка на глазах' },
    sawDeath: { v: -8, time: 300, stack: 2, text: 'чья-то смерть на глазах' },
    friendDied: { v: -26, time: 900, stack: 2, text: 'гибель друга' },
    kinDied: { v: -40, time: 1500, stack: 2, text: 'гибель родного человека' },
    friendHurt: { v: -6, time: 240, stack: 2, text: 'беда с другом' },
    friendArrested: { v: -5, time: 300, stack: 2, text: 'арест близкого' },
    arrested: { v: -18, time: 400, stack: 1, text: 'арест' },
    fined: { v: -7, time: 240, stack: 2, text: 'штраф' },
    helped: { v: 15, time: 600, stack: 2, text: 'помощь в беде' },
    gift: { v: 12, time: 480, stack: 2, text: 'угощение' },
    shared: { v: 5, time: 300, stack: 2, text: 'добрый поступок' },
    comforted: { v: 7, time: 300, stack: 2, text: 'поддержка' },
    reconciled: { v: 8, time: 420, stack: 2, text: 'примирение' },
    ration: { v: 2, time: 300, stack: 1, text: 'паёк получен' },
    rested: { v: 6, time: 600, stack: 1, text: 'хороший сон дома' },
    rebuffed: { v: -4, time: 120, stack: 2, text: 'грубость в ответ' },
  } as Record<ThoughtKind, { v: number; time: number; stack: number; text: string }>,

  /** Настроение −100..100: база от характера + потребности + мысли. Подписи — по порогам (от худшего). */
  mood: {
    labels: [
      { to: -55, name: 'на грани', color: '#d6584a' },
      { to: -28, name: 'подавлен', color: '#d8864b' },
      { to: -9, name: 'хмур', color: '#c9b05a' },
      { to: 12, name: 'спокоен', color: '#a9b8a0' },
      { to: 34, name: 'доволен', color: '#8fc07a' },
      { to: 101, name: 'в духе', color: '#6fd08f' },
    ] as readonly { to: number; name: string; color: string }[],
    /** Базовый тон характера: (kind − temper)·base; плюс привычная жизнь (baseline): люди приспосабливаются. */
    base: 12,
    baseline: 6,
    /** Голод: ниже hungerBelow сытости настроение падает на (hungerBelow − сытость)·hungerMul, ниже starving — ещё. */
    hungerBelow: 38,
    hungerMul: 0.55,
    starving: 14,
    starvingExtra: 12,
    /** Тревога: жёлтый / красный код, розыск, камера. */
    codes: { yellow: -3, red: -9 },
    wanted: -6,
    jailed: -14,
    /** Одиночество: (social − 50)·socialMul. */
    socialMul: 0.22,
    /** Мягкий потолок: сверх from каждое очко давит вполовину слабее (mul). */
    soft: { from: 40, mul: 0.4 },
  },

  /** Потребность в общении 0..100: убывает decay/с, пополняется разговором, приветствием, близкими. */
  social: {
    start: [40, 85] as const,
    decay: 0.075,
    /** Ниже этого — человек тянется к людям (ищет друга или собеседника). */
    lonely: 24,
    /** Сколько даёт: беседа (talk), приветствие (greet), встреча с близким (close). */
    gain: { talk: 22, greet: 4, close: 10 },
  },

  /**
   * Встречи на ходу (раз в scanEvery с на человека, соседей — в greetRange): приветствие знакомого, взгляд
   * на недруга, остановиться с другом поболтать, помощь голодному другу, месть.
   */
  scan: {
    every: 2.2,
    range: 150,
    /** Знакомых приветствует с шансом greetChance × (0.4 + общительность), по паре — не чаще greetCooldown с. */
    greetChance: 0.65,
    greetCooldown: 140,
    replyChance: 0.6,
    /** Друзья, встретившись, останавливаются поболтать: шанс при приветствии (× общительность). */
    chatChance: 0.5,
    /** Незнакомым кивнуть — редко. */
    nodChance: 0.03,
    /** Недругов приветствует недобрым взглядом (шанс), потом — стычка или уход. */
    glareChance: 0.5,
    /** Стычка с недругом: шанс (× вспыльчивость) и порог мнения. */
    confront: { chance: 0.35, opinion: -34, cooldown: 150 },
    /** Робкий уходит от врага: порог храбрости. */
    fleeBelow: 0.35,
    /** Месть: обидчик, о котором помнит обиду, — шанс подраться при встрече (× злопамятность × вспыльчивость). */
    revenge: { chance: 0.5, opinion: -30, within: 900 },
    /** Не затевать при ВС в радиусе, px. */
    copsRange: 280,
    /** Сколько человек за кадр (в среднем каждого — раз в every). */
    maxPerFrame: 3,
    /** Шанс за пересмотр высказать настроение вслух на ходу. */
    moodLine: 0.07,
  },

  /** Друг в беде: заступиться в драке на кулаках (не с вооружённым), помочь голодному, прибежать к раненому. */
  allies: {
    /** Близкие рядом (px, видимость) и порог мнения. */
    radius: 260,
    opinion: 48,
    /** Шанс вступиться: brave × chance (кулаки), не чаще раз в every с на человека и раз в perVictim с на пострадавшего. */
    defendChance: 0.6,
    every: 20,
    perVictim: 25,
    /** На обидчика уже набросились столько — больше не лезут. */
    maxOnAttacker: 2,
    /** Накормить голодного друга/родню (px, сытость ниже hungerBelow, у дарителя — выше fedAbove). */
    shareReach: 130,
    hungerBelow: 42,
    fedAbove: 55,
    /** Голодный идёт просить у друга/родни, если тот не дальше seek px. */
    askSeek: 1500,
    askChance: 0.5,
  },

  /** К другу в гости (как к родне): дальность и вес занятия (× общительность, одиночество — вдвое). */
  friends: { seek: 1500, weight: 2.2, lonelyMul: 2, cooldown: 60 },

  /**
   * Беседа и «лицо» человека: отказ поговорить с недругом (любой несимпатичный незнакомец при плохом
   * настроении), поддержка друга в плохом настроении, примирение, слухи о людях.
   */
  talk: {
    /** Не хотят разговаривать: мнение ниже порога, или плохое настроение (ниже moodBelow) у незнакомца с шансом. */
    refuseOpinion: -22,
    moodBelow: -36,
    strangerRefuse: 0.5,
    /** Слух о человеке: шанс переубедить собеседника (сдвиг мнения × доверие к рассказчику). */
    gossip: { shift: 0.25, minOpinion: 22, minFam: 12, cooldown: 600, w: 1.2 },
    /** Примирение: пока обида не глубже -deepest и злопамятность ниже grudgeMax. */
    apology: { opinion: -42, deepest: 5, grudgeMax: 0.65, w: 1.6, accept: 0.7 },
    /** Весы тем отношений в беседе. */
    weights: { intro: 5, friend: 1.8, thanks: 2.4, comfort: 2.2, moodLow: 1.8, moodHigh: 1.1, memory: 2 },
    /** Темы начинаются, если собеседники в настроении выше/ниже порога. */
    moodLow: -24,
    moodHigh: 26,
  },

  /** Разговор с игроком (E): откат, шанс отказать, окно «ещё раз E — угостить», сколько проходит между репликами. */
  player: { reach: 70, cooldown: 12, giftWindow: 8, askHungerBelow: 48, greetRange: 180, greetCooldown: 160 },

  /** Торговля: цена у продавца — своим скидка (множитель), недоброжелателям — надбавка; врагу не продают. */
  trade: { friend: 0.92, close: 0.82, rival: 1.15 },

  /** Знакомые игрока (клавиша K): сколько показывать, как часто обновлять. */
  contacts: { max: 40, refresh: 1.5 },

  /** Сохранение связей: не меньше fam или с воспоминаниями; не больше max связей. */
  save: { minFam: 4, max: 7000, memories: 2 },

  /** Первичное заселение связей (Relations.seed). */
  seed: {
    kin: { opinion: [30, 58] as const, fam: [70, 96] as const },
    neighbor: { opinion: [3, 16] as const, fam: [22, 42] as const, per: 4, radius: 520 },
    gang: { opinion: [34, 62] as const, fam: [66, 92] as const },
    work: { opinion: [4, 24] as const, fam: [32, 55] as const, per: 4 },
    comrade: { opinion: [18, 46] as const, fam: [55, 80] as const, per: 6 },
    /** Случайные друзья на жителя (граждане и ТС) и шанс недруга. */
    friends: { count: [1, 3] as const, opinion: [30, 56] as const, fam: [30, 62] as const, radius: 760 },
    rival: { chance: 0.22, opinion: [-62, -30] as const, fam: [20, 40] as const, radius: 760 },
    /** Банды между собой — давняя вражда. */
    gangFeud: { opinion: [-70, -40] as const, fam: [22, 44] as const, per: 3 },
  },

  /** Имена отношений — как человек относится к другому. */
  tiers: {
    stranger: 'не знаком',
    acquaintance: 'знакомый',
    friend: 'приятель',
    close: 'близкий друг',
    rival: 'недруг',
    enemy: 'враг',
    kin: 'родня',
  },

  /** Что запомнилось: название (nom), «за …» (acc), знак (+ тёплое, − обида). */
  memories: {
    met: { nom: 'знакомство', acc: 'знакомство', sign: 0 },
    talked: { nom: 'приятный разговор', acc: 'разговор', sign: 1 },
    argued: { nom: 'ссора', acc: 'ссору', sign: -1 },
    brawled: { nom: 'драка', acc: 'драку', sign: -1 },
    beat: { nom: 'избиение', acc: 'избиение', sign: -1 },
    insulted: { nom: 'оскорбление', acc: 'оскорбление', sign: -1 },
    shot: { nom: 'стрельба в него', acc: 'выстрелы', sign: -1 },
    robbed: { nom: 'кража', acc: 'кражу', sign: -1 },
    snubbed: { nom: 'грубость', acc: 'грубость', sign: -1 },
    helped: { nom: 'помощь', acc: 'помощь', sign: 1 },
    saved: { nom: 'спасение', acc: 'спасение', sign: 1 },
    fed: { nom: 'угощение', acc: 'угощение', sign: 1 },
    defended: { nom: 'заступничество', acc: 'заступничество', sign: 1 },
    gift: { nom: 'подарок', acc: 'подарок', sign: 1 },
    arrestedMe: { nom: 'арест', acc: 'арест', sign: -1 },
    arrestedMine: { nom: 'арест близкого', acc: 'арест близкого', sign: -1 },
    fined: { nom: 'штраф', acc: 'штраф', sign: -1 },
    killedMine: { nom: 'гибель близкого', acc: 'гибель близкого', sign: -1 },
    sawBeat: { nom: 'избиение на глазах', acc: 'избиение', sign: -1 },
    sawShot: { nom: 'стрельба на глазах', acc: 'стрельбу', sign: -1 },
    sawRob: { nom: 'грабёж на глазах', acc: 'грабёж', sign: -1 },
    sawKill: { nom: 'убийство на глазах', acc: 'убийство', sign: -1 },
    forgave: { nom: 'примирение', acc: 'примирение', sign: 1 },
    heardGood: { nom: 'добрая молва', acc: 'добрую молву', sign: 1 },
    heardBad: { nom: 'дурная молва', acc: 'дурную молву', sign: -1 },
  } as Record<MemKind, { nom: string; acc: string; sign: -1 | 0 | 1 }>,

  /** Реплики. {aname} — говорящий, {bname} — адресат, {who} — о ком, {why} — за что (винительный падеж). */
  lines: {
    greet: {
      close: ['{Рад|Рада} тебя видеть, {bname}!', 'Здорово, {bname}!', 'О, {bname}! Как жизнь?', '{bname}, привет! Заходи вечером.', 'Давно не виделись, {bname}!', 'Эй, {bname}! Как дела у родных?'],
      friend: ['Привет, {bname}!', 'Здорово, {bname}.', 'О, {bname}! Как оно?', '{bname}, добрый день!', 'Куда путь держишь, {bname}?'],
      kin: ['Ты куда, {bname}?', 'Береги себя, {bname}.', 'Не задерживайся, {bname}.', 'Ты [ел|ела] сегодня, {bname}?'],
      acquaintance: ['Добрый день, {bname}.', 'Здравствуйте, {bname}.', 'А, {bname}. Как дела?', 'Привет, {bname}.', '{bname}.'],
      reply: {
        close: ['Привет, {aname}!', 'И тебе здравствуй!', 'Здорово, {aname}!', '{Рад|Рада} видеть.'],
        acquaintance: ['Здравствуй.', 'Добрый день.', 'Привет.', 'Угу, здравствуй.'],
      },
    },
    /** Недобрые встречи: недруг и враг. */
    glare: {
      rival: ['Опять ты…', 'Смотри, кто пришёл.', 'Не попадайся мне.', 'Тьфу.', 'Лучше обходи меня стороной, {bname}.'],
      enemy: ['Ты ещё здесь?!', 'Я тебе припомню, {bname}.', 'Дождёшься у меня.', '{Не забыл|Не забыла}, {bname}. Ничего не {забыл|забыла}.'],
    },
    /** Стычка с недругом и месть. */
    confront: ['Ну что, {bname}, поговорим?', 'Давно {хотел|хотела} с тобой поговорить, {bname}.', 'Пойдём-ка, {bname}, выясним.', 'Мы с тобой не закончили, {bname}!'],
    revenge: ['Должок за тобой, {bname}!', 'Это тебе за {why}!', '{Думал|Думала}, я {забыл|забыла}?', 'Помнишь меня, {bname}?!'],
    avoid: ['Лучше уйти.', 'Не хочу с ним связываться.', 'Только не он…', 'Пойду другой дорогой.'],
    /** Помощь голодному. */
    ask: ['{bname}, хлеб не найдётся?', 'Не выручишь с едой, {bname}?', 'Третий день впроголодь, {bname}…', '{bname}, поделись, если есть.'],
    give: ['Держи, {bname}, поешь.', 'На, я не голоден — а ты на ногах не стоишь.', '{bname}, возьми, не отказывайся.', 'Бери. Свои же.'],
    thanks: ['Спасибо, {bname}… {выручил|выручила}.', 'Ты настоящий друг, {bname}.', 'Век не забуду.', 'Спасибо. Отдам.'],
    /** Заступились. */
    defend: ['Не трогай {bname}!', 'Отойди от него!', 'Двое на одного? Нет уж!', 'Эй! Он со мной!'],
    defended: ['Спасибо, что {вступился|вступилась}!', 'Свои своих не бросают.', 'Вовремя.'],
    /** Горюют. */
    mourn: ['Не верится…', 'Как же теперь без {who}…', 'Это не может быть правдой.', 'Ещё вчера мы говорили с {who}…', 'За что?..'],
    /** Настроение сквозь слова: плохое и хорошее. */
    moodLow: ['Всё из рук валится.', 'Настроение — хуже некуда.', 'Не могу так больше…', 'Лучше бы я сегодня не {вставал|вставала}.', 'Тяжело на душе.'],
    moodHigh: ['Сегодня хороший день.', 'Жить можно.', 'Что-то на душе легко.', 'Хорошо, когда всё спокойно.'],
    /** Одинокий. */
    lonely: ['Поговорить бы с кем…', 'Сижу один как перст.', 'Хоть бы кто окликнул.'],
    /** Продавец: скидка своим и отказ недругу. */
    discount: ['Для своих — со скидкой, {bname}!', '{bname}, тебе — по-свойски.', 'Своим не жалко, {bname}.'],
    refuse: ['Тебе я ничего не продам.', 'Проходи мимо.', 'С тобой торговать не хочу.'],
    /** Отказ от разговора. */
    rebuff: ['Отстань.', 'Не до тебя.', 'Иди своей дорогой.', 'Не о чём нам говорить.'],
  },

  /**
   * Темы бесед по отношениям (Talk подмешивает их к обычным): A начинает (open), B отвечает (reply), A
   * подхватывает (back). Подстановки: {aname}/{bname} — имена, {who} — о ком речь, {why} — что запомнилось.
   */
  topics: {
    intro: {
      open: ['Давайте знакомиться: я {aname}.', 'Мы, кажется, не знакомы. Я {aname}.', 'Часто вас тут вижу. Я {aname}.', 'Простите, не знаю вашего имени. Я {aname}.'],
      reply: ['Очень приятно. {bname}.', '{bname}. {Рад|Рада} знакомству.', 'Будем знакомы. {bname}.', '{bname}. Вы тоже тут неподалёку живёте?'],
      back: ['Живу рядом, в соседнем доме.', 'Работаю тут неподалёку. Ещё увидимся.', 'Заходите, если что.', 'Хоть одно знакомое лицо в этом городе.'],
    },
    friendAsk: {
      open: ['Как ты, {bname}? Выглядишь [уставшим|уставшей].', 'Как жизнь, {bname}?', '{bname}, ты хоть [ел|ела] сегодня?', 'Давно не виделись. Что нового, {bname}?', 'Как дома, {bname}? Все живы?'],
      reply: ['Держусь. Работы много, сил мало.', 'Нормально. Живы — и ладно.', 'Не жалуюсь. Ты как сам?', 'Сегодня получше, чем вчера.', 'Потихоньку. С тобой хоть поговорить можно.'],
      back: ['Береги себя.', 'Если что — заходи, не стесняйся.', 'Мы друг у друга одни остались.', 'Главное — держаться вместе.'],
    },
    thanks: {
      open: ['Я помню, {bname}: {why}. Я твой должник.', 'Спасибо тебе ещё раз, {bname}. Не {забыл|забыла}…', 'Такое не забывают, {bname}: {why}.'],
      reply: ['Брось, свои же люди.', 'Пустяки. Ты бы так же {поступил|поступила}.', 'Не стоит. Главное — живы.'],
      back: ['Всё равно — спасибо.', 'Если что — я рядом.', 'Должок за мной.'],
    },
    comfort: {
      open: ['Что-то у меня на душе тяжело…', 'Сегодня всё не так, {bname}.', 'Не хочется ни с кем говорить. Только с тобой.', 'Тошно мне, {bname}.'],
      reply: ['Держись. Всё образуется.', 'Выговорись — легче станет.', 'Прорвёмся. Давай пройдёмся.', 'Я рядом, {aname}.'],
      back: ['Спасибо. Правда стало легче.', '{Что бы я без тебя делал|Что бы я без тебя делала}…', 'Пожалуй, ты [прав|права].'],
    },
    apology: {
      open: ['Слушай, {bname}… Давай забудем {why}.', 'Не хочу ходить в обиде. Забудем {why}, {bname}?', '{Погорячился|Погорячилась} я. Забудем {why}, а?'],
      accept: ['Ладно. Забыто.', 'Хорошо. Но больше так не делай.', 'Проехали, {aname}.', 'Мир.'],
      refuse: ['Рано ещё.', 'Я такое не забываю.', 'Не сейчас, {aname}.'],
      back: ['Спасибо, что [выслушал|выслушала].', 'Понимаю. Я подожду.', 'Жаль. Но я {попытался|попыталась}.'],
    },
    gossipGood: {
      open: ['Про {who} плохого не скажу — на таких город держится.', 'Знаешь, {who} — нормальный человек. Не подведёт.', '{who} — из тех, кто в беде не бросит.'],
      agree: ['Согласен. Я тоже так думаю.', 'Да, {слышал|слышала} такое.', 'Хороших людей мало — держись за них.'],
      differ: ['Мне казалось иначе. Но спасибо.', 'Ну, поглядим.', 'Может, я к нему {несправедлив|несправедлива}.'],
      back: ['Вот и славно.', 'Ты сам убедишься.'],
    },
    gossipBad: {
      open: ['Осторожнее с {who}. Нехорошая история.', 'С {who} лучше не связываться.', '{Слышал|Слышала} про {who}? Тёмная личность.', 'Не доверяй {who}. Говорю как есть.'],
      agree: ['Учту.', '{Спасибо, что предупредил|Спасибо, что предупредила}.', 'Я так и {думал|думала}.'],
      differ: ['Мне он казался нормальным…', 'Ко мне — по-хорошему.', 'Это ещё проверить надо.'],
      back: ['Я {предупредил|предупредила}.', 'Дело твоё.'],
    },
    moodLow: {
      open: ['Всё из рук валится…', 'Сегодня сам не свой.', 'Что-то мрачно на душе.', 'Не выспался, и день не задался.'],
      reply: ['С кем не бывает.', 'Держись.', 'Завтра будет лучше.', 'У всех так. Терпи.'],
      back: ['Да, пройдёт.', 'Наверное, ты [прав|права].', 'Хоть {выговорился|выговорилась}.'],
    },
    moodHigh: {
      open: ['Сегодня почему-то хорошо.', 'Давно так спокойно не было.', 'Хороший день, а?'],
      reply: ['Не сглазь.', 'Редкость. Пользуйся.', '{Рад|Рада} за тебя.'],
      back: ['Вот и славно.', 'Жить можно.'],
    },
  } as Record<string, { open: readonly string[]; reply?: readonly string[]; back?: readonly string[]; accept?: readonly string[]; refuse?: readonly string[]; agree?: readonly string[]; differ?: readonly string[] }>,

  /** Разговор с игроком (E). */
  dialog: {
    /** Что игрок говорит первым (по знакомству). */
    say: {
      stranger: ['Здравствуйте.', 'Добрый день. Не подскажете…', 'Простите, можно вас на минуту?', 'Здравствуйте. Меня зовут {aname}.'],
      known: ['Привет, {bname}. Как дела?', 'Добрый день, {bname}.', '{bname}, как жизнь?'],
      friend: ['Здорово, {bname}! Как ты?', '{bname}! Давно не виделись.', 'Привет, {bname}. Что нового?'],
    },
    /** Ответ: по знакомству и настроению. */
    reply: {
      stranger: ['Здравствуйте.', 'Что-то нужно?', 'А мы знакомы? Ладно, {bname} — {aname}.', 'Добрый день.'],
      intro: ['Очень приятно. Меня зовут {aname}.', '{Рад|Рада} познакомиться. {aname}.', '{aname}. Будем знакомы.'],
      known: ['А, здравствуй. Как сам?', 'Привет. Всё как обычно.', 'Здравствуй, {bname}. Давно не {видел|видела}.'],
      friend: ['{bname}! {Рад|Рада} тебя видеть.', 'Здорово! Как жизнь?', 'О, привет! Заходи в гости.'],
      rival: ['Чего тебе?', 'Говорить с тобой не о чем.', 'Уйди, пока {цел|цела}.'],
      enemy: ['Убирайся.', 'Лучше не попадайся мне, {bname}.', 'Не подходи.'],
      kin: ['Родной человек… всё хорошо?', 'Береги себя, {bname}.'],
      low: ['Не до разговоров сегодня…', 'Всё плохо, {bname}. Не спрашивай.', 'Лучше помолчим.'],
      high: ['Всё замечательно, спасибо!', 'Сегодня отличный день!', 'Живём, {bname}!'],
      cp: ['Проходите, гражданин.', 'Не задерживайтесь, гражданин.', 'Разговоры на посту запрещены.'],
    },
    /** Просит еду: у голодного. */
    ask: ['Не найдётся чего-нибудь перекусить?', 'Хлеба не будет? Голодный я.', 'Уже два дня не {ел|ела}. Поможешь?'],
    /** Благодарит, отказывается (сыт), отказ. */
    fed: ['Спасибо… правда {выручил|выручила}. Не забуду.', 'Ты не представляешь, как вовремя!', 'Бог в помощь тебе, {bname}.'],
    full: ['Спасибо, я {сыт|сыта}.', 'Не надо, я не голоден.', 'Оставь себе, мне хватает.'],
    /** Журнал игрока. */
    log: {
      intro: '{who} теперь знает вас.',
      tier: '{who}: теперь вы — {tier}.',
      friend: '{who} считает вас приятелем.',
      grudge: 'У {who} к вам счёт: {why}.',
      fed: 'Вы накормили {who}. Он этого не забудет.',
      nothing: 'У вас нечем угостить.',
      cooldown: '{who} занят разговором — подождите.',
      busy: '{who} сейчас не до разговоров.',
      asleep: '{who} спит — не будите.',
    },
  },
} as const;

/** Название настроения и цвет. */
export function moodLabel(m: number): { name: string; color: string } {
  for (const l of RELATIONS.mood.labels) if (m < l.to) return l;
  return RELATIONS.mood.labels[RELATIONS.mood.labels.length - 1];
}
