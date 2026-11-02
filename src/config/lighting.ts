/** Цвет RGB 0..255. */
export type Rgb = readonly [number, number, number];

/** Ключевая точка суток: доля суток at (0 — полночь, 0.5 — полдень), свет вокруг, насколько горят лампы. */
export interface DayKey {
  at: number;
  ambient: Rgb;
  lamps: number;
  name: string;
}

/** Источник света по точке интереса карты (POI): цвет, радиус (px мира), яркость, горит ли только в темноте. */
export interface PoiLight {
  color: Rgb;
  radius: number;
  power: number;
  /** true — горит, когда темно (лампа в комнате, прожектор); false — всегда (костёр). */
  night: boolean;
  /** Светится само (мягкое пятно поверх — лампа в окне, костёр). */
  bloom?: boolean;
  /** Мерцание 0..1 (огонь). */
  flicker?: number;
}

/**
 * Освещение (world/Lighting.ts) — только картинка, логику не трогает.
 * Сутки длятся dayLength с игрового времени, игра начинается с доли start (закат — сразу уютно).
 * Карта света (в lightmapScale от экрана): заливка «окружающим» светом суток, поверх — источники
 * сложением (мягкие пятна-спрайты), потом умножается на картинку: днём почти не меняет, вечером
 * тёплая, ночью синеватая — а у фонарей, окон, бочек и костров тёплые круги. Сверху — свечение
 * (bloom) самих ламп и огня. В канализации свои сумерки (sewer), у люков — свет сверху.
 */
export const LIGHTING = {
  dayLength: 1080,
  start: 0.71,
  /** Разрешение карты света по умолчанию (доля экрана); в игре — по качеству атмосферы (ATMOSPHERE.presets). */
  lightmapScale: 0.25,
  /**
   * Палитра суток (умножается на картинку): глубокая лунная синева ночью (читается, без черноты), розовато-сиреневый
   * рассвет, тёплое утро, светлый день, золотой час перед закатом, закат, «синий час» после него — фонари уже горят.
   */
  keys: [
    { at: 0.0, ambient: [98, 110, 172], lamps: 1, name: 'ночь' },
    { at: 0.17, ambient: [94, 106, 168], lamps: 1, name: 'ночь' },
    { at: 0.205, ambient: [120, 120, 178], lamps: 1, name: 'предрассветье' },
    { at: 0.235, ambient: [206, 168, 190], lamps: 0.7, name: 'рассвет' },
    { at: 0.26, ambient: [255, 208, 172], lamps: 0.1, name: 'восход' },
    { at: 0.31, ambient: [255, 236, 214], lamps: 0, name: 'утро' },
    { at: 0.5, ambient: [255, 250, 240], lamps: 0, name: 'день' },
    { at: 0.63, ambient: [255, 240, 216], lamps: 0, name: 'день' },
    { at: 0.7, ambient: [255, 214, 160], lamps: 0.1, name: 'закат' },
    { at: 0.77, ambient: [250, 168, 122], lamps: 0.6, name: 'закат' },
    { at: 0.81, ambient: [166, 132, 180], lamps: 1, name: 'сумерки' },
    { at: 0.86, ambient: [120, 120, 182], lamps: 1, name: 'вечер' },
    { at: 0.91, ambient: [100, 112, 174], lamps: 1, name: 'ночь' },
    { at: 1.0, ambient: [98, 110, 172], lamps: 1, name: 'ночь' },
  ] as readonly DayKey[],
  /**
   * Пятно света (спрайт на цвет): ядро светлее (core — доля до белого), спад мягкий, как от лампы под абажуром:
   * [доля радиуса, яркость].
   */
  falloff: {
    core: 0.3,
    stops: [[0, 1], [0.12, 0.95], [0.3, 0.72], [0.5, 0.43], [0.7, 0.18], [0.86, 0.06], [1, 0]] as readonly (readonly [number, number])[],
  },
  /**
   * Облака: мягкий шум (texture px на тайл size px мира) плывёт по ветру (speed px/с) и затеняет свет суток — днём
   * сильнее (day: тенью цвета shade обычным наложением), в лунную ночь слабее (night: в карте света); свет ламп облака
   * не трогают.
   */
  clouds: { texture: 96, size: 900, speed: [7, 2.5] as const, day: 0.3, night: 0.2, octaves: 4, seed: 0xc10d, shade: [38, 48, 86] as Rgb },
  /** Виньетка — в карте света (без отдельного прохода): от доли inner радиуса к краю темнее до edge (тёплый). */
  vignette: { inner: 0.45, edge: [168, 150, 136] as Rgb },
  /** Туман войны по времени суток: днём — тёмный нейтральный, ночью — тёмно-синий, как ночное небо. */
  fog: { day: [3, 5, 8, 0.74] as const, night: [8, 12, 30, 0.64] as const },
  /** Тени людей от солнца: длина — доля тени этажа, ширина px, прозрачность (× бледнения у восхода и заката). */
  pawnShadow: { len: 0.6, width: 4.2, alpha: 0.42 },
  /** Канализация — вечные сумерки. */
  sewer: [74, 78, 88] as Rgb,
  /** Фонарь улицы: плафон на кронштейне (head px от стены). */
  lamp: { color: [255, 194, 122] as Rgb, radius: 160, power: 1.1, head: 12 },
  /** Бочка с огнём и костёр лагеря сопротивления. */
  barrel: { color: [255, 138, 58] as Rgb, radius: 104, power: 1, flicker: 0.22 },
  campfire: { color: [255, 140, 60] as Rgb, radius: 170, power: 1, flicker: 0.25 },
  /** Своё свечение вокруг игрока — чтобы ночью видеть себя и шаг вокруг. */
  player: { color: [120, 112, 104] as Rgb, radius: 130, power: 0.7 },
  /** Узлы Протектората (терминалы у стен) — холодный голубой. */
  node: { color: [110, 180, 255] as Rgb, radius: 46, power: 0.8 },
  /** Пламя на земле, взрыв, вспышка выстрела (живёт muzzleTime с), горящий человек. */
  fire: { color: [255, 130, 50] as Rgb, radiusMul: 2.2, power: 1, flicker: 0.3 },
  blast: { color: [255, 170, 90] as Rgb, radiusMul: 3.2, power: 1.4 },
  muzzle: { color: [255, 205, 130] as Rgb, radius: 90, power: 0.9, time: 0.07 },
  burning: { color: [255, 120, 40] as Rgb, radius: 70, power: 0.9 },
  /** Фонарь в передовом блиндаже повстанцев: тёплый, мерцает, горит ночью; разрушен — гаснет (Dugout.broken). */
  dugout: { color: [255, 186, 108] as Rgb, radius: 62, power: 0.75, flicker: 0.12 },
  /** Люк в канализации: свет сверху. */
  hatch: { color: [210, 205, 180] as Rgb, radius: 70, power: 0.6 },
  /**
   * Свет в окнах (world/windows.ts, lit): пятно на мостовой перед окном (spill — тайлов от середины стены наружу) и
   * само стекло — светится тёплым glass поверх ночи (MapRenderer.drawLitWindows, яркость glow × свет ламп суток).
   * Окна гаснут поздно ночью — у каждого свой час отбоя off (доля суток; после полуночи — больше 1: 1.05 — это
   * 01:12), доля wakeShare зажигается снова рано утром (wake), пока не рассвело.
   */
  window: {
    color: [255, 198, 124] as Rgb, radius: 40, power: 0.85, spill: 1.1, glass: '#ffd283', glow: 0.9,
    off: [0.95, 1.1] as const, wake: [1.19, 1.26] as const, wakeShare: 0.35,
  },
  /**
   * Комнаты и места по POI. Жилые — тёплые лампы (дом, общежитие, особняк), Протекторат — холодный
   * белый (Управа, КПЗ, цех ТС), КПП — прожекторы у постов.
   */
  pois: {
    home: { color: [255, 184, 104], radius: 100, power: 1, night: true, bloom: true },
    dorm_common: { color: [255, 180, 100], radius: 120, power: 1, night: true, bloom: true },
    dorm_table: { color: [255, 200, 120], radius: 60, power: 0.6, night: true },
    villa_living: { color: [255, 190, 120], radius: 130, power: 1, night: true, bloom: true },
    cwu_canteen: { color: [255, 205, 140], radius: 110, power: 0.9, night: true, bloom: true },
    cwu_lounge: { color: [255, 190, 120], radius: 90, power: 0.9, night: true, bloom: true },
    cwu_office: { color: [255, 200, 130], radius: 80, power: 0.9, night: true, bloom: true },
    cwu_lobby: { color: [230, 225, 205], radius: 90, power: 0.7, night: true },
    ration_line: { color: [215, 235, 255], radius: 70, power: 0.7, night: true },
    clerk_desk: { color: [220, 235, 255], radius: 70, power: 0.6, night: true },
    bunk: { color: [200, 220, 255], radius: 60, power: 0.45, night: true },
    ota_spot: { color: [170, 205, 255], radius: 60, power: 0.5, night: true },
    nexus_desk: { color: [210, 225, 255], radius: 110, power: 0.8, night: true },
    code_terminal: { color: [255, 120, 90], radius: 40, power: 0.6, night: false },
    recruit_terminal: { color: [255, 215, 120], radius: 50, power: 0.7, night: false },
    nexus_gate: { color: [190, 215, 255], radius: 140, power: 0.9, night: true },
    gate_post: { color: [205, 225, 255], radius: 120, power: 0.85, night: true },
    // ГЭС: прожекторы у ворот, машинный зал, турбины и трансформаторы — холодный свет.
    ges_post: { color: [205, 225, 255], radius: 130, power: 0.9, night: true, bloom: true },
    border_booth: { color: [210, 230, 255], radius: 110, power: 0.85, night: true, bloom: true },
    border_table: { color: [225, 238, 255], radius: 90, power: 0.8, night: true, bloom: true },
    ges_hall: { color: [200, 220, 255], radius: 150, power: 0.9, night: true },
    ges_turbine: { color: [170, 220, 255], radius: 70, power: 0.7, night: false, bloom: true },
    ges_transformer: { color: [215, 235, 255], radius: 80, power: 0.6, night: true, bloom: true },
    // Порт: прожекторы кранов и склад.
    port_crane: { color: [225, 238, 255], radius: 150, power: 0.85, night: true, bloom: true },
    port_warehouse: { color: [255, 214, 150], radius: 120, power: 0.8, night: true },
    checkpoint_post: { color: [205, 225, 255], radius: 120, power: 0.8, night: true },
    restricted_gate: { color: [200, 220, 255], radius: 120, power: 0.8, night: true },
    industrial_yard: { color: [255, 170, 90], radius: 150, power: 0.75, night: true },
    plaza_center: { color: [255, 205, 140], radius: 170, power: 0.55, night: true },
    cell: { color: [200, 215, 240], radius: 45, power: 0.4, night: true },
    common_cell: { color: [200, 215, 240], radius: 70, power: 0.45, night: true },
    camp_cache: { color: [255, 170, 90], radius: 60, power: 0.5, night: false, flicker: 0.1 },
    black_market: { color: [255, 175, 95], radius: 100, power: 0.8, night: false, flicker: 0.1 },
    ration_window: { color: [255, 215, 150], radius: 100, power: 0.9, night: true, bloom: true },
    shop_counter: { color: [255, 205, 130], radius: 90, power: 0.8, night: true, bloom: true },
    // Улица старого города: лавки и кафе светят витринами, столовая — большим залом, ларёк — окошком.
    vendor_spot: { color: [255, 200, 125], radius: 95, power: 0.85, night: true, bloom: true },
    shop_front: { color: [255, 210, 140], radius: 70, power: 0.6, night: true, bloom: true },
    canteen: { color: [255, 205, 135], radius: 150, power: 0.9, night: true, bloom: true },
    kiosk: { color: [255, 215, 150], radius: 55, power: 0.7, night: true, bloom: true },
    rebel_camp: { color: [255, 140, 60], radius: 170, power: 1, night: false, flicker: 0.25 },
    rebel_base: { color: [255, 170, 90], radius: 150, power: 0.9, night: false, flicker: 0.12 },
    rebel_cache: { color: [255, 180, 100], radius: 80, power: 0.7, night: false, flicker: 0.1 },
    trader: { color: [255, 190, 110], radius: 90, power: 0.8, night: false, flicker: 0.1 },
    // Тюрьма Протектората: двор и коридор — холодные прожекторы у постов, караулка и допросная — лампы.
    prison_post: { color: [210, 228, 255], radius: 120, power: 0.85, night: true, bloom: true },
    // Академия ВС: класс, кубрик, столовая и кабинет — тёплые лампы; тир и вахта — холодный свет.
    academy_class: { color: [255, 215, 160], radius: 90, power: 0.8, night: true, bloom: true },
    academy_barracks: { color: [255, 205, 150], radius: 80, power: 0.7, night: true },
    academy_mess: { color: [255, 210, 150], radius: 80, power: 0.75, night: true },
    academy_office: { color: [255, 205, 140], radius: 70, power: 0.8, night: true, bloom: true },
    academy_range: { color: [220, 232, 255], radius: 130, power: 0.8, night: true },
    academy_vakhta: { color: [215, 230, 255], radius: 90, power: 0.85, night: true, bloom: true },
    academy_lobby: { color: [215, 230, 255], radius: 70, power: 0.6, night: true },
    prison_office: { color: [255, 205, 140], radius: 80, power: 0.8, night: true, bloom: true },
    prison_guardroom: { color: [255, 200, 130], radius: 70, power: 0.8, night: true, bloom: true },
    prison_evidence: { color: [215, 230, 255], radius: 60, power: 0.6, night: true },
    // Тюрьма 2.0: приёмная, шлюз и оружейная — холодный белый, допросная — резкая лампа над столом,
    // мачты площадки — прожекторы, посадочные маяки — красные (мигают — PrisonRenderer).
    prison_reception: { color: [215, 230, 255], radius: 110, power: 0.8, night: true, bloom: true },
    prison_sally: { color: [210, 226, 255], radius: 60, power: 0.6, night: true },
    prison_armory: { color: [220, 232, 255], radius: 70, power: 0.7, night: true },
    prison_itable: { color: [255, 225, 160], radius: 50, power: 1, night: true, bloom: true },
    prison_mast: { color: [225, 235, 255], radius: 130, power: 0.9, night: true, bloom: true },
    prison_beacon: { color: [255, 70, 50], radius: 40, power: 0.5, night: true },
    // Склад Протектората: зал и контора — холодный белый, площадка — прожекторы у постов, мастерская и
    // караулка — тёплые лампы, маяк площадки — красный (мигает — ArsenalRenderer).
    arsenal_hall: { color: [215, 230, 255], radius: 120, power: 0.75, night: true },
    arsenal_office: { color: [220, 232, 255], radius: 80, power: 0.75, night: true },
    arsenal_window: { color: [255, 220, 160], radius: 50, power: 0.6, night: true, bloom: true },
    arsenal_workshop: { color: [255, 196, 120], radius: 90, power: 0.9, night: true, bloom: true },
    arsenal_guardroom: { color: [255, 200, 130], radius: 70, power: 0.8, night: true, bloom: true },
    arsenal_post: { color: [205, 225, 255], radius: 110, power: 0.8, night: true },
    arsenal_beacon: { color: [255, 70, 50], radius: 60, power: 0.7, night: false },
    arsenal_mast: { color: [225, 238, 255], radius: 150, power: 0.85, night: true, bloom: true },
    arsenal_issue_room: { color: [255, 214, 150], radius: 80, power: 0.85, night: true, bloom: true },
    arsenal_breakroom: { color: [255, 190, 115], radius: 90, power: 0.9, night: true, bloom: true },
    arsenal_vault_room: { color: [200, 220, 255], radius: 70, power: 0.6, night: true },
  } as Record<string, PoiLight>,
  /**
   * Солнце и тени от зданий (world/shadows.ts — солнце, world/ShadowRenderer.ts — тени в кусках карты). Восход rise и
   * закат set — доли суток; солнце идёт с востока через юг на запад: тени утром на запад, в полдень на север
   * (короткие), вечером на восток. Длина тени этажа — storey px мира × высота солнца (lenNoon в полдень, у горизонта —
   * до lenMax); у восхода и заката тени бледнеют за fade (ступенями: alphaLevels). Тень (alpha) ложится на землю, пол
   * и низкие укрытия, но не на стены и крыши; penumbra — светлый край тени (× длины, вполовину темнее). Тени запекаются
   * в куски карты: кусок перерисовывается, когда солнце сдвинулось на шаг (steps за световой день). Освещение
   * выключено (меню) — солнце стоит в still (доля суток).
   */
  sun: {
    rise: 0.24, set: 0.8, fade: 0.04, alpha: 0.36, alphaLevels: 6, storey: 8, lenNoon: 0.75, lenMax: 3, penumbra: 1.3, steps: 48, still: 0.42,
    /** Цвет тени: в полдень — холодная синяя (свет неба), у горизонта — сиреневая; не чёрная. */
    noon: [30, 46, 104] as Rgb, low: [74, 40, 100] as Rgb,
  },
  /**
   * Высота зданий в этажах — для длины тени (world/shadows.ts). [от, до] — у каждого дома своя (по хэшу дома): ряды
   * домов вдоль улиц (facade), стены жилых комнат (house), глухая застройка под крышей (block) — по полосе достатка
   * (none — вне полос: промзона, порт); внутренние стены (internal); казённые здания (civic), стена Протектората (metal), руины КПП, ларёк, прилавки,
   * бетонные блоки, клумбы, изгородь, сруб блиндажа, трибуна и фонтан. Ниже low этажа — «низкое»: на него ложится
   * тень высоких домов, свою — только на землю.
   */
  storeys: {
    facade: { slum: [1.5, 2], old: [2.5, 3.5], upper: [2.5, 3], none: [2, 3] },
    house: { slum: [1, 1.25], old: [1.5, 2], upper: [2, 2], none: [1.5, 2] },
    block: { slum: [1, 2], old: [2, 3], upper: [2, 3], none: [2, 3] },
    civic: 3, metal: 4, ruin: 0.6, kiosk: 1, counter: 0.3, barrier: 0.35, planter: 0.2, hedge: 0.5, dugout: 0.5, landmark: 0.4,
    /** Внутренняя стена квартиры или лавки (с обеих сторон — помещение): по потолок первого этажа. */
    internal: 1,
    low: 1,
    /** Зоны казённых зданий (высота civic). */
    civicZones: ['nexus', 'cells', 'prison', 'academy', 'arsenal', 'cwu_hq'] as readonly string[],
  },
  /**
   * Свечение (в мелком буфере, на экран — одним проходом сложения): плафоны и огонь (bloom: доля радиуса, яркость),
   * тёплая дымка вокруг каждого ночного источника (haze — на высоком качестве), ореолы горящих окон и фонарей фасадов.
   */
  bloom: { radius: 0.3, alpha: 0.42 },
  haze: { radius: 0.8, alpha: 0.17 },
  /** Буфер свечения — эта доля карты света (свечение мягкое: мельче — дешевле, разницы не видно). */
  glowScale: 0.6,
  /** Сколько ламп ещё горит днём (0 — все выключены) — порог включения. */
  lampsOn: 0.05,
  /** Днём при свете суток ярче этого (по каналам) проход света пропускается. */
  skipDay: 238,
} as const;

/**
 * Уют поверх картинки: плёночное зерно (alpha, размер тайла шума), тёплая виньетка (цвет вместо
 * чёрного), дымок из труб (частота на трубу в секунду, сколько живёт, подъём и снос ветром; трубы — по ячейкам
 * grid px, перебираются только у экрана), пылинки в свете фонарей ночью.
 */
export const COZY = {
  grain: { alpha: 0.07, size: 128 },
  vignette: '26,15,6',
  smoke: { perSec: 0.9, life: [3.5, 6] as const, rise: 9, wind: [7, 3] as const, size: [5, 11] as const, color: '150,145,140', alpha: 0.28, max: 260, nightMul: 1.4, grid: 512 },
  motes: { perLamp: 3, color: '255,226,170', alpha: 0.7, size: 1.2, radius: 34 },
  /** Светлячки у зелени тёплой ночью: по perSpot у дерева или клумбы, мигают, кружат в radius px. */
  fireflies: { perSpot: 2, color: '214,255,150', alpha: 0.9, size: 1.5, radius: 22, dark: 0.55, maxSpots: 60 },
} as const;

/**
 * Настройки атмосферы (меню «Атмосфера: свет и сутки», world/atmosphere.ts): хранятся в браузере (storageKey;
 * прежний ключ «вкл/выкл» — legacyKey). Качество — разрешение карты света и набор эффектов: высокое — всё (дымка у
 * света, облака, светлячки, зерно), среднее — без облаков, дымки, светлячков и зерна, низкое — только свет суток и
 * тени. Ночь — светлее (+ доля до белого) или темнее. Слабая машина: кадров меньше fps дольше after с — качество на
 * ступень ниже (само не повышается; вернуть — в меню).
 */
export const ATMOSPHERE = {
  storageKey: 'city17.atmosphere.v2',
  legacyKey: 'city17.atmosphere',
  defaultQuality: 'high' as 'high' | 'medium' | 'low',
  presets: {
    high: { lightScale: 0.28, glow: true, haze: true, clouds: true, shadows: true, pawnShadows: true, life: true, fireflies: true, film: true, grain: true },
    medium: { lightScale: 0.22, glow: true, haze: true, clouds: false, shadows: true, pawnShadows: true, life: true, fireflies: false, film: true, grain: false },
    low: { lightScale: 0.16, glow: false, haze: false, clouds: false, shadows: true, pawnShadows: false, life: false, fireflies: false, film: false, grain: false },
  },
  night: { bright: 0.16, normal: 0, dark: -0.16 },
  autoLite: { fps: 40, after: 6 },
} as const;
