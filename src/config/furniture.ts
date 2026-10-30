/**
 * Убранство комнат в духе RimWorld (world/furnish.ts раскладывает, FurnitureRenderer рисует).
 * Размеры — px мира: «вдоль стены» × «от стены» (кровать — изголовьем к стене). Пешка ≈ 16×28 px,
 * поэтому кровать на одного — 22×32, двуспальная — 36×34, койка казармы — 20×30.
 */
export const FURNITURE = {
  sizes: {
    bed: [22, 32],
    /** Кровать в крохотной комнате (2×3 тайла и меньше). */
    bed_small: [20, 28],
    bed_double: [36, 34],
    cot: [20, 30],
    nightstand: [11, 11],
    bookshelf: [34, 12],
    dresser: [26, 13],
    stove: [18, 15],
    crate: [15, 15],
    plant: [11, 11],
    sofa: [40, 16],
    armchair: [16, 16],
    desk: [30, 15],
    locker: [15, 12],
    lamp: [9, 9],
    chair: [11, 11],
    wardrobe: [24, 13],
    // Квартиры: вешалка в прихожей, кухонная тумба с мойкой, холодильник, ванна, унитаз, раковина; стеллаж подсобки.
    coat_rack: [10, 10],
    kitchen_counter: [30, 13],
    fridge: [14, 13],
    bathtub: [30, 15],
    toilet: [10, 12],
    sink: [12, 9],
    storage_rack: [30, 12],
    // Касса на прилавке лавки, стул у столика кафе — по клеткам оборудования.
    register: [10, 8],
  } as Record<string, readonly [number, number]>,
  /** Стол со стульями посередине — если комната не меньше tableMin тайлов; размер стола. */
  table: { min: [4, 3] as const, w: 28, h: 18 },
  /** Столовая штаба ТС: столы в ряд посередине (шаг step px), стулья сверху и снизу. */
  canteen: { step: 46 },
  /** Вокруг конвейера цеха ничего не ставим (полуширина и полувысота, px). */
  conveyorClear: [30, 18] as const,
  /** Что ставить вдоль стен (по порядку, пока помещается). */
  recipes: {
    home: ['bed', 'nightstand', 'bookshelf', 'dresser', 'stove', 'crate', 'plant', 'wardrobe', 'bookshelf', 'crate'],
    dorm: ['bed', 'bed', 'nightstand', 'nightstand', 'bookshelf', 'crate', 'wardrobe'],
    dorm_common: ['bookshelf', 'bookshelf', 'crate', 'crate', 'plant', 'stove', 'plant'],
    villa: ['bed_double', 'nightstand', 'nightstand', 'wardrobe', 'bookshelf', 'plant', 'lamp', 'plant'],
    villa_living: ['sofa', 'bookshelf', 'bookshelf', 'armchair', 'armchair', 'plant', 'lamp', 'plant', 'bookshelf'],
    // Штаб ТС: комната отдыха, столовая (плюс ряд столов со стульями), кабинет главы, приёмная, цех.
    cwu_lounge: ['sofa', 'armchair', 'armchair', 'bookshelf', 'plant', 'lamp', 'plant'],
    cwu_canteen: ['stove', 'stove', 'crate', 'plant', 'crate'],
    cwu_office: ['bookshelf', 'bookshelf', 'wardrobe', 'plant', 'lamp', 'plant'],
    cwu_lobby: ['armchair', 'armchair', 'plant', 'bookshelf', 'plant', 'armchair'],
    cwu_production: ['crate', 'crate', 'crate', 'crate', 'crate', 'crate', 'crate'],
    /**
     * Комнаты квартир и лавок (POI room, generator/interiors.ts) — по назначению; вариант по полосе достатка —
     * «назначение_полоса» (slum / old / upper), иначе общий. Кухня, гостиная и комната коммуналки — и стол со стульями.
     */
    hall: ['coat_rack', 'nightstand', 'plant'],
    hall_slum: ['coat_rack', 'crate'],
    hall_upper: ['coat_rack', 'dresser', 'plant', 'lamp'],
    corridor: ['coat_rack', 'crate'],
    kitchen: ['stove', 'kitchen_counter', 'fridge', 'crate', 'plant'],
    kitchen_slum: ['stove', 'kitchen_counter', 'crate', 'crate'],
    kitchen_upper: ['stove', 'kitchen_counter', 'fridge', 'kitchen_counter', 'plant'],
    bath: ['bathtub', 'toilet', 'sink'],
    bedroom: ['bed', 'nightstand', 'wardrobe', 'bookshelf', 'dresser', 'plant'],
    bedroom_slum: ['bed', 'crate', 'nightstand', 'crate'],
    bedroom_upper: ['bed_double', 'nightstand', 'nightstand', 'wardrobe', 'bookshelf', 'dresser', 'plant', 'lamp'],
    living: ['sofa', 'bookshelf', 'armchair', 'plant', 'lamp', 'bookshelf'],
    living_upper: ['sofa', 'bookshelf', 'bookshelf', 'armchair', 'armchair', 'plant', 'lamp', 'plant'],
    room: ['bed', 'nightstand', 'crate', 'wardrobe', 'crate'],
    studio: ['bed', 'nightstand', 'bookshelf', 'dresser', 'stove', 'crate', 'plant', 'wardrobe', 'bookshelf', 'crate'],
    studio_slum: ['bed', 'stove', 'crate', 'nightstand', 'crate', 'wardrobe'],
    studio_upper: ['bed_double', 'nightstand', 'bookshelf', 'dresser', 'stove', 'plant', 'wardrobe', 'lamp', 'plant'],
    sales: ['plant', 'crate'],
    backroom: ['storage_rack', 'crate', 'crate', 'storage_rack', 'crate'],
    cafe: ['plant', 'plant'],
    cafe_kitchen: ['stove', 'stove', 'kitchen_counter', 'fridge', 'crate'],
  } as Record<string, readonly string[]>,
  /**
   * Торговое оборудование (POI shop_fixture) — предмет во весь прямоугольник клеток с отступом inset px; в зале кафе
   * у столика — стулья с открытых сторон; на прилавке у места покупателя — касса.
   */
  fixtures: { inset: 1.5 },
  /** Проход у двери: полоса шириной в дверь и глубиной doorClear px от стены — туда ничего не ставим. */
  doorClear: 20,
  /** Для кровати в тесной комнате — только сам проём. */
  doorClearMin: 6,
  /** Зазор между предметами и от стены, px. */
  gap: 1,
  /** Спрайты: масштаб — уровни (perOctave на удвоение), при переполнении (max) уходят самые давние. */
  cache: { perOctave: 4, max: 1200 },
  /**
   * Палитра в духе RimWorld: плоские заливки, тёмный контур (outline, толщина line px), дерево
   * двух тонов со светлыми волокнами, белое бельё, цветные корешки книг.
   */
  palette: {
    outline: '#1b1712',
    line: 1.1,
    wood: ['#9a6b40', '#7d5431', '#6a4a2e'] as readonly string[],
    woodDark: '#4e3521',
    woodGrain: 'rgba(40,24,10,0.35)',
    sheet: '#ece8dd',
    pillow: '#f6f3ec',
    blanket: ['#4f6f8f', '#8f4f4f', '#5f7f4f', '#7f6a4a', '#6a5a8a', '#3f7f7f'] as readonly string[],
    metal: '#6b7178',
    metalDark: '#43484e',
    metalLight: '#9aa1a8',
    books: ['#8c2f2f', '#2f5a8c', '#3f7a3a', '#b08a2a', '#6a3f8c', '#2f7a7a', '#a0522d', '#5a5a5a'] as readonly string[],
    shelfBack: '#2a1d12',
    paper: '#e9e5da',
    ink: 'rgba(60,60,60,0.6)',
    potTerra: '#9a5a36',
    leaf: ['#3f7a36', '#5a9a44', '#2f5f2a'] as readonly string[],
    rug: ['#7a2f2a', '#2f4f7a', '#5a4a2a', '#4a2f5a'] as readonly string[],
    rugBorder: 'rgba(240,220,170,0.45)',
    sofa: ['#6b3f4f', '#3f5a6b', '#5a6b3f'] as readonly string[],
    lampShade: '#f3e6b0',
    burner: '#1e1e1e',
    cot: '#56604a',
    card: '#f2eee4',
    cardRed: '#b03030',
    felt: '#2f5a3a',
    // Сантехника и кухня, торговое оборудование.
    porcelain: '#eef0ec',
    porcelainShade: '#c9cec8',
    water: '#8fb8cc',
    steel: '#b7bdc2',
    glass: 'rgba(170,215,235,0.55)',
    glassEdge: '#5d7f8f',
    shelfBoard: '#c8a57a',
    cooler: '#dfe8ee',
    coolerTrim: '#3f6f8f',
    rail: '#4a4f55',
    pegboard: '#b89a6a',
    pegHole: 'rgba(60,40,20,0.45)',
    curtain: ['#7a2f3f', '#2f4f6f', '#5a4a2a'] as readonly string[],
    mirror: '#c8dde6',
    register: '#3a3f44',
    registerKey: '#d9d2c0',
    paperStack: '#d8d0bc',
    bar: '#5a3a24',
    coffee: '#2a2a2a',
  },
} as const;
