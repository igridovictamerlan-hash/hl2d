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
  lightmapScale: 0.25,
  keys: [
    { at: 0.0, ambient: [112, 112, 156], lamps: 1, name: 'ночь' },
    { at: 0.2, ambient: [114, 112, 154], lamps: 1, name: 'ночь' },
    { at: 0.25, ambient: [204, 166, 170], lamps: 0.7, name: 'рассвет' },
    { at: 0.31, ambient: [255, 234, 208], lamps: 0, name: 'утро' },
    { at: 0.5, ambient: [255, 247, 232], lamps: 0, name: 'день' },
    { at: 0.64, ambient: [255, 232, 196], lamps: 0, name: 'день' },
    { at: 0.71, ambient: [255, 196, 138], lamps: 0.5, name: 'закат' },
    { at: 0.78, ambient: [222, 156, 128], lamps: 1, name: 'вечер' },
    { at: 0.84, ambient: [142, 124, 160], lamps: 1, name: 'сумерки' },
    { at: 0.9, ambient: [112, 112, 156], lamps: 1, name: 'ночь' },
    { at: 1.0, ambient: [112, 112, 156], lamps: 1, name: 'ночь' },
  ] as readonly DayKey[],
  /** Канализация — вечные сумерки. */
  sewer: [74, 78, 88] as Rgb,
  /** Фонарь улицы: плафон на кронштейне (head px от стены). */
  lamp: { color: [255, 196, 120] as Rgb, radius: 130, power: 1, head: 12 },
  /** Бочка с огнём и костёр лагеря сопротивления. */
  barrel: { color: [255, 138, 58] as Rgb, radius: 104, power: 1, flicker: 0.22 },
  campfire: { color: [255, 140, 60] as Rgb, radius: 170, power: 1, flicker: 0.25 },
  /** Своё свечение вокруг игрока — чтобы ночью видеть себя и шаг вокруг. */
  player: { color: [120, 112, 104] as Rgb, radius: 130, power: 0.7 },
  /** Узлы Альянса (терминалы у стен) — холодный голубой. */
  node: { color: [110, 180, 255] as Rgb, radius: 46, power: 0.8 },
  /** Пламя на земле, взрыв, вспышка выстрела (живёт muzzleTime с), горящий человек. */
  fire: { color: [255, 130, 50] as Rgb, radiusMul: 2.2, power: 1, flicker: 0.3 },
  blast: { color: [255, 170, 90] as Rgb, radiusMul: 3.2, power: 1.4 },
  muzzle: { color: [255, 205, 130] as Rgb, radius: 90, power: 0.9, time: 0.07 },
  burning: { color: [255, 120, 40] as Rgb, radius: 70, power: 0.9 },
  /** Люк в канализации: свет сверху. */
  hatch: { color: [210, 205, 180] as Rgb, radius: 70, power: 0.6 },
  /**
   * Комнаты и места по POI. Жилые — тёплые лампы (дом, общежитие, особняк), Альянс — холодный
   * белый (Нексус, КПЗ, цех ГСР), КПП — прожекторы у постов.
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
    // Тюрьма Альянса: двор и коридор — холодные прожекторы у постов, караулка и допросная — лампы.
    prison_post: { color: [210, 228, 255], radius: 120, power: 0.85, night: true, bloom: true },
    prison_office: { color: [255, 205, 140], radius: 80, power: 0.8, night: true, bloom: true },
    prison_guardroom: { color: [255, 200, 130], radius: 70, power: 0.8, night: true, bloom: true },
    prison_evidence: { color: [215, 230, 255], radius: 60, power: 0.6, night: true },
    // Склад Альянса: зал и контора — холодный белый, площадка — прожекторы у постов, мастерская и
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
  /** Свечение (bloom) источников поверх картинки: доля радиуса и яркость. */
  bloom: { radius: 0.3, alpha: 0.4 },
  /** Сколько ламп ещё горит днём (0 — все выключены) — порог включения. */
  lampsOn: 0.05,
  /** Днём при свете суток ярче этого (по каналам) проход света пропускается. */
  skipDay: 238,
} as const;

/**
 * Уют поверх картинки: плёночное зерно (alpha, размер тайла шума), тёплая виньетка (цвет вместо
 * чёрного), дымок из труб (частота на трубу в секунду, сколько живёт, подъём и снос ветром),
 * пылинки в свете фонарей ночью.
 */
export const COZY = {
  /** Выключатель атмосферы (меню) — в localStorage. */
  storageKey: 'city17.atmosphere',
  /**
   * Слабая машина: кадров меньше fps дольше after с — упрощённая атмосфера (без зерна, свечения и
   * пылинок; свет суток остаётся). Обратно сама не усложняется (не «мигает»), снова полная — через меню.
   */
  autoLite: { fps: 42, after: 4 },
  grain: { alpha: 0.09, size: 128 },
  vignette: '26,15,6',
  smoke: { perSec: 0.9, life: [3.5, 6] as const, rise: 9, wind: [7, 3] as const, size: [5, 11] as const, color: '150,145,140', alpha: 0.28, max: 260, nightMul: 1.4 },
  motes: { perLamp: 3, color: '255,226,170', alpha: 0.7, size: 1.2, radius: 34 },
} as const;
