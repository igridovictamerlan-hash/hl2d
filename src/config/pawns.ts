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
   * уборы, наплечники и ранец), шаг квантования масштаба, сколько спрайтов держать.
   */
  cache: { left: 20, right: 20, top: 32, bottom: 20, step: 1 / 16, max: 600 },
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
   * Одежда по фракциям. base — цвет одежды под бронёй (по умолчанию — цвет ранга),
   * armor — цвет пластин (rank — цвет ранга), head — что на голове.
   *  vest — бронежилет: наплечники, нагрудная пластина, пояс, подсумок (как у пешек RimWorld).
   */
  outfits: {
    citizen: { base: 'rank', head: 'hair', vest: false, collar: '#4f5a66', zip: true },
    cwu: { base: 'rank', head: 'cap', vest: false, cap: '#c9a53e', armband: '#8a8f96' },
    rebel: { base: 'rank', armor: '#5d6b3a', belt: '#3a2f22', head: 'bandana', cloth: '#7a4a2a', vestFromRank: 1 },
    /**
     * ГО — по юнитам (cpUnits ниже: PCU — flak, SU — recon, CMD.EPU — marine). OTA — силовая броня
     * как у пехотинцев RimWorld (style: 'marine'): крупные наплечники, сегментная кираса, горжет, пояс
     * с подсумками, набедренники, ранец, закрытый шлем с Т-образным визором и решёткой. trim — полосы
     * на наплечниках и шлеме (у ГО — цвет ранга).
     */
    cp: { style: 'flak', base: '#262c36', armor: '#66717c', belt: '#1c2128', trim: 'rank', helmet: '#4f5d6f', visor: '#10151b', shine: '#7fa7cc', head: 'flak' },
    ota: { style: 'marine', base: '#5d6166', armor: '#cfccc1', belt: '#4a4d52', trim: '#7c2a24', helmet: '#d6d3c8', visor: '#15191e', shine: '#9fb3c4', eye: '#ff4a3a', head: 'helmet' },
    admin: { base: '#3b3f46', head: 'hair', vest: false, collar: '#f2f2f2', tie: '#7a1c1c' },
    /** Вортигонт: сутулое зеленоватое тело, большой красный глаз и два малых, металлический ошейник раба. */
    vort: { style: 'vort', skin: '#7f9a62', spots: '#5f7a48', eye: '#e2342a', collar: '#8d949c', light: '#58d0ff' },
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
  /** Обувь по фракциям (ступни при ходьбе); нет в списке — gear.boot. */
  boots: { citizen: '#3b3029', cwu: '#35302a', rebel: '#3a2f22', admin: '#16171a', vort: '#6d8753', ota: '#2c2f33' } as Partial<Record<FactionId, string>>,
  /**
   * Одежда по профессиям — поверх фракционной (перекрывает её поля): белый халат медика ГСР с
   * красным крестом, поварской колпак и фартук, тёмная куртка с капюшоном вора, рваньё отброса,
   * повязка медика и очки пиротехника у повстанцев, крематор — синтет в плаще с маской.
   */
  professionOutfits: {
    cwu_medic: { base: '#e6e4dc', head: 'hair', cross: '#c93030', collar: '#cfccc4' },
    // Глава ГСР — костюм цвета ГСР с жёлтым галстуком и повязкой, без кепки.
    cwu_head: { base: '#4a4638', head: 'hair', collar: '#e8e2d0', tie: '#c9a53e', armband: '#c9a53e', zip: false },
    cook: { head: 'chef', chef: '#f4f2ec', apron: '#f1efe8' },
    courier: { cap: '#8b6a3e', bag: '#7a5a38' },
    janitor: { cap: '#7d848c', hivis: '#e8e04a' },
    thief: { base: '#3a3d44', head: 'hood', hood: '#2e3137', zip: false, collar: false },
    outcast: { base: '#6b5d48', patch: '#4d4234', zip: false, collar: false },
    rebel_medic: { armband: '#f2f2f2', armbandCross: '#c93030' },
    pyro: { goggles: '#ff8a3a' },
    // Армия сопротивления: глава — красный берет и повязка; подрывник — патронташ с гранатами.
    rebel_leader: { head: 'beret', beret: '#8e1b1b', armband: '#b3261e' },
    demolitionist: { bandolier: '#8a6a36', nade: '#6f9a4a' },
    // HYDRA (как SAS): чёрная форма и балаклава, бронежилет с первого ранга, противогаз с круглыми
    // линзами и фильтром; нашивка на плече — капитан золотом, офицеры серебром.
    hydra_captain: { base: '#1c1e21', armor: '#2c2f2c', belt: '#151618', head: 'respirator', mask: '#16171a', rubber: '#26282b', lens: '#3c5560', filter: '#3a3d40', vestFromRank: 0, collar: false, zip: false, armband: '#c9a53e' },
    hydra_officer: { base: '#1c1e21', armor: '#2c2f2c', belt: '#151618', head: 'respirator', mask: '#16171a', rubber: '#26282b', lens: '#3c5560', filter: '#3a3d40', vestFromRank: 0, collar: false, zip: false, armband: '#b8bcc2' },
    hydra_soldier: { base: '#1c1e21', armor: '#2c2f2c', belt: '#151618', head: 'respirator', mask: '#16171a', rubber: '#26282b', lens: '#3c5560', filter: '#3a3d40', vestFromRank: 0, collar: false, zip: false },
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
