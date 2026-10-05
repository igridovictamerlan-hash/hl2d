import type { CpUnitId, FactionId } from './factions';
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
  /**
   * Кэш спрайтов (PawnCache): поля холста вокруг центра пешки (px мира — с запасом на головные
   * уборы, наплечники и ранец), уровней масштаба на удвоение, сколько спрайтов держать.
   */
  cache: { left: 20, right: 20, top: 32, bottom: 20, perOctave: 4, max: 1200 },
  playerRing: 'rgba(255,211,107,0.9)',
  /**
   * Походка (entities/gait.ts, EntityRenderer): пешка не «летает» — ступни переступают, корпус
   * подпрыгивает на каждом шаге и наклоняется в сторону движения. stride — длина шага (px мира);
   * bob — подъём корпуса; lean — наклон на скорости бега (рад), leanMax — предел; sway — покачивание
   * при ходьбе вверх/вниз по экрану; foot — ступни (разнос, высота, размер, вынос шага в профиль,
   * подъём); moving — с какой скорости (px/с) пешка «идёт»; smooth — сглаживание скорости (1/с);
   * hysteresis — запас угла (рад), чтобы на диагонали сторона не мигала; aimRecoil — отдача (град),
   * при которой стреляющий разворачивается к цели, а не по ходу.
   */
  walk: {
    stride: 19,
    bob: 1.3,
    lean: 0.15,
    leanMax: 0.2,
    sway: 0.05,
    foot: { dx: 3.3, y: 14.2, rx: 2.5, ry: 1.6, swing: 3.4, lift: 1.5 },
    moving: 14,
    smooth: 10,
    hysteresis: 0.3,
    aimRecoil: 0.5,
  },
  /**
   * Бытовые анимации (entities/poses.ts, EntityRenderer) — только отрисовка. Всё считается по часам
   * (`now`) и id пешки (фаза сдвинута, чтобы толпа не дышала в такт): тело — тот же спрайт, меняются
   * наклон, сжатие, смещение и руки-кружки с предметами поверх.
   * idle — стоит без дела: вес с ноги на ногу (lean, рад) и дыхание (breathe — доля высоты);
   * sleep — лежит под одеялом: сжатие, дыхание, «z» (every — как часто, rise — подъём px мира);
   * sit — сидит: опускается на drop px, ступни спрятаны, лёгкое покачивание;
   * hand — рука-кружок (r px, rest — где висит в покое), eat — ложка ко рту за period с, cards — карта
   * переворачивается, smoke — раз в period с рука с сигаретой идёт ко рту (raise — доля цикла на подъём,
   * hold — затяжка, exhale — выдох: длительность в долях цикла), talk — жесты говорящего (rate — частота).
   */
  anim: {
    idle: { lean: 0.03, period: 3.4, breathe: 0.014, breathePeriod: 3.1, bob: 0.35 },
    sleep: {
      squash: 0.84, drop: 1.5, breathe: 0.03, period: 3.8, blanketTop: -2.2, blanketBottom: 15.2, blanketHalf: 8.9,
      blankets: ['#7a8fa8', '#a86a5a', '#6f8f6a', '#a89460', '#8a6fa0'], blanketShade: 'rgba(0,0,0,0.16)',
      z: { every: 2.4, rise: 15, size: 3, color: 'rgba(235,238,245,0.9)' },
    },
    sit: { drop: 3.4, squash: 0.9, sway: 0.025, period: 4.6 },
    hand: { r: 2.1, restX: 7.4, restY: 5.5, mouthY: -4.6, spoon: '#b9bcc2', card: '#f1eee4', cigarette: '#ece8dc', ember: '#ff8a3a' },
    eat: { period: 1.9, bite: 0.55, hold: 0.14 },
    cards: { period: 2.6, lift: 0.4 },
    smoke: { period: 6.5, raise: 0.1, hold: 0.14, exhale: 0.2, start: 0.55 },
    talk: { rate: 6.5, amp: 2.6, raise: 1.5, bob: 0.5 },
  },
  /**
   * Одежда по фракциям. base — цвет одежды под бронёй (по умолчанию — цвет ранга),
   * armor — цвет пластин (rank — цвет ранга), head — что на голове.
   *  vest — бронежилет: наплечники, нагрудная пластина, пояс, подсумок (как у пешек RimWorld).
   */
  outfits: {
    citizen: { base: 'rank', head: 'hair', vest: false, collar: '#4f5a66', zip: true },
    cwu: { base: 'rank', head: 'cap', vest: false, cap: '#c9a53e', armband: '#8a8f96' },
    // Повстанцы: синяя рубаха (как в HL2), с солдата — бронежилет и бандана; новобранец — без жилета.
    rebel: { base: '#4d6a86', armor: '#5d6b3a', belt: '#3a2f22', head: 'bandana', cloth: '#7a4a2a', vestFromRank: 1 },
    /**
     * ВС — по юнитам (cpUnits ниже: PCU — flak, SU — recon, CMD.EPU — marine). OTA — силовая броня
     * как у пехотинцев RimWorld (style: 'marine'): крупные наплечники, сегментная кираса, горжет, пояс
     * с подсумками, набедренники, ранец, закрытый шлем с Т-образным визором и решёткой. trim — полосы
     * на наплечниках и шлеме (у ВС — цвет ранга).
     */
    cp: { style: 'flak', base: '#262c36', armor: '#66717c', belt: '#1c2128', trim: 'rank', helmet: '#4f5d6f', visor: '#10151b', shine: '#7fa7cc', head: 'flak' },
    ota: { style: 'marine', base: '#5d6166', armor: '#cfccc1', belt: '#4a4d52', trim: '#7c2a24', helmet: '#d6d3c8', visor: '#15191e', shine: '#9fb3c4', eye: '#ff4a3a', head: 'helmet' },
    admin: { base: '#3b3f46', head: 'hair', vest: false, collar: '#f2f2f2', tie: '#7a1c1c' },
    /** Поднадзорный: серая роба с номером, ошейник-маячок с огоньком. */
    vort: { base: '#7b7f84', head: 'hair', vest: false, convict: true, number: '#ece6d2', band: '#8d949c', light: '#58d0ff' },
  } as Record<FactionId, Record<string, string | boolean | number>>,
  /**
   * Силовой блок по эскизам RimWorld (поверх outfits.cp): style — 'flak' (PCU: каска и стёганый
   * бронежилет, противогаз с линзами), 'recon' (SU: облегчённая сегментная броня, шлем с вырезом для
   * лица и визором поверх балаклавы), 'marine' (CMD.EPU: силовая броня, как у OTA). head: 'flak' —
   * каска, 'peaked' — фуражка, 'recon'/'helmet' — шлемы. vest: false — без жилета (рекрут в форме).
   * acc — аксессуары всегда, accMaybe — у части юнитов (по внешности, доля PAWN.accChance):
   *  radio (рация на груди), lamp (фонарь на плече), chevrons (шевроны цвета ранга), aiguillette
   *  (аксельбант), epaulettes (погоны), grenades (гранаты на поясе), scanner (планшет), medic (повязка
   *  и сумка с крестом), pack (ранец), antenna (антенна на ранце), tank (баллон катафракта), cape
   *  (плащ), coat (длинные полы плаща), band (повязка цвета ранга), pouches (подсумки), bigPads.
   */
  cpUnits: {
    rct: { style: 'flak', head: 'flak', vest: false, acc: 'band', accMaybe: 'radio' },
    pcu3: { style: 'flak', head: 'flak', acc: '', accMaybe: 'radio lamp pouches' },
    pcu2: { style: 'flak', head: 'flak', acc: 'radio', accMaybe: 'lamp pouches' },
    pcu1: { style: 'flak', head: 'flak', acc: 'chevrons radio pouches', accMaybe: 'lamp' },
    ofc: { style: 'flak', head: 'peaked', acc: 'aiguillette epaulettes radio', accMaybe: '', flak: '#3d4654' },
    su3: { style: 'recon', head: 'recon', acc: 'grenades pack pouches', accMaybe: 'lamp antenna' },
    su2: { style: 'recon', head: 'recon', acc: 'medic pack antenna', accMaybe: 'lamp' },
    su1: { style: 'recon', head: 'recon', acc: 'scanner lamp', accMaybe: 'radio' },
    guard: { style: 'recon', head: 'recon', acc: 'bigPads radio pouches', accMaybe: 'lamp', armor: '#4c5560' },
    insp: { style: 'recon', head: 'peaked', acc: 'coat epaulettes scanner', accMaybe: '', armor: '#3b434d', coat: '#1f2328' },
    epu: { style: 'marine', head: 'helmet', acc: 'cape epaulettes bigPads', accMaybe: '', base: '#1b1d21', armor: '#2b2e33', helmet: '#26292e', belt: '#141518', trim: '#d9b24a', visor: '#0d0f12', shine: '#e8c870', eye: '#ffcf4a', eyes: 1, cape: '#6e1414' },
    qm: { style: 'recon', head: 'recon', acc: 'scanner pouches', accMaybe: 'lamp', armor: '#55604f' },
    /** Курсант — форменная рубашка без брони, лицо открыто, пилотка (head 'cadet'). */
    cdt: { style: 'flak', head: 'cadet', vest: false, acc: 'band', accMaybe: '', cap: '#2c3f57' },
    /** Инструктор — фуражка, шевроны и погоны, рация. */
    instr: { style: 'flak', head: 'peaked', acc: 'chevrons epaulettes radio', accMaybe: 'pouches', flak: '#45505e' },
  } as Record<CpUnitId, Record<string, string | boolean | number>>,
  /** Доля юнитов с необязательным аксессуаром (accMaybe). */
  accChance: 0.5,
  /** Цвета аксессуаров и деталей силового блока. */
  gear: {
    flak: '#56606d',
    flakDark: '#3e4651',
    helmet: '#4b5563',
    mask: '#2a2e34',
    lens: '#bfe3ff',
    lensRim: '#12161a',
    shine: '#ffffff',
    filter: '#3b4148',
    reconArmor: '#66717c',
    balaclava: '#1c1f24',
    reconVisor: '#16212c',
    reconGlow: '#7fd4ff',
    radio: '#2b2f33',
    lamp: '#3a3f45',
    lampLens: '#ffe9a8',
    gold: '#d9b24a',
    buckle: '#9aa3ab',
    cap: '#232a35',
    peak: '#0e1013',
    antenna: '#16181b',
    grenade: '#4f5f3a',
    scanner: '#26303a',
    screen: '#8fffc8',
    medic: '#f2f2f2',
    cross: '#c93030',
    pack: '#3a4048',
    tank: '#b9bcb6',
    boot: '#1b1e22',
  },
  /**
   * Военное снаряжение сопротивления (style: 'tactical', entities/pawnTactical.ts): пятна камуфляжа
   * (доли ширины/высоты, радиусы px, поворот), доля бойцов в балаклаве у 'maybeMask', цвета деталей.
   */
  tactical: {
    camoSpots: [
      [0.15, 0.2, 3.2, 1.8, 0.4], [0.55, 0.12, 2.6, 1.5, -0.3], [0.85, 0.35, 3, 1.7, 0.8],
      [0.3, 0.55, 2.8, 1.6, -0.6], [0.7, 0.62, 3.4, 1.8, 0.2], [0.1, 0.85, 2.4, 1.4, 1.1],
      [0.5, 0.9, 3, 1.5, -0.2], [0.9, 0.82, 2.2, 1.3, 0.5],
    ] as readonly (readonly [number, number, number, number, number])[],
    maskChance: 0.45,
    belt: '#2c2a24',
    rail: '#1f2124',
    strap: '#26282a',
    nvg: '#1a1c1e',
    lensShine: 'rgba(255,255,255,0.5)',
    patch: '#2a2c2e',
    lambda: '#e07a2a',
  },
  /** Обувь по фракциям (ступни при ходьбе); нет в списке — gear.boot. */
  boots: { citizen: '#3b3029', cwu: '#35302a', rebel: '#3a2f22', admin: '#16171a', vort: '#2f3134', ota: '#2c2f33' } as Partial<Record<FactionId, string>>,
  /**
   * Одежда по профессиям — поверх фракционной (перекрывает её поля): белый халат медика ТС с
   * красным крестом, поварской колпак и фартук, тёмная куртка с капюшоном вора, рваньё отброса,
   * повязка медика и очки пиротехника у повстанцев, санитар — синтет в плаще с маской.
   */
  professionOutfits: {
    cwu_medic: { base: '#e6e4dc', head: 'hair', cross: '#c93030', collar: '#cfccc4' },
    // Глава ТС — костюм цвета ТС с жёлтым галстуком и повязкой, без кепки.
    cwu_head: { base: '#4a4638', head: 'hair', collar: '#e8e2d0', tie: '#c9a53e', armband: '#c9a53e', zip: false },
    cook: { head: 'chef', chef: '#f4f2ec', apron: '#f1efe8' },
    courier: { cap: '#8b6a3e', bag: '#7a5a38' },
    janitor: { cap: '#7d848c', hivis: '#e8e04a' },
    loader: { cap: '#5e6b47', hivis: '#e8943a' },
    armorer: { head: 'hair', apron: '#5a4632' },
    thief: { base: '#3a3d44', head: 'hood', hood: '#2e3137', zip: false, collar: false },
    outcast: { base: '#6b5d48', patch: '#4d4234', zip: false, collar: false },
    /**
     * Армия сопротивления — военная экипировка (style: 'tactical', поля — entities/pawnTactical.ts).
     * Новобранец — полевая форма и кепи; солдат, пиро, подрывник — шлем и разгрузка; ветераны — камуфляж
     * мультикам, плитник, шлем в чехле с очками, часть в балаклаве; HYDRA — как SAS: тёмный комбинезон,
     * серый жилет, чёрный шлем с креплением ПНВ, противогаз S10 с синим фильтром.
     */
    rebel_recruit: { style: 'tactical', base: '#5d6443', head: 'cap', cap: '#4c5436', face: 'bare', lambda: '#e07a2a', acc: '', accMaybe: '' },
    rebel_soldier: { style: 'tactical', base: '#56603f', camo: '#4a5336 #666f4c', rig: 'chest', rigColor: '#4a5234', head: 'helmet', helmet: '#555e41', face: 'bare', lambda: '#e07a2a', acc: '', accMaybe: 'pouches radio' },
    rebel_medic: { style: 'tactical', base: '#8a7f5e', camo: '#6e6a45 #a8956a #5a4a34 #8f8a62', rig: 'plate', rigColor: '#7d6c4f', head: 'helmet', helmet: '#7d6c4f', helmetCamo: true, hgoggles: '#2e3a44', face: 'maybeMask', mask: '#3a3a30', lambda: '#e07a2a', acc: 'medic', accMaybe: 'radio' },
    veteran: { style: 'tactical', base: '#8a7f5e', camo: '#6e6a45 #a8956a #5a4a34 #8f8a62', rig: 'plate', rigColor: '#7d6c4f', head: 'helmet', helmet: '#7d6c4f', helmetCamo: true, hgoggles: '#2e3a44', face: 'maybeMask', mask: '#3a3a30', lambda: '#e07a2a', acc: 'radio pouches', accMaybe: 'grenades lamp' },
    pyro: { style: 'tactical', base: '#5a5a48', camo: '#4a4a3a #6a6852', rig: 'chest', rigColor: '#4c4a3a', head: 'helmet', helmet: '#555546', face: 'bare', goggles: '#ff8a3a', lambda: '#e07a2a', acc: 'grenades', accMaybe: 'pouches' },
    // Армия сопротивления: глава — красный берет и повязка; подрывник — патронташ с гранатами.
    // Глава восстания Патрик: спецброня как у OTA (оливковая, красные полосы), без шлема — красный берет.
    rebel_leader: { style: 'marine', head: 'beret', beret: '#a31a1a', base: '#2e3228', armor: '#6a6f52', helmet: '#6a6f52', belt: '#2a2a22', trim: '#b3261e', visor: '#15191e', shine: '#9fb3c4', acc: 'bigPads', accMaybe: '' },
    // Коммандос HYDRA — SAS в полном снаряжении: гранаты, ранец, рация, красная нашивка.
    commando: { style: 'tactical', base: '#262e3b', rig: 'plate', rigColor: '#44473f', head: 'helmet', helmet: '#1f2124', nvg: true, face: 'gasmask', mask: '#17181a', lens: '#2c3a46', filter: '#232629', filterRing: '#4d86b8', armband: '#c0271c', acc: 'grenades pack radio pouches', accMaybe: '' },
    // Спецагент (без маскировки): тёмный плащ.
    spec_agent: { base: '#2a2b2f', head: 'hood', hood: '#1f2024', zip: false, collar: false },
    // Снайпер HYDRA — SAS без жилета с подсумками, серебряная нашивка.
    hydra_sniper: { style: 'tactical', base: '#283241', rig: 'chest', rigColor: '#3f423c', head: 'helmet', helmet: '#202225', face: 'gasmask', mask: '#17181a', lens: '#2c3a46', filter: '#232629', filterRing: '#4d86b8', armband: '#8fb0c8', acc: 'radio', accMaybe: '' },
    demolitionist: { style: 'tactical', base: '#56603f', camo: '#4a5336 #666f4c', rig: 'chest', rigColor: '#4a5234', head: 'helmet', helmet: '#555e41', face: 'bare', bandolier: '#8a6a36', nade: '#6f9a4a', lambda: '#e07a2a', acc: 'grenades', accMaybe: 'radio' },
    // HYDRA (как SAS): тёмно-синий комбинезон, серый жилет, чёрный шлем MICH с креплением ПНВ,
    // противогаз S10; у сержанта — серебряная нашивка.
    hydra_sergeant: { style: 'tactical', base: '#283241', rig: 'plate', rigColor: '#484b45', head: 'helmet', helmet: '#202225', nvg: true, face: 'gasmask', mask: '#17181a', lens: '#2c3a46', filter: '#232629', filterRing: '#4d86b8', armband: '#b8bcc2', acc: 'radio pouches', accMaybe: 'grenades' },
    hydra_rct: { style: 'tactical', base: '#283241', rig: 'plate', rigColor: '#484b45', head: 'helmet', helmet: '#202225', nvg: true, face: 'gasmask', mask: '#17181a', lens: '#2c3a46', filter: '#232629', filterRing: '#4d86b8', acc: 'grenades', accMaybe: 'radio pouches' },
    // Бандит — тёмная куртка и платок на лице; беглец — оранжевая роба.
    bandit: { base: '#2c2623', facemask: '#1d1d1f', collar: '#3a322d', zip: false },
    fugitive: { base: '#c8692a', patch: '#8f4a1e', collar: false, zip: false },
    // OTA (силовая броня RimWorld, шлем с Т-визором): ALPHA — серо-синяя броня, два голубых глаза, ранец;
    // KING (катафракт) — белая броня, красные полосы, один красный глаз, баллон за спиной.
    ota_alpha: { armor: '#6b7781', helmet: '#5c6873', trim: '#39424a', eye: '#58d0ff', eyes: 2, acc: 'pack grenades', accMaybe: 'antenna lamp' },
    ota_king: { armor: '#eceae2', helmet: '#f1efe8', trim: '#9e1d18', eye: '#ff2a1a', eyes: 1, acc: 'tank bigPads grenades', accMaybe: '' },
    cremator: { style: 'cremator', coat: '#3a3833', skin: '#d8cfc4', mask: '#57544d', tank: '#6d7176', eye: '#b8e04a' },
  } as Partial<Record<ProfessionId, Record<string, string | boolean | number>>>,
} as const;
